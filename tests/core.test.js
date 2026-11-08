import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeHex, hexToRgb, rgbToHex, mixHex, sampleStops, rgbToOklab, oklabToRgb, contrast, readableOn, oklchToHex, xterm256 } from '../assets/js/core/color.js';
import { effectColors, graphemes } from '../assets/js/core/effects.js';
import { fromRuns, toRuns, replaceRange, mapStyles, summarize, wordAt, cleanText, serialize, deserialize } from '../assets/js/core/doc.js';
import { makeStyle, keyOf, patchStyle, textCode } from '../assets/js/core/style.js';
import { BRIGHT, CLASSIC, THEMES, THEME_HEX } from '../assets/js/data/palettes.js';
import { encodeShare, decodeShare } from '../assets/js/core/share.js';

test('styles take classic and bright theme colors in the right slot', () => {
  assert.deepEqual([makeStyle({ fg: 91 }).fg, makeStyle({ fg: '97' }).fg, makeStyle({ bg: 100 }).bg, makeStyle({ bg: 47 }).bg], [91, 97, 100, 47]);
  assert.deepEqual([makeStyle({ fg: 89 }).fg, makeStyle({ fg: 98 }).fg, makeStyle({ fg: 101 }).fg, makeStyle({ bg: 97 }).bg, makeStyle({ bg: 108 }).bg], [null, null, null, null, null]);
  assert.equal(makeStyle({ fg: 91.5 }).fg, null);
});

test('textCode maps backgrounds to their text code', () => {
  assert.deepEqual([31, 41, 91, 101, 37, 47, 97, 107].map(textCode), [31, 31, 91, 91, 37, 37, 97, 97]);
});

test('every theme has a hex for each classic and bright slot, matching the CSS', () => {
  const css = readFileSync(new URL('../assets/css/app.css', import.meta.url), 'utf8');
  for (const { id } of THEMES) {
    const block = css.slice(css.indexOf(`[data-theme='${id}'] {`)).split('}')[0];
    for (const { code } of [...CLASSIC, ...BRIGHT]) {
      assert.match(THEME_HEX[id][code], /^#[0-9a-f]{6}$/, `${id} ${code}`);
      assert.ok(block.includes(`--ansi-${code}:`), `app.css has no --ansi-${code} for ${id}`);
    }
    for (const { code } of BRIGHT) assert.ok(block.includes(`--ansi-${code}: ${THEME_HEX[id][code]};`), `${id} ${code}`);
  }
  // Ash, from .theme-dark in Discord's CSS
  assert.equal(THEME_HEX.ash[31], '#ec6361');
  assert.equal(THEME_HEX.ash[91], '#ff938e');
});

test('normalizeHex', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('ff8800'), '#ff8800');
  assert.equal(normalizeHex(' #FF8800 '), '#ff8800');
  assert.equal(normalizeHex('#ff88'), null);
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex(null), null);
});

test('hex and OKLab round trips', () => {
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#7c86ff', '#123456']) {
    assert.equal(rgbToHex(hexToRgb(hex)), hex);
    const back = rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))));
    assert.equal(back, hex);
  }
});

test('mixing hits both ends and stays in range', () => {
  assert.equal(mixHex('#ff0000', '#0000ff', 0), '#ff0000');
  assert.equal(mixHex('#ff0000', '#0000ff', 1), '#0000ff');
  assert.match(mixHex('#ff0000', '#0000ff', 0.5), /^#[0-9a-f]{6}$/);
  assert.equal(sampleStops(['#000000', '#ffffff', '#ff0000'], 0.5), '#ffffff');
});

test('contrast helpers', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(readableOn('#ffff00'), '#000000');
  assert.equal(readableOn('#000080'), '#ffffff');
  assert.match(oklchToHex(0.7, 0.4, 140), /^#[0-9a-f]{6}$/);
  assert.equal(xterm256(196), '#ff0000');
  assert.equal(xterm256(232), '#080808');
});

test('gradient starts and ends on the given colors and skips spaces', () => {
  const cs = effectColors('ab cd', { effect: 'gradient', colors: ['#ff0000', '#0000ff'] });
  assert.equal(cs[0], '#ff0000');
  assert.equal(cs[4], '#0000ff');
  assert.equal(cs[2], cs[1]); // the space borrows its neighbour
});

test('background effects paint spaces too', () => {
  const cs = effectColors('a b', { effect: 'bands', colors: ['#111111', '#222222', '#333333'], target: 'bg' });
  assert.deepEqual(cs, ['#111111', '#222222', '#333333']);
});

test('alternate, bands, words and mirror', () => {
  const c = ['#ff0000', '#00ff00'];
  assert.deepEqual(effectColors('abcd', { effect: 'alternate', colors: c }), ['#ff0000', '#00ff00', '#ff0000', '#00ff00']);
  assert.deepEqual(effectColors('abcd', { effect: 'bands', colors: c }), ['#ff0000', '#ff0000', '#00ff00', '#00ff00']);
  assert.deepEqual(effectColors('ab cd ef', { effect: 'words', colors: c }), ['#ff0000', '#ff0000', '#ff0000', '#00ff00', '#00ff00', '#00ff00', '#ff0000', '#ff0000']);
  const m = effectColors('abcde', { effect: 'mirror', colors: c });
  assert.equal(m[0], '#ff0000');
  assert.equal(m[2], '#00ff00');
  assert.equal(m[4], '#ff0000');
});

test('word mode leaves the gaps clear on backgrounds', () => {
  const cs = effectColors('ab cd', { effect: 'words', colors: ['#ff0000', '#00ff00'], target: 'bg' });
  assert.deepEqual(cs, ['#ff0000', '#ff0000', null, '#00ff00', '#00ff00']);
});

test('per line restarts the pattern', () => {
  const cs = effectColors('ab\ncd', { effect: 'gradient', colors: ['#ff0000', '#0000ff'], perLine: true });
  assert.equal(cs[0], '#ff0000');
  assert.equal(cs[1], '#0000ff');
  assert.equal(cs[3], '#ff0000');
  assert.equal(cs[4], '#0000ff');
});

test('emoji keep one color across their code units', () => {
  const text = 'a\u{1F600}b';
  const cs = effectColors(text, { effect: 'alternate', colors: ['#ff0000', '#00ff00'] });
  assert.equal(cs.length, text.length);
  assert.equal(cs[1], cs[2]);
  assert.equal(graphemes(text).length, 3);
});

test('random uses the given random source', () => {
  const cs = effectColors('abc', { effect: 'random', colors: ['#ff0000', '#00ff00'], random: () => 0.99 });
  assert.deepEqual(cs, ['#00ff00', '#00ff00', '#00ff00']);
});

test('document edits', () => {
  const red = keyOf(makeStyle({ fg: 31 }));
  let doc = fromRuns([{ text: 'Hello', style: makeStyle({ fg: 31 }) }, { text: ' world', style: makeStyle() }]);
  assert.equal(toRuns(doc).length, 2);
  doc = replaceRange(doc, 5, 5, '!', red);
  assert.equal(doc.text, 'Hello! world');
  assert.equal(toRuns(doc)[0].text, 'Hello!');
  doc = mapStyles(doc, 0, doc.text.length, (st) => patchStyle(st, { b: true }));
  const sum = summarize(doc, 0, doc.text.length);
  assert.equal(sum.b, true);
  assert.equal(sum.fg, undefined);
  assert.equal(summarize(doc, 0, 3).fg, 31);
  assert.deepEqual(wordAt(doc.text, 2), { start: 0, end: 6 });
  assert.equal(wordAt('a  b', 2), null);
});

test('cleanText drops control characters but keeps tabs and line breaks', () => {
  assert.equal(cleanText('a\u001b[31mb\r\nc\td\u0007'), 'a[31mb\nc\td');
});

test('serialize and deserialize', () => {
  const doc = fromRuns([{ text: 'ab', style: makeStyle({ b: true }) }, { text: 'c', style: makeStyle({ bg: '#123456' }) }]);
  assert.deepEqual(deserialize(JSON.parse(JSON.stringify(serialize(doc)))), doc);
  assert.deepEqual(deserialize('nope').text, '');
});

test('share links round trip', async () => {
  const body = '\u001b[1;31mHello \u001b[38;2;1;2;3mworld \u{1F600}\n'.repeat(20);
  const token = await encodeShare(body);
  assert.match(token, /^[zp][A-Za-z0-9_-]+$/);
  assert.equal(await decodeShare(token), body);
  assert.ok(token.length < body.length, 'compressed');
});
