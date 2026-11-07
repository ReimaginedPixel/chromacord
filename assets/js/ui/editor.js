// The editor: a contenteditable element driven by the document model.
//
// Typing, deleting, line breaks, paste and undo go through the model (via
// beforeinput) and the DOM is re-rendered from it, so the markup never drifts
// into browser-made <div>s and <font> tags. Input methods that compose text
// (phone keyboards, CJK) can't be intercepted, so those edits are read back
// from the DOM once the composition ends.

import { PLAIN_KEY, styleOf, normalizeKey, keyOf } from '../core/style.js';
import * as D from '../core/doc.js';
import { graphemes } from '../core/effects.js';
import { looksLikeAnsi, importText } from '../core/ansi.js';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const GHOST = 'chromacord-selection';

/** Apply a style to an element as classes (classic colors) and inline colors (custom). */
export function decorate(el, st) {
  const cls = [];
  if (st.b) cls.push('a-b');
  if (st.i) cls.push('a-i');
  if (st.u) cls.push('a-u');
  if (st.s) cls.push('a-s');
  if (typeof st.fg === 'number') cls.push(`a-f${st.fg}`);
  else if (st.fg) el.style.color = st.fg;
  if (typeof st.bg === 'number') cls.push(`a-g${st.bg}`);
  else if (st.bg) el.style.backgroundColor = st.bg;
  if (cls.length) el.className = cls.join(' ');
  return el;
}

/** Render runs into an element, read only. Used for previews. */
export function renderRuns(target, runs) {
  const frag = document.createDocumentFragment();
  for (const run of runs) {
    const span = document.createElement('span');
    decorate(span, run.style ?? styleOf(run.key));
    span.textContent = run.text;
    frag.append(span);
  }
  target.replaceChildren(frag);
}

/** Read text and style keys out of DOM nodes, the inverse of render(). */
function readNodes(root) {
  let text = '';
  const keys = [];
  const add = (t, key) => {
    text += t;
    for (let i = 0; i < t.length; i += 1) keys.push(key);
  };
  const walk = (node, key) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        add(child.data, key);
      } else if (child.nodeType === 1) {
        const tag = child.tagName;
        if (tag === 'BR') {
          if (!child.hasAttribute('data-tail')) add('\n', key);
          continue;
        }
        if ((tag === 'DIV' || tag === 'P' || tag === 'LI') && text.length && !text.endsWith('\n')) add('\n', key);
        walk(child, child.hasAttribute('data-s') ? normalizeKey(child.getAttribute('data-s')) : key);
      }
    }
  };
  walk(root, PLAIN_KEY);
  return { text, keys };
}

function cleanDoc(doc) {
  if (!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(doc.text)) return doc;
  let text = '';
  const keys = [];
  for (let i = 0; i < doc.text.length; i += 1) {
    const ch = doc.text[i];
    if (ch === '\r' && doc.text[i + 1] === '\n') continue;
    const c = ch === '\r' ? '\n' : ch;
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(c)) continue;
    text += c;
    keys.push(doc.keys[i]);
  }
  return { text, keys };
}

function prevBoundary(text, pos) {
  if (pos <= 0) return 0;
  const from = Math.max(0, pos - 24);
  const gs = graphemes(text.slice(from, pos));
  return from + (gs.length ? gs[gs.length - 1].index : 0);
}

function nextBoundary(text, pos) {
  if (pos >= text.length) return text.length;
  const gs = graphemes(text.slice(pos, pos + 24));
  return pos + (gs.length ? gs[0].text.length : 1);
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Editor extends EventTarget {
  /**
   * @param {HTMLElement} el contenteditable element
   * @param {object} opts
   * @param {(code:number) => string} opts.classicHex hex for a classic code in the current theme (for HTML copies)
   */
  constructor(el, { classicHex } = {}) {
    super();
    this.el = el;
    this.classicHex = classicHex ?? (() => '#888888');
    this.doc = D.EMPTY;
    this.sel = { start: 0, end: 0 };
    this.pending = null;
    this.composing = false;
    this.history = { undo: [], redo: [], group: null, time: 0 };
    this.bind();
  }

  // -------------------------------------------------------------- events

  bind() {
    const el = this.el;
    el.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    el.addEventListener('input', () => {
      if (!this.composing) this.syncFromDom();
    });
    el.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    el.addEventListener('compositionend', () => {
      this.composing = false;
      this.syncFromDom();
    });
    el.addEventListener('keydown', (e) => this.onKeyDown(e));
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      this.pasteData(e.clipboardData, this.readSelection() ?? this.sel);
    });
    el.addEventListener('copy', (e) => this.onCopy(e, false));
    el.addEventListener('cut', (e) => this.onCopy(e, true));
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => e.preventDefault());
    el.addEventListener('focus', () => this.clearGhost());
    el.addEventListener('blur', () => this.showGhost());
    document.addEventListener('selectionchange', () => this.onSelectionChange());
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get focused() {
    return document.activeElement === this.el;
  }

  onBeforeInput(e) {
    const type = e.inputType;
    if (this.composing || e.isComposing || type === 'insertCompositionText' || type === 'deleteCompositionText' || type === 'insertFromComposition') return;
    // Some phone keyboards send edits that can't be cancelled. Let the browser
    // apply those and read the result back on the input event.
    if (!e.cancelable) return;
    const range = this.targetRange(e) ?? this.readSelection() ?? this.sel;

    if (type === 'insertText' || type === 'insertReplacementText' || type === 'insertFromYank') {
      e.preventDefault();
      const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
      if (data) this.insertText(data, range, type === 'insertText' ? 'type' : null);
      return;
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      e.preventDefault();
      this.insertText('\n', range, 'type');
      return;
    }
    if (type === 'insertFromPaste' || type === 'insertFromPasteAsQuotation') {
      e.preventDefault();
      this.pasteData(e.dataTransfer, range);
      return;
    }
    if (type === 'historyUndo' || type === 'historyRedo') {
      e.preventDefault();
      if (type === 'historyUndo') this.undo();
      else this.redo();
      return;
    }
    if (type.startsWith('delete')) {
      e.preventDefault();
      this.deleteFor(type, range);
      return;
    }
    if (type.startsWith('format')) {
      e.preventDefault();
      const map = { formatBold: 'b', formatItalic: 'i', formatUnderline: 'u', formatStrikeThrough: 's', formatRemove: 'clear' };
      if (map[type]) this.emit('command', { name: map[type] });
      return;
    }
    if (type.startsWith('insert')) e.preventDefault();
  }

  onKeyDown(e) {
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    let cmd = null;
    if (k === 'z') cmd = e.shiftKey ? 'redo' : 'undo';
    else if (k === 'y' && !IS_MAC) cmd = 'redo';
    else if (k === 'b' && !e.shiftKey) cmd = 'b';
    else if (k === 'i' && !e.shiftKey) cmd = 'i';
    else if (k === 'u' && !e.shiftKey) cmd = 'u';
    else if (k === 'x' && e.shiftKey) cmd = 's';
    else if (k === '\\') cmd = 'clear';
    else if (k === 'enter') cmd = 'copy';
    if (!cmd) return;
    e.preventDefault();
    if (cmd === 'undo') this.undo();
    else if (cmd === 'redo') this.redo();
    else this.emit('command', { name: cmd });
  }

  onSelectionChange() {
    if (this.composing) return;
    const s = this.readSelection();
    if (!s) return;
    if (s.start === this.sel.start && s.end === this.sel.end) return;
    this.sel = s;
    if (this.pending && (s.start !== s.end || s.start !== this.pending.at)) this.pending = null;
    this.history.group = null;
    this.emit('selection');
  }

  onCopy(e, cut) {
    const range = this.readSelection();
    if (!range || range.start === range.end) return;
    e.preventDefault();
    const piece = D.sliceDoc(this.doc, range.start, range.end);
    e.clipboardData.setData('text/plain', piece.text);
    e.clipboardData.setData('text/html', this.toHtml(piece));
    if (cut) this.replace(range.start, range.end, '', PLAIN_KEY, null);
  }

  /** HTML for the clipboard: keeps styles when pasted back here, and looks right elsewhere. */
  toHtml(doc) {
    const spans = D.toRuns(doc)
      .map((run) => {
        const st = run.style;
        const css = [];
        if (st.b) css.push('font-weight:700');
        if (st.i) css.push('font-style:italic');
        const deco = [st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ');
        if (deco) css.push(`text-decoration:${deco}`);
        if (st.fg != null) css.push(`color:${typeof st.fg === 'number' ? this.classicHex(st.fg) : st.fg}`);
        if (st.bg != null) css.push(`background-color:${typeof st.bg === 'number' ? this.classicHex(st.bg - 10) : st.bg}`);
        return `<span data-s="${escapeHtml(run.key)}" style="${css.join(';')}">${escapeHtml(run.text)}</span>`;
      })
      .join('');
    return `<pre data-chromacord="1" style="white-space:pre-wrap;font-family:monospace">${spans}</pre>`;
  }

  pasteData(dt, range) {
    if (!dt) return;
    const html = dt.getData('text/html');
    const plain = dt.getData('text/plain');
    let piece = null;
    let source = 'plain';
    if (html && html.includes('data-chromacord')) {
      try {
        const root = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-chromacord]');
        if (root) piece = cleanDoc(readNodes(root));
        source = 'editor';
      } catch {
        piece = null;
      }
    }
    if (!piece && plain && looksLikeAnsi(plain)) {
      piece = D.fromRuns(importText(plain));
      source = 'ansi';
    }
    if (!piece) {
      const text = D.cleanText(plain ?? '');
      if (!text) return;
      piece = { text, keys: new Array(text.length).fill(this.keyForInsert(range)) };
    }
    this.insertDoc(piece, range);
    this.emit('paste', { source, length: piece.text.length });
  }

  // ------------------------------------------------------- DOM mapping

  /** Model offset of a DOM point inside the editor. */
  offsetOf(node, offset) {
    if (node !== this.el && !this.el.contains(node)) return null;
    const range = document.createRange();
    range.setStart(this.el, 0);
    try {
      range.setEnd(node, offset);
    } catch {
      return null;
    }
    return readNodes(range.cloneContents()).text.length;
  }

  /** DOM point for a model offset, assuming the editor holds our own markup. */
  pointAt(offset) {
    let rest = offset;
    let last = null;
    const kids = this.el.childNodes;
    for (let i = 0; i < kids.length; i += 1) {
      const node = kids[i];
      if (node.nodeName === 'BR') {
        if (node.hasAttribute('data-tail')) return [this.el, i];
        continue;
      }
      const t = node.nodeType === 3 ? node : node.firstChild;
      if (!t || t.nodeType !== 3) continue;
      const len = t.data.length;
      // At a boundary after a line break, prefer the start of the next line.
      if (rest < len || (rest === len && !t.data.endsWith('\n'))) return [t, rest];
      rest -= len;
      last = t;
    }
    return last ? [last, last.data.length] : [this.el, 0];
  }

  readSelection() {
    const s = document.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!this.el.contains(r.startContainer) || !this.el.contains(r.endContainer)) return null;
    const a = this.offsetOf(r.startContainer, r.startOffset);
    const b = r.collapsed ? a : this.offsetOf(r.endContainer, r.endOffset);
    if (a == null || b == null) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  targetRange(e) {
    const ranges = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
    if (!ranges.length) return null;
    const a = this.offsetOf(ranges[0].startContainer, ranges[0].startOffset);
    const b = this.offsetOf(ranges[0].endContainer, ranges[0].endOffset);
    if (a == null || b == null) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  setDomSelection({ start, end }) {
    const s = document.getSelection();
    if (!s) return;
    const [an, ao] = this.pointAt(start);
    const [fn, fo] = start === end ? [an, ao] : this.pointAt(end);
    try {
      s.setBaseAndExtent(an, ao, fn, fo);
    } catch {
      /* the DOM moved under us, next render fixes it */
    }
  }

  placeSelection(sel) {
    if (this.focused) this.setDomSelection(sel);
    else this.showGhost();
  }

  /** Keep the selection visible while the user works in the side panel. */
  showGhost() {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const { start, end } = this.sel;
    if (start === end || end > this.doc.text.length) {
      CSS.highlights.delete(GHOST);
      return;
    }
    try {
      const [an, ao] = this.pointAt(start);
      const [fn, fo] = this.pointAt(end);
      const r = document.createRange();
      r.setStart(an, ao);
      r.setEnd(fn, fo);
      CSS.highlights.set(GHOST, new Highlight(r));
    } catch {
      CSS.highlights.delete(GHOST);
    }
  }

  clearGhost() {
    if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(GHOST);
  }

  // ------------------------------------------------------------- render

  render(sel = this.sel) {
    const frag = document.createDocumentFragment();
    for (const run of D.toRuns(this.doc)) {
      const span = document.createElement('span');
      span.dataset.s = run.key;
      decorate(span, run.style);
      span.textContent = run.text;
      frag.append(span);
    }
    if (this.doc.text.endsWith('\n')) {
      const br = document.createElement('br');
      br.setAttribute('data-tail', '');
      frag.append(br);
    }
    this.el.replaceChildren(frag);
    this.el.dataset.empty = String(!this.doc.text.length);
    this.placeSelection(sel);
  }

  isCanonical() {
    const runs = D.toRuns(this.doc);
    const kids = this.el.childNodes;
    const tail = this.doc.text.endsWith('\n') ? 1 : 0;
    if (kids.length !== runs.length + tail) return false;
    for (let i = 0; i < runs.length; i += 1) {
      const k = kids[i];
      if (k.nodeName !== 'SPAN' || k.dataset.s !== runs[i].key || k.childNodes.length !== 1 || k.firstChild.nodeType !== 3 || k.firstChild.data !== runs[i].text) return false;
    }
    return !tail || (kids[runs.length].nodeName === 'BR' && kids[runs.length].hasAttribute('data-tail'));
  }

  /** Read edits the browser made on its own (composition, unknown input types). */
  syncFromDom() {
    const next = cleanDoc(readNodes(this.el));
    const same = next.text === this.doc.text && next.keys.length === this.doc.keys.length && next.keys.every((k, i) => k === this.doc.keys[i]);
    if (!same) {
      this.record('type');
      this.doc = next;
      this.sel = this.readSelection() ?? { start: next.text.length, end: next.text.length };
    }
    if (!this.isCanonical()) this.render(this.sel);
    if (!same) this.changed();
  }

  // ------------------------------------------------------------ editing

  record(group) {
    const h = this.history;
    const now = Date.now();
    if (group && h.group === group && now - h.time < 1500) {
      h.time = now;
      return;
    }
    h.undo.push({ doc: this.doc, sel: this.sel });
    if (h.undo.length > 300) h.undo.shift();
    h.redo.length = 0;
    h.group = group;
    h.time = now;
    this.emit('history', this.historyState());
  }

  historyState() {
    return { canUndo: this.history.undo.length > 0, canRedo: this.history.redo.length > 0 };
  }

  undo() {
    const prev = this.history.undo.pop();
    if (!prev) return false;
    this.history.redo.push({ doc: this.doc, sel: this.sel });
    this.restore(prev);
    return true;
  }

  redo() {
    const next = this.history.redo.pop();
    if (!next) return false;
    this.history.undo.push({ doc: this.doc, sel: this.sel });
    this.restore(next);
    return true;
  }

  restore(snap) {
    this.doc = snap.doc;
    this.sel = { ...snap.sel };
    this.history.group = null;
    this.pending = null;
    this.render(this.sel);
    this.changed();
    this.emit('history', this.historyState());
  }

  changed() {
    this.emit('change');
    this.emit('selection');
  }

  keyForInsert({ start, end }) {
    const keys = this.doc.keys;
    if (start !== end) return keys[start] ?? PLAIN_KEY;
    if (start > 0) return keys[start - 1] ?? PLAIN_KEY;
    return keys[0] ?? PLAIN_KEY;
  }

  /** Style the next typed text will get at the caret. */
  typingStyle() {
    if (this.pending && this.pending.at === this.sel.start && this.sel.start === this.sel.end) return styleOf(this.pending.key);
    return styleOf(this.keyForInsert(this.sel));
  }

  /** Set the style for the next typed text at the caret. */
  setPending(style) {
    this.pending = { at: this.sel.start, key: keyOf(style) };
    this.emit('selection');
  }

  replace(start, end, text, key, group) {
    this.record(group);
    this.doc = D.replaceRange(this.doc, start, end, text, key ?? PLAIN_KEY);
    this.pending = null;
    const caret = start + text.length;
    this.sel = { start: caret, end: caret };
    this.render(this.sel);
    this.changed();
  }

  insertText(data, range, group) {
    const text = D.cleanText(data);
    if (!text && range.start === range.end) return;
    const usePending = this.pending && range.start === range.end && this.pending.at === range.start;
    const key = usePending ? this.pending.key : this.keyForInsert(range);
    this.replace(range.start, range.end, text, key, group);
    if (/\s/.test(text)) this.history.group = null;
  }

  deleteFor(type, range) {
    let { start, end } = range;
    const text = this.doc.text;
    if (start === end) {
      const back = type.includes('Backward');
      if (type.includes('Word')) {
        if (back) {
          while (start > 0 && /\s/.test(text[start - 1])) start -= 1;
          while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
        } else {
          while (end < text.length && /\s/.test(text[end])) end += 1;
          while (end < text.length && !/\s/.test(text[end])) end += 1;
        }
      } else if (type.includes('Line')) {
        if (back) start = start > 0 && text[start - 1] === '\n' ? start - 1 : text.lastIndexOf('\n', start - 1) + 1;
        else {
          const nl = text.indexOf('\n', end);
          end = nl === -1 ? text.length : nl === end ? nl + 1 : nl;
        }
      } else if (back) start = prevBoundary(text, start);
      else end = nextBoundary(text, end);
    }
    if (start === end) return;
    this.replace(start, end, '', PLAIN_KEY, 'delete');
  }

  /** Insert a document piece (paste, template) and put the caret after it. */
  insertDoc(piece, range = this.sel, group = null) {
    this.record(group);
    this.doc = D.spliceDoc(this.doc, range.start, range.end, piece);
    this.pending = null;
    const caret = range.start + piece.text.length;
    this.sel = { start: caret, end: caret };
    this.render(this.sel);
    this.changed();
  }

  /** Restyle a range and keep it selected so the next color can be tried right away. */
  restyle(range, fn, group = null) {
    this.record(group);
    this.doc = D.mapStyles(this.doc, range.start, range.end, fn);
    this.sel = { start: range.start, end: range.end };
    this.render(this.sel);
    this.changed();
  }

  /** Replace everything. */
  setDoc(doc, { record = true, select = 'end' } = {}) {
    if (record) this.record(null);
    this.doc = doc;
    this.pending = null;
    const at = select === 'start' ? 0 : doc.text.length;
    this.sel = select === 'all' ? { start: 0, end: doc.text.length } : { start: at, end: at };
    this.render(this.sel);
    this.changed();
  }

  select(start, end = start) {
    this.sel = { start, end };
    this.placeSelection(this.sel);
    this.emit('selection');
  }

  focus() {
    this.el.focus({ preventScroll: true });
    this.setDomSelection(this.sel);
  }
}
