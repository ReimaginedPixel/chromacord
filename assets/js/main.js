// Chromacord: wiring the editor, the side panel and the output together.

import { PLAIN_KEY, patchStyle, makeStyle, textCode } from './core/style.js';
import * as D from './core/doc.js';
import { encodeRuns, toMessage, measure, decodeAnsi, importText, tokenize, describeParams, MESSAGE_LIMIT, NITRO_LIMIT, COPY_FORMATS } from './core/ansi.js';
import { effectColors, EFFECTS, graphemes } from './core/effects.js';
import { normalizeHex, readableOn } from './core/color.js';
import { encodeShare, decodeShare } from './core/share.js';
import { BRIGHT, CLASSIC, PALETTES, PRESETS, THEMES, THEME_HEX } from './data/palettes.js';
import { TEMPLATES, templateById } from './data/templates.js';
import { Editor, renderRuns, decorate } from './ui/editor.js';
import { $, $$, h, store, debounce, toast, menu, copyText, formatNumber } from './ui/helpers.js';

const SVG = 'http://www.w3.org/2000/svg';
const icon = (name) => {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
};

// ------------------------------------------------------------------ state

const validHexList = (list) => Array.isArray(list) && list.length >= 2 && list.length <= 8 && list.every((c) => normalizeHex(c));
const storedFx = store.get('fx', {});
const state = {
  theme: THEMES.some((t) => t.id === store.get('theme')) ? store.get('theme') : 'ash',
  target: store.get('target') === 'bg' ? 'bg' : 'fg',
  tab: ['colors', 'effects', 'templates'].includes(store.get('tab')) ? store.get('tab') : 'colors',
  palette: PALETTES.some((p) => p.id === store.get('palette')) ? store.get('palette') : 'roles',
  recent: (store.get('recent', []) || []).map(normalizeHex).filter(Boolean).slice(0, 16),
  fx: {
    effect: EFFECTS.some((e) => e.id === storedFx.effect) ? storedFx.effect : 'gradient',
    colors: validHexList(storedFx.colors) ? storedFx.colors.map(normalizeHex) : PRESETS[0].colors.slice(),
    perLine: !!storedFx.perLine,
  },
  lastFx: null,
  body: '',
  message: '',
};

const editorEl = $('#editor');
const editor = new Editor(editorEl, { classicHex: (code) => THEME_HEX[state.theme][code] });
const welcomeDoc = () => D.fromRuns(templateById('welcome').build());
const WELCOME_TEXT = welcomeDoc().text;

const announce = (text) => {
  const el = $('#announcer');
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = text;
  });
};

/** Run fn at most once per frame. */
const perFrame = (fn) => {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
};

// ---------------------------------------------------------- radio groups

function syncRadios(wrap, isOn) {
  for (const b of wrap.querySelectorAll('[role=radio]')) {
    const on = isOn(b);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

function arrowKeys(wrap, selector) {
  wrap.addEventListener('keydown', (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    const items = [...wrap.querySelectorAll(selector)];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = items[(i + d + items.length) % items.length];
    next.focus();
    next.click();
  });
}

// ------------------------------------------------------------------ theme

function buildThemes() {
  const wrap = $('#themes');
  wrap.replaceChildren(
    ...THEMES.map((t) =>
      h('button', { type: 'button', role: 'radio', 'data-theme-id': t.id, onclick: () => setTheme(t.id) },
        h('span', { class: 'dot', style: `background:${THEME_HEX[t.id].base}`, 'aria-hidden': 'true' }), t.name),
    ),
  );
  arrowKeys(wrap, '[role=radio]');
}

function setTheme(id) {
  state.theme = id;
  document.body.dataset.theme = id;
  store.set('theme', id);
  syncRadios($('#themes'), (b) => b.dataset.themeId === id);
  paintClassicLabels();
}

// ----------------------------------------------------------------- target

function setTarget(target) {
  state.target = target;
  store.set('target', target);
  syncRadios($('#target'), (b) => b.dataset.target === target);
  $('#remove-color').textContent = target === 'fg' ? 'Remove text color' : 'Remove background';
  renderClassic();
  updateSelectionUI();
}

// --------------------------------------------------------- applying style

/** The range a style click applies to: the selection, or the word under the caret. */
function styleRange() {
  const { start, end } = editor.sel;
  if (start !== end) return { start, end };
  const text = editor.doc.text;
  const isWord = (c) => c !== undefined && !/\s/.test(c);
  if (isWord(text[start - 1]) && isWord(text[start])) return D.wordAt(text, start);
  return null;
}

function applyColor(color, group) {
  const key = state.target;
  const range = styleRange();
  state.lastFx = null;
  if (!range) {
    editor.setPending(patchStyle(editor.typingStyle(), { [key]: color }));
    if (editor.doc.text.length) toast(color == null ? 'Nothing selected. What you type next has no color.' : 'Nothing selected. What you type next gets this color.');
    return;
  }
  editor.restyle(range, (st) => patchStyle(st, { [key]: color }), group ?? `color:${range.start}:${range.end}`);
}

function toggleFlag(flag) {
  const range = styleRange();
  if (!range) {
    const base = editor.typingStyle();
    editor.setPending(patchStyle(base, { [flag]: !base[flag] }));
    return;
  }
  const sum = D.summarize(editor.doc, range.start, range.end);
  const on = !(sum && sum[flag]);
  editor.restyle(range, (st) => patchStyle(st, { [flag]: on }));
}

function clearFormatting() {
  const range = styleRange();
  state.lastFx = null;
  if (!range) {
    editor.setPending(makeStyle());
    return;
  }
  editor.restyle(range, () => makeStyle());
}

function runCommand(name) {
  if (name === 'b' || name === 'i' || name === 'u' || name === 's') toggleFlag(name);
  else if (name === 'clear') clearFormatting();
  else if (name === 'undo') editor.undo();
  else if (name === 'redo') editor.redo();
  else if (name === 'copy') copyMessage('discord');
}

// ----------------------------------------------------------------- colors

function swatch(color, label) {
  return h('button', {
    type: 'button',
    class: 'sw',
    style: `--c:${color}`,
    'data-color': color,
    'aria-label': label,
    title: label,
    'aria-pressed': 'false',
    onclick: () => {
      setPicker(color);
      applyColor(color);
    },
  });
}

// Classic colors on the first row, bright ones on the second.
function renderClassic() {
  $('#classic').replaceChildren(
    ...[...CLASSIC, ...BRIGHT].map(({ code, name }) => {
      const c = state.target === 'fg' ? code : code + 10;
      return h('button', {
        type: 'button',
        class: 'sw',
        style: `--c:var(--ansi-${code})`,
        'data-color': String(c),
        'data-slot': String(code),
        'aria-label': `${name}, code ${c}`,
        title: `${name} (${c})`,
        'aria-pressed': 'false',
        onclick: () => applyColor(c),
      }, h('span', { class: 'sw-code', 'aria-hidden': 'true' }, String(c)));
    }),
  );
  paintClassicLabels();
}

function paintClassicLabels() {
  for (const b of $$('#classic .sw')) {
    b.style.setProperty('--label', readableOn(THEME_HEX[state.theme][b.dataset.slot]));
  }
}

function setPicker(color) {
  $('#pick').value = color;
  $('#hex').value = color;
  $('#well').style.setProperty('--c', color);
  $('#hex').removeAttribute('aria-invalid');
  $('#hex-error').hidden = true;
}

function addRecent(color) {
  const c = normalizeHex(color);
  if (!c) return;
  state.recent = [c, ...state.recent.filter((x) => x !== c)].slice(0, 16);
  store.set('recent', state.recent);
  renderRecent();
  updateSelectionUI();
}

function renderRecent() {
  $('#recent').replaceChildren(...state.recent.map((c) => swatch(c, c)));
  $('#recent-empty').hidden = state.recent.length > 0;
  $('#clear-recent').hidden = state.recent.length === 0;
}

function renderPalette() {
  const p = PALETTES.find((x) => x.id === state.palette) ?? PALETTES[0];
  $('#palette').replaceChildren(...p.colors.map(([c, name]) => swatch(c, `${name}, ${c}`)));
  updateSelectionUI();
}

function bindColors() {
  const pick = $('#pick');
  const hex = $('#hex');
  pick.addEventListener('input', () => {
    setPicker(pick.value);
    const range = styleRange();
    if (range) applyColor(pick.value, `pick:${range.start}:${range.end}`);
  });
  pick.addEventListener('change', () => {
    addRecent(pick.value);
    if (!styleRange()) applyColor(pick.value);
  });
  const applyHex = () => {
    const v = normalizeHex(hex.value);
    if (!v) {
      hex.setAttribute('aria-invalid', 'true');
      $('#hex-error').hidden = false;
      return;
    }
    setPicker(v);
    applyColor(v);
    addRecent(v);
  };
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyHex();
    }
  });
  hex.addEventListener('input', () => {
    hex.removeAttribute('aria-invalid');
    $('#hex-error').hidden = true;
    const v = normalizeHex(hex.value);
    if (v) {
      $('#well').style.setProperty('--c', v);
      pick.value = v;
    }
  });
  $('#apply-hex').addEventListener('click', applyHex);
  $('#clear-recent').addEventListener('click', () => {
    state.recent = [];
    store.set('recent', []);
    renderRecent();
  });
  const select = $('#palette-select');
  select.replaceChildren(...PALETTES.map((p) => h('option', { value: p.id, selected: p.id === state.palette }, p.name)));
  select.addEventListener('change', () => {
    state.palette = select.value;
    store.set('palette', state.palette);
    renderPalette();
  });
  $('#remove-color').addEventListener('click', () => applyColor(null));
}

// ---------------------------------------------------------------- effects

function hardStops(list) {
  const n = list.length;
  return `linear-gradient(90deg, ${list.map((c, i) => `${c} ${((i / n) * 100).toFixed(2)}% ${(((i + 1) / n) * 100).toFixed(2)}%`).join(', ')})`;
}

/** A CSS background that previews an effect with some colors. */
function barFor(effect, colors) {
  const cs = colors.length ? colors : ['#888888'];
  const gap = 'transparent';
  switch (effect) {
    case 'mirror':
      return `linear-gradient(90deg, ${[...cs, ...cs.slice(0, -1).reverse()].join(', ')})`;
    case 'bands':
      return hardStops(cs);
    case 'alternate':
      return hardStops(Array.from({ length: 14 }, (_, i) => cs[i % cs.length]));
    case 'words': {
      const w = (i) => cs[i % cs.length];
      return hardStops([w(0), w(0), w(0), gap, w(1), w(1), gap, w(2), w(2), w(2), w(2), gap, w(3), w(3)]);
    }
    case 'random': {
      const seq = [0, 3, 1, 4, 2, 0, 5, 2, 3, 1, 4, 0, 2, 5];
      return hardStops(seq.map((i) => cs[i % cs.length]));
    }
    default:
      return cs.length === 1 ? cs[0] : `linear-gradient(90deg, ${cs.join(', ')})`;
  }
}

function buildModes() {
  const wrap = $('#modes');
  wrap.replaceChildren(
    ...EFFECTS.map((fx) =>
      h('button', { type: 'button', role: 'radio', class: 'mode', 'data-effect': fx.id, title: fx.hint, onclick: () => setEffect(fx.id) },
        h('span', { class: 'mode-bar', 'aria-hidden': 'true' }), fx.label),
    ),
  );
  arrowKeys(wrap, '[role=radio]');
}

function paintModes() {
  syncRadios($('#modes'), (b) => b.dataset.effect === state.fx.effect);
  for (const b of $$('#modes .mode')) b.querySelector('.mode-bar').style.setProperty('--bar', barFor(b.dataset.effect, state.fx.colors));
  $('#mode-hint').textContent = EFFECTS.find((e) => e.id === state.fx.effect).hint;
  for (const b of $$('#presets .preset')) {
    const p = PRESETS.find((x) => x.id === b.dataset.preset);
    b.querySelector('.preset-bar').style.setProperty('--bar', barFor(state.fx.effect, p.colors));
  }
}

const saveFx = debounce(() => store.set('fx', state.fx), 300);

function setEffect(id) {
  state.fx.effect = id;
  saveFx();
  paintModes();
  reapply();
}

const ADD_COLORS = ['#ff5a5a', '#ffe45e', '#4cd97b', '#3ed3e6', '#5b8cff', '#b26bff', '#ff71ce', '#ffffff'];

function renderStops() {
  const n = state.fx.colors.length;
  const items = state.fx.colors.map((c, i) =>
    h('div', { class: 'stop' },
      h('label', { style: `--c:${c}`, title: c },
        h('input', {
          type: 'color',
          value: c,
          'aria-label': `Color ${i + 1} of ${n}`,
          oninput: (e) => {
            state.fx.colors[i] = e.target.value;
            e.target.parentElement.style.setProperty('--c', e.target.value);
            e.target.parentElement.title = e.target.value;
            saveFx();
            paintModes();
            reapplySoon();
          },
        })),
      n > 2
        ? h('button', {
            type: 'button',
            class: 'stop-x',
            'aria-label': `Remove color ${i + 1}`,
            onclick: () => {
              state.fx.colors.splice(i, 1);
              stopsChanged();
            },
          }, icon('x'))
        : null),
  );
  if (n < 8) {
    items.push(h('button', {
      type: 'button',
      class: 'add-stop',
      'aria-label': 'Add a color',
      title: 'Add a color',
      onclick: () => {
        state.fx.colors.push(ADD_COLORS.find((c) => !state.fx.colors.includes(c)) ?? '#ffffff');
        stopsChanged();
      },
    }, icon('plus')));
  }
  $('#stops').replaceChildren(...items);
}

function stopsChanged() {
  saveFx();
  renderStops();
  paintModes();
  reapply();
}

const VISIBLE_PRESETS = 6;

function renderPresets() {
  $('#presets').replaceChildren(
    ...PRESETS.map((p, i) =>
      h('button', {
        type: 'button',
        class: i < VISIBLE_PRESETS ? 'preset' : 'preset extra',
        'data-preset': p.id,
        'aria-label': `${p.name} colors`,
        onclick: () => {
          state.fx.colors = p.colors.slice();
          stopsChanged();
          const range = styleRange();
          if (range && !isLive(range)) applyEffect(range);
        },
      }, h('span', { class: 'preset-bar', 'aria-hidden': 'true' }), h('span', { class: 'preset-name' }, p.name)),
    ),
  );
}

function isLive(range) {
  const l = state.lastFx;
  return !!l && l.start === range.start && l.end === range.end && l.text === editor.doc.text;
}

function applyEffect(range = styleRange()) {
  if (!range) {
    const all = editor.doc.text.length;
    toast('Select the text you want to color first.', all ? { action: 'Use all text', run: () => applyEffect({ start: 0, end: all }) } : {});
    return;
  }
  const text = editor.doc.text.slice(range.start, range.end);
  const colors = effectColors(text, { effect: state.fx.effect, colors: state.fx.colors, target: state.target, perLine: state.fx.perLine });
  const target = state.target;
  editor.restyle(range, (st, i) => {
    const c = colors[i - range.start];
    return c === undefined ? st : patchStyle(st, { [target]: c });
  }, `fx:${range.start}:${range.end}`);
  state.lastFx = { ...range, text: editor.doc.text };
}

/** Effect settings changed: update the text the effect was just applied to. */
function reapply() {
  const range = styleRange();
  if (range && isLive(range)) applyEffect(range);
}
const reapplySoon = perFrame(reapply);

function bindEffects() {
  buildModes();
  renderPresets();
  renderStops();
  paintModes();
  $('#per-line').checked = state.fx.perLine;
  $('#per-line').addEventListener('change', (e) => {
    state.fx.perLine = e.target.checked;
    saveFx();
    reapply();
  });
  $('#reverse').addEventListener('click', () => {
    state.fx.colors.reverse();
    stopsChanged();
  });
  $('#apply-fx').addEventListener('click', () => applyEffect());
  const more = $('#more-presets');
  more.textContent = `Show all ${PRESETS.length}`;
  more.addEventListener('click', () => {
    const open = $('#presets').classList.toggle('all');
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? 'Show fewer' : `Show all ${PRESETS.length}`;
  });
}

function updateFxButton() {
  const btn = $('#apply-fx');
  const range = styleRange();
  if (!range) {
    btn.textContent = 'Select text to apply';
    btn.classList.remove('primary');
    return;
  }
  const text = editor.doc.text.slice(range.start, range.end);
  const n = graphemes(text).filter((g) => g.text !== '\n' && (state.target === 'bg' || !/^\s+$/u.test(g.text))).length;
  btn.textContent = `Apply to ${formatNumber(n)} ${n === 1 ? 'character' : 'characters'}`;
  btn.classList.add('primary');
}

// -------------------------------------------------------------- templates

const NEWLINE = { text: '\n', keys: [PLAIN_KEY] };
const concat = (...docs) => ({ text: docs.map((d) => d.text).join(''), keys: docs.flatMap((d) => d.keys) });

function renderTemplates() {
  $('#templates').replaceChildren(
    ...TEMPLATES.filter((t) => !t.hidden).map((t) => {
      const mini = h('span', { class: 'mini', 'aria-hidden': 'true' });
      renderRuns(mini, t.build());
      return h('button', { type: 'button', class: 'tpl', onclick: () => insertTemplate(t) }, h('span', { class: 'tpl-name' }, t.name), mini);
    }),
  );
}

function insertTemplate(t) {
  const piece = D.fromRuns(t.build());
  const doc = editor.doc;
  state.lastFx = null;
  if (!doc.text.trim() || doc.text === WELCOME_TEXT) {
    editor.setDoc(piece);
  } else {
    const { start, end } = editor.sel;
    const parts = [];
    if (start > 0 && doc.text[start - 1] !== '\n') parts.push(NEWLINE);
    parts.push(piece);
    if (end < doc.text.length && doc.text[end] !== '\n') parts.push(NEWLINE);
    editor.insertDoc(concat(...parts), { start, end });
  }
  toast(`Added the ${t.name} template.`, { action: 'Undo', run: () => editor.undo() });
}

// ----------------------------------------------------------------- output

function refreshOutput() {
  const body = encodeRuns(D.toRuns(editor.doc));
  state.body = body;
  state.message = toMessage(body);
  const empty = !editor.doc.text.length;
  const total = empty ? 0 : state.message.length;
  const { codeChars } = measure(body);

  let mode = 'ok';
  let limit = MESSAGE_LIMIT;
  let note = '';
  if (total > NITRO_LIMIT) {
    mode = 'over';
    limit = NITRO_LIMIT;
    note = 'Too long to send. Use fewer colors or less text.';
  } else if (total > MESSAGE_LIMIT) {
    mode = 'nitro';
    limit = NITRO_LIMIT;
    note = 'Over 2,000, so only Nitro can send it.';
  } else if (total > MESSAGE_LIMIT * 0.9) {
    mode = 'near';
    note = 'Close to the limit.';
  } else if (codeChars) {
    note = `Colors use ${formatNumber(codeChars)}.`;
  }
  $('#meter').dataset.state = mode;
  $('#count').textContent = formatNumber(total);
  $('#limit').textContent = limit === NITRO_LIMIT ? `${formatNumber(limit)} with Nitro` : `${formatNumber(limit)} characters`;
  $('#meter-note').textContent = note;
  $('#meter-fill').style.width = `${Math.min(100, (total / limit) * 100)}%`;
  if (!$('#codes').hidden) renderCodes();
}

function renderCodes() {
  const frag = document.createDocumentFragment();
  frag.append(h('span', { class: 'fence' }, '```ansi\n'));
  for (const tok of tokenize(state.body)) {
    if (tok.type === 'code') {
      frag.append(h('span', { class: 'tok', title: describeParams(tok.params) }, h('span', { class: 'tok-esc' }, 'ESC'), `[${tok.params}m`));
    } else {
      const span = document.createElement('span');
      decorate(span, tok.style);
      span.textContent = tok.text;
      frag.append(span);
    }
  }
  frag.append(h('span', { class: 'fence' }, '\n```'));
  $('#codes-body').replaceChildren(frag);
  const { codes, codeChars } = measure(state.body);
  $('#codes-summary').textContent = codes
    ? `${formatNumber(codes)} ${codes === 1 ? 'code uses' : 'codes use'} ${formatNumber(codeChars)} of ${formatNumber(state.message.length)} characters. Point at a code to read it.`
    : 'No codes yet. Color some text and they show up here.';
}

function sweepGradient() {
  const seen = [];
  for (const run of D.toRuns(editor.doc)) {
    const c = run.style.fg ?? run.style.bg;
    if (c == null || !run.text.trim()) continue;
    const hex = typeof c === 'number' ? THEME_HEX[state.theme][textCode(c)] : c;
    if (!seen.includes(hex)) seen.push(hex);
    if (seen.length >= 6) break;
  }
  const cs = seen.length >= 2 ? seen : PRESETS[0].colors;
  return `linear-gradient(90deg, ${cs.join(', ')})`;
}

const COPY_LINES = ['Copied', 'Copied again', 'Triple copy', 'Copy combo', 'Copy legend'];
let copyStreak = 0;
let streakTimer;
let labelTimer;

function celebrateCopy() {
  const btn = $('#copy');
  const label = btn.querySelector('.copy-label');
  copyStreak = Math.min(copyStreak + 1, COPY_LINES.length);
  clearTimeout(streakTimer);
  streakTimer = setTimeout(() => {
    copyStreak = 0;
  }, 4000);
  btn.style.setProperty('--sweep', sweepGradient());
  btn.classList.remove('sweep');
  void btn.offsetWidth;
  btn.classList.add('sweep');
  label.replaceChildren(icon('check'), COPY_LINES[copyStreak - 1]);
  announce('Copied. Paste it into Discord.');
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => {
    btn.classList.remove('sweep');
    label.replaceChildren('Copy for Discord');
  }, 1800);
}

async function copyMessage(formatId = 'discord') {
  if (!editor.doc.text.trim()) {
    toast('Write something first, then copy it.');
    return;
  }
  const f = COPY_FORMATS.find((x) => x.id === formatId) ?? COPY_FORMATS[0];
  const text = f.build(state.message, state.body);
  if (!(await copyText(text))) {
    openManualCopy(text);
    return;
  }
  if (f.id === 'discord') celebrateCopy();
  else toast(`Copied as ${f.label}.`);
  if (state.message.length > MESSAGE_LIMIT && f.id === 'discord') {
    toast(state.message.length > NITRO_LIMIT ? 'Heads up: this is too long for one Discord message.' : 'Heads up: over 2,000 characters, so it needs Nitro.', { tone: 'warn' });
  }
}

function openManualCopy(text) {
  const ta = $('#manual-text');
  ta.value = text;
  $('#manual-dialog').showModal();
  ta.focus();
  ta.select();
}

async function shareLink() {
  if (!editor.doc.text.trim()) {
    toast('Write something first, then share it.');
    return;
  }
  const token = await encodeShare(state.body);
  const url = `${location.href.split('#')[0]}#m=${token}`;
  if (await copyText(url)) toast('Link copied. Anyone who opens it sees this message.');
  else openManualCopy(url);
}

async function openShared() {
  const m = /^#m=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return false;
  try {
    const doc = D.fromRuns(decodeAnsi(await decodeShare(m[1])));
    const hadDraft = editor.doc.text.trim() && editor.doc.text !== WELCOME_TEXT;
    state.lastFx = null;
    editor.setDoc(doc, { record: true });
    history.replaceState(null, '', location.pathname + location.search);
    toast(hadDraft ? 'Opened a shared message. Undo brings back your draft.' : 'Opened a shared message.', hadDraft ? { action: 'Undo', run: () => editor.undo() } : {});
    return true;
  } catch {
    toast('This share link is incomplete. Ask the person who sent it for a new one.', { tone: 'warn' });
    return false;
  }
}

// ---------------------------------------------------------- selection UI

function updateSelectionUI() {
  const { start, end } = editor.sel;
  const info = start !== end ? D.summarize(editor.doc, start, end) : editor.typingStyle();
  for (const flag of ['b', 'i', 'u', 's']) $(`.tool[data-cmd="${flag}"]`).setAttribute('aria-pressed', String(!!info?.[flag]));
  const current = info ? info[state.target] : undefined;
  for (const b of $$('.sw[data-color]')) b.setAttribute('aria-pressed', String(current != null && String(current) === b.dataset.color));
  if (typeof current === 'string' && start !== end && document.activeElement !== $('#hex')) setPicker(current);
  updateFxButton();
}

// ------------------------------------------------------------------ setup

function bindToolbar() {
  for (const b of $$('.toolbar [data-cmd]')) b.addEventListener('click', () => runCommand(b.dataset.cmd));
  editor.addEventListener('command', (e) => runCommand(e.detail.name));
  editor.addEventListener('history', (e) => {
    $('.tool[data-cmd="undo"]').disabled = !e.detail.canUndo;
    $('.tool[data-cmd="redo"]').disabled = !e.detail.canRedo;
  });

  menu($('#more'), {
    label: 'More actions',
    items: () => [
      { label: 'Import a message', hint: 'From Discord, a bot or a terminal', run: openImport },
      { label: 'Select all', kbd: 'Ctrl A', run: () => { editor.focus(); editor.select(0, editor.doc.text.length); } },
      { separator: true },
      { label: 'Start over', hint: 'Clears the editor', run: () => {
        state.lastFx = null;
        editor.setDoc(D.EMPTY);
        editor.focus();
        toast('Cleared.', { action: 'Undo', run: () => editor.undo() });
      } },
      { label: 'Bring back the welcome text', run: () => {
        editor.setDoc(welcomeDoc());
        toast('The welcome text is back.', { action: 'Undo', run: () => editor.undo() });
      } },
      { separator: true },
      { label: 'Keyboard shortcuts', kbd: '?', run: () => $('#keys-dialog').showModal() },
    ],
  });

  menu($('#copy-more'), {
    label: 'Copy formats',
    items: () => COPY_FORMATS.map((f) => ({ label: f.label, hint: f.hint, run: () => copyMessage(f.id) })),
  });
}

function openImport() {
  $('#import-text').value = '';
  $('#import-error').hidden = true;
  $('#import-dialog').showModal();
}

function bindDialogs() {
  $('#import-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const doc = D.fromRuns(importText($('#import-text').value));
    if (!doc.text) {
      const err = $('#import-error');
      err.textContent = 'Nothing to import yet. Paste a colored message or a bot string first.';
      err.hidden = false;
      return;
    }
    $('#import-dialog').close();
    state.lastFx = null;
    editor.setDoc(doc);
    toast('Imported. Undo brings back what you had.', { action: 'Undo', run: () => editor.undo() });
  });
  $('#import-cancel').addEventListener('click', () => $('#import-dialog').close());
  $('#keys-close').addEventListener('click', () => $('#keys-dialog').close());
  $('#manual-close').addEventListener('click', () => $('#manual-dialog').close());
  for (const d of $$('dialog')) {
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
  }
}

function setTab(id, focus = false) {
  state.tab = id;
  store.set('tab', id);
  for (const t of ['colors', 'effects', 'templates']) {
    const on = t === id;
    const tab = $(`#tab-${t}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`#pane-${t}`).hidden = !on;
  }
  $('#target-wrap').hidden = id === 'templates';
  if (focus) $(`#tab-${id}`).focus();
}

function bindTabs() {
  const tabs = $$('[role=tab]');
  for (const tab of tabs) tab.addEventListener('click', () => setTab(tab.id.slice(4)));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.id.slice(4), true);
  });
}

function bindOutput() {
  $('#copy').addEventListener('click', () => copyMessage('discord'));
  $('#share').addEventListener('click', shareLink);
  const toggle = $('#codes-toggle');
  const setCodes = (open) => {
    $('#codes').hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('span').textContent = open ? 'Hide codes' : 'Show codes';
    if (open) renderCodes();
  };
  toggle.addEventListener('click', () => {
    const open = $('#codes').hidden;
    setCodes(open);
    store.set('codes', open);
  });
  setCodes(!!store.get('codes', false));
}

function keepEditorFocus() {
  // Clicking a panel button with the mouse shouldn't steal the caret from the
  // editor. Touch is left alone so the on-screen keyboard can close.
  let pointer = 'mouse';
  document.addEventListener('pointerdown', (e) => {
    pointer = e.pointerType;
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (pointer !== 'mouse' || !editor.focused) return;
    if (e.target.closest('.studio button')) e.preventDefault();
  }, true);
}

function updateTime() {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#msg-time').textContent = `Today at ${time}`;
}

function playIntro() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const spans = [...editorEl.children];
  spans.forEach((s, i) => s.style.setProperty('--i', String(i)));
  editorEl.classList.add('develop');
  setTimeout(() => editorEl.classList.remove('develop'), 1100 + spans.length * 22);
}

async function boot() {
  document.body.dataset.theme = state.theme;
  buildThemes();
  setTheme(state.theme);
  for (const b of $$('#target [role=radio]')) b.addEventListener('click', () => setTarget(b.dataset.target));
  arrowKeys($('#target'), '[role=radio]');
  bindToolbar();
  bindColors();
  bindEffects();
  bindTabs();
  bindOutput();
  bindDialogs();
  keepEditorFocus();
  renderTemplates();
  renderRecent();
  renderPalette();
  setTarget(state.target);
  setTab(state.tab);
  setPicker('#ff8a3d');
  updateTime();
  setInterval(updateTime, 30000);

  const refreshSoon = perFrame(refreshOutput);
  const selectionSoon = perFrame(updateSelectionUI);
  const save = debounce(() => store.set('doc', D.serialize(editor.doc)), 400);
  editor.addEventListener('change', () => {
    refreshSoon();
    save();
  });
  editor.addEventListener('selection', selectionSoon);
  editor.addEventListener('paste', (e) => {
    if (e.detail.source === 'ansi') toast('Pasted with its colors.');
  });

  const saved = D.deserialize(store.get('doc', null));
  const firstVisit = !store.get('seen', false);
  editor.setDoc(saved.text ? saved : welcomeDoc(), { record: false });
  const shared = await openShared();
  if (!shared && firstVisit && !saved.text) playIntro();
  store.set('seen', true);
  refreshOutput();
  updateSelectionUI();

  window.addEventListener('hashchange', openShared);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    // Panel buttons change the editor, so undo works while one of them has focus.
    if (mod && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault();
      if (k === 'z' && !e.shiftKey) editor.undo();
      else editor.redo();
    } else if (mod && k === 'enter') {
      e.preventDefault();
      copyMessage('discord');
    } else if (e.key === '?' && !mod && !e.altKey) {
      e.preventDefault();
      $('#keys-dialog').showModal();
    }
  });
}

boot();

// A tiny handle for tests, bookmarklets and the curious.
window.chromacord = {
  editor,
  get message() {
    return state.message;
  },
  get body() {
    return state.body;
  },
  load(raw) {
    editor.setDoc(D.fromRuns(importText(raw)));
  },
};
