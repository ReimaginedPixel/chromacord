// How Discord's client reads an ```ansi block, so the plugin shows exactly
// the colors Discord would. It follows the parser Discord ships (Shiki's ANSI
// parser), which differs from a terminal in a few places:
//   - only ESC[...m changes the style, any other escape sequence is dropped
//   - ESC[m without a number changes nothing (terminals reset)
//   - 21 and 22 turn bold off (in terminals 21 is a double underline)
//   - the resets in a sequence apply before the rest, so ESC[31;0m is red
//   - 90-97 and 100-107 are the bright theme colors
//   - dim, reverse, hidden and blink are read but not shown
//
// Colors are a number 0-15 for a theme color (0-7 classic, 8-15 bright) or a
// "#rrggbb" string. Discord draws theme colors with its --ansi-* variables, so
// they follow the reader's theme, high contrast mode and client theme.

import { rgbToHex, xterm256 } from './lib/color.js';
import { THEME_HEX } from './lib/palettes.js';

const CSI = /\u001b\[([0-?]*)([ -/]*)([@-~])/g;

const ON = { 1: 'bold', 3: 'italic', 4: 'underline', 9: 'strike', 53: 'overline' };
const OFF = { 21: 'bold', 22: 'bold', 23: 'italic', 24: 'underline', 29: 'strike', 55: 'overline' };

export const PLAIN = Object.freeze({ fg: null, bg: null, bold: false, italic: false, underline: false, strike: false, overline: false });

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

// Entry n of the 256 color table: 0-15 are theme colors, the rest are fixed.
// Anything else sets "no color", like Discord.
function tableColor(n) {
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  return n < 16 ? n : xterm256(n);
}

// The color after a 38 or 48. undefined means the code is ignored.
function readColor(params) {
  const mode = params.shift();
  if (mode === '2') {
    const rgb = params.splice(0, 3).map((p) => Number.parseInt(p));
    return rgb.length === 3 && !rgb.some(Number.isNaN) ? rgbToHex(rgb) : undefined;
  }
  if (mode === '5') {
    const n = params.shift();
    if (n) return tableColor(Number(n));
  }
  return undefined;
}

function apply(style, params) {
  const resets = [];
  const sets = [];
  while (params.length) {
    const raw = params.shift();
    if (!raw) continue;
    const p = Number.parseInt(raw);
    if (Number.isNaN(p)) continue;
    if (p === 0) resets.push(PLAIN);
    else if (ON[p]) sets.push({ [ON[p]]: true });
    else if (OFF[p]) resets.push({ [OFF[p]]: false });
    else if (p >= 30 && p <= 37) sets.push({ fg: p - 30 });
    else if (p === 38 || p === 48) {
      const color = readColor(params);
      if (color !== undefined) sets.push({ [p === 38 ? 'fg' : 'bg']: color });
    } else if (p === 39) resets.push({ fg: null });
    else if (p >= 40 && p <= 47) sets.push({ bg: p - 40 });
    else if (p === 49) resets.push({ bg: null });
    else if (p >= 90 && p <= 97) sets.push({ fg: p - 90 + 8 });
    else if (p >= 100 && p <= 107) sets.push({ bg: p - 100 + 8 });
  }
  return Object.freeze(Object.assign({}, style, ...resets, ...sets));
}

const same = (a, b) => Object.keys(PLAIN).every((k) => a[k] === b[k]);

/** Split the content of an ansi code block into { text, style } tokens, the way Discord does. */
export function tokenize(input) {
  const text = String(input ?? '');
  const tokens = [];
  let style = PLAIN;
  let pos = 0;
  while (pos < text.length) {
    CSI.lastIndex = pos;
    const m = CSI.exec(text);
    const end = m ? m.index : text.length;
    if (end > pos) {
      const last = tokens[tokens.length - 1];
      if (last && same(last.style, style)) last.text += text.slice(pos, end);
      else tokens.push({ text: text.slice(pos, end), style });
    }
    if (!m) break;
    const [, params, middle, final] = m;
    if (final === 'm' && !middle && !/^[<=>?]/.test(params)) style = apply(style, params.split(';'));
    pos = m.index + m[0].length;
  }
  return tokens;
}

/** CSS color for a token color. Theme colors use Discord's variables, with the Dark theme as fallback. */
export function cssColor(color) {
  if (typeof color === 'string') return color;
  const name = `${color >= 8 ? 'bright-' : ''}${NAMES[color % 8]}`;
  return `var(--ansi-${name}, ${THEME_HEX.dark[(color >= 8 ? 90 : 30) + (color % 8)]})`;
}

/** Inline style for a token, matching the properties Discord sets. */
export function cssOf(style) {
  const css = {};
  if (style.fg != null) css.color = cssColor(style.fg);
  if (style.bg != null) css.backgroundColor = cssColor(style.bg);
  if (style.bold) css.fontWeight = 'bold';
  if (style.italic) css.fontStyle = 'italic';
  const lines = [style.underline && 'underline', style.strike && 'line-through', style.overline && 'overline'].filter(Boolean);
  if (lines.length) css.textDecorationLine = lines.join(' ');
  return css;
}
