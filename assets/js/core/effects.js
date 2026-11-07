// Multi-color effects. Each one turns a piece of text plus a list of colors
// into one color per UTF-16 code unit, ready to apply as text or background.
//
// Result entries: a "#rrggbb" string to set, null to remove the color,
// undefined to leave that character alone.

import { normalizeHex, sampleStops } from './color.js';

export const EFFECTS = [
  { id: 'gradient', label: 'Gradient', hint: 'Blend smoothly from the first color to the last' },
  { id: 'mirror', label: 'Mirror', hint: 'Blend to the last color and back again' },
  { id: 'bands', label: 'Bands', hint: 'Split the text into equal blocks, one per color' },
  { id: 'alternate', label: 'Alternate', hint: 'Cycle the colors letter by letter' },
  { id: 'words', label: 'Words', hint: 'Give each word the next color' },
  { id: 'random', label: 'Random', hint: 'Pick a random color for every letter' },
];

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Split text into user-perceived characters, so emoji and accents stay whole. */
export function graphemes(text) {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => ({ index: s.index, text: s.segment }));
  const out = [];
  let i = 0;
  for (const ch of text) {
    out.push({ index: i, text: ch });
    i += ch.length;
  }
  return out;
}

const isSpace = (s) => /^\s+$/u.test(s);
const isBreak = (s) => s === '\n' || s === '\r\n' || s === '\r';

/**
 * @param {string} text
 * @param {object} opts
 * @param {string} opts.effect   one of EFFECTS ids
 * @param {string[]} opts.colors hex colors, at least one
 * @param {'fg'|'bg'} opts.target text color or background
 * @param {boolean} opts.perLine restart the pattern on every line
 * @param {() => number} opts.random random source, for tests
 */
export function effectColors(text, { effect = 'gradient', colors, target = 'fg', perLine = false, random = Math.random } = {}) {
  const out = new Array(text.length).fill(undefined);
  const palette = (colors ?? []).map(normalizeHex).filter(Boolean);
  if (!palette.length || !text) return out;

  const segments = [];
  if (perLine) {
    let start = 0;
    for (const line of text.split('\n')) {
      segments.push({ start, text: line });
      start += line.length + 1;
    }
  } else {
    segments.push({ start: 0, text });
  }
  for (const seg of segments) paint(seg.text, seg.start, out, palette, effect, target, random);
  return out;
}

function paint(text, offset, out, palette, effect, target, random) {
  const gs = graphemes(text);
  const k = palette.length;

  // Which characters take part in the pattern. Spaces show no text color, so
  // they are skipped for text effects. Backgrounds paint spaces too, except in
  // word mode where the gaps between words stay clear.
  const counts = (g) => !isBreak(g.text) && (target === 'bg' ? !(effect === 'words' && isSpace(g.text)) : !isSpace(g.text));
  const counted = gs.filter(counts);
  const n = counted.length;
  if (!n) return;

  const wordOf = new Map();
  let word = -1;
  let inWord = false;
  for (const g of gs) {
    const space = isSpace(g.text) || isBreak(g.text);
    if (!space && !inWord) word += 1;
    inWord = !space;
    if (!space) wordOf.set(g, word);
  }

  const color = new Map();
  counted.forEach((g, idx) => {
    const t = n === 1 ? 0 : idx / (n - 1);
    let c;
    switch (effect) {
      case 'mirror':
        c = sampleStops(palette, 1 - Math.abs(2 * t - 1));
        break;
      case 'bands':
        c = palette[Math.min(k - 1, Math.floor((idx * k) / n))];
        break;
      case 'alternate':
        c = palette[idx % k];
        break;
      case 'words':
        c = palette[(wordOf.get(g) ?? 0) % k];
        break;
      case 'random':
        c = palette[Math.floor(random() * k) % k];
        break;
      default:
        c = sampleStops(palette, t);
    }
    color.set(g, c);
  });

  // Characters outside the pattern borrow the color before them (or the first
  // one), so a colored word and its spaces stay a single run in the output.
  const first = color.get(counted[0]);
  let prev = null;
  for (const g of gs) {
    let c = color.get(g);
    if (c === undefined) {
      if (target === 'bg' && effect === 'words' && isSpace(g.text)) c = null;
      else c = prev ?? first;
    } else {
      prev = c;
    }
    for (let j = 0; j < g.text.length; j += 1) out[offset + g.index + j] = c;
  }
}
