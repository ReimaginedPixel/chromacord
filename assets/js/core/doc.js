// The document model: the text plus one style key per UTF-16 code unit.
// Documents are treated as immutable, every edit returns a new one, which
// makes undo history a plain list of snapshots.

import { PLAIN_KEY, keyOf, styleOf, normalizeKey } from './style.js';

export const EMPTY = Object.freeze({ text: '', keys: Object.freeze([]) });

/** Strip control characters Discord would show as garbage. Keeps tabs and line breaks. */
export function cleanText(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Build a document from runs: { text, style } or { text, key }. */
export function fromRuns(runs) {
  let text = '';
  const keys = [];
  for (const run of runs) {
    const t = cleanText(run.text ?? '');
    if (!t) continue;
    const key = run.key != null ? normalizeKey(run.key) : keyOf(run.style);
    text += t;
    for (let i = 0; i < t.length; i += 1) keys.push(key);
  }
  return { text, keys };
}

/** Merge equal neighbours into runs: { text, key, style }. */
export function toRuns(doc, start = 0, end = doc.text.length) {
  const runs = [];
  let i = start;
  while (i < end) {
    const key = doc.keys[i];
    let j = i + 1;
    while (j < end && doc.keys[j] === key) j += 1;
    runs.push({ text: doc.text.slice(i, j), key, style: styleOf(key) });
    i = j;
  }
  return runs;
}

/** Replace [start, end) with text. keys is one key for all, or an array. */
export function replaceRange(doc, start, end, text, keys = PLAIN_KEY) {
  const list = typeof keys === 'string' ? new Array(text.length).fill(keys) : keys;
  return {
    text: doc.text.slice(0, start) + text + doc.text.slice(end),
    keys: doc.keys.slice(0, start).concat(list, doc.keys.slice(end)),
  };
}

/** Insert or replace with another document's content. */
export function spliceDoc(doc, start, end, piece) {
  return replaceRange(doc, start, end, piece.text, piece.keys);
}

/** Restyle [start, end). fn(style, index, char) returns the new style. */
export function mapStyles(doc, start, end, fn) {
  const keys = doc.keys.slice();
  for (let i = start; i < end; i += 1) keys[i] = keyOf(fn(styleOf(keys[i]), i, doc.text[i]));
  return { text: doc.text, keys };
}

export function sliceDoc(doc, start, end) {
  return { text: doc.text.slice(start, end), keys: doc.keys.slice(start, end) };
}

/**
 * What the selection has in common, for toolbar states.
 * Flags are true when every visible character has them. fg and bg are the
 * shared color, null for "none", or undefined when the selection is mixed.
 */
export function summarize(doc, start, end) {
  let any = false;
  let b = true;
  let i = true;
  let u = true;
  let s = true;
  let fg;
  let bg;
  let fgMixed = false;
  let bgMixed = false;
  for (let x = start; x < end; x += 1) {
    const ch = doc.text[x];
    if (ch === '\n') continue;
    const st = styleOf(doc.keys[x]);
    any = true;
    b = b && st.b;
    i = i && st.i;
    u = u && st.u;
    s = s && st.s;
    if (!/\s/.test(ch)) {
      if (fg === undefined) fg = st.fg;
      else if (fg !== st.fg) fgMixed = true;
    }
    if (bg === undefined) bg = st.bg;
    else if (bg !== st.bg) bgMixed = true;
  }
  if (!any) return null;
  return { b, i, u, s, fg: fgMixed ? undefined : fg ?? null, bg: bgMixed ? undefined : bg ?? null };
}

/** The word around an offset, or null when the caret sits between spaces. */
export function wordAt(text, offset) {
  const isWord = (c) => c !== undefined && !/\s/.test(c);
  let a = offset;
  let b = offset;
  while (a > 0 && isWord(text[a - 1])) a -= 1;
  while (b < text.length && isWord(text[b])) b += 1;
  return a === b ? null : { start: a, end: b };
}

/** Compact JSON for storage: [[text, key], ...] */
export function serialize(doc) {
  return toRuns(doc).map((r) => [r.text, r.key]);
}

export function deserialize(data) {
  if (!Array.isArray(data)) return EMPTY;
  return fromRuns(data.filter((r) => Array.isArray(r) && typeof r[0] === 'string').map(([text, key]) => ({ text, key: String(key ?? PLAIN_KEY) })));
}
