// What the chat bar tool writes: text in one color or a multi-color effect,
// with bold, italic, underline and strikethrough, as an ```ansi message that
// shows in color for everyone, with or without the plugin.

import { encodeRuns, importText, looksLikeAnsi, toMessage } from './lib/ansi.js';
import { effectColors, EFFECTS } from './lib/effects.js';
import { CLASSIC, PRESETS } from './lib/palettes.js';
import { keyOf, makeStyle } from './lib/style.js';

export { CLASSIC, PRESETS };

// Random would reshuffle on every keystroke in the preview.
export const PLUGIN_EFFECTS = EFFECTS.filter((e) => e.id !== 'random');

/** Plain text from whatever is in the chat box. A colored message turns back into its text. */
export function plainText(input) {
  const text = String(input ?? '').replace(/﻿/g, '');
  return looksLikeAnsi(text) ? importText(text).map((r) => r.text).join('') : text;
}

/**
 * Styled runs for the text.
 * @param {string} text
 * @param {object} paint
 * @param {number|string|null} [paint.color] theme text code (30-37 classic, 90-97 bright) or "#rrggbb"
 * @param {string|null} [paint.preset]       id from PRESETS, used instead of color
 * @param {string} [paint.effect]            id from EFFECTS, for presets
 * @param {'fg'|'bg'} [paint.target]         color the text or the background
 * @param {boolean} [paint.b] bold
 * @param {boolean} [paint.i] italic
 * @param {boolean} [paint.u] underline
 * @param {boolean} [paint.s] strikethrough
 */
export function colorRuns(text, { color = null, preset = null, effect = 'gradient', target = 'fg', b = false, i = false, u = false, s = false } = {}) {
  const colors = PRESETS.find((p) => p.id === preset)?.colors;
  const each = colors ? effectColors(text, { effect, colors, target }) : null;
  const solid = typeof color === 'number' && target === 'bg' ? color + 10 : color;

  const runs = [];
  for (let k = 0; k < text.length; k += 1) {
    const style = makeStyle({ b, i, u, s, [target]: each ? each[k] : solid });
    const last = runs[runs.length - 1];
    if (last && keyOf(last.style) === keyOf(style)) last.text += text[k];
    else runs.push({ text: text[k], style });
  }
  return runs;
}

/** The ANSI body (no code fences) for the text. */
export function colorBody(text, paint) {
  return encodeRuns(colorRuns(text, paint));
}

/** The full message, ready for the chat box. */
export function colorMessage(text, paint) {
  return toMessage(colorBody(text, paint));
}
