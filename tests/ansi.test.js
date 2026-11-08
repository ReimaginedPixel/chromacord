import test from 'node:test';
import assert from 'node:assert/strict';

import { makeStyle, keyOf, styleOf, normalizeKey, PLAIN_KEY } from '../assets/js/core/style.js';
import {
  ESC,
  encodeRuns,
  decodeAnsi,
  importText,
  normalizeImport,
  looksLikeAnsi,
  toMessage,
  toStringLiteral,
  measure,
  COPY_FORMATS,
  describeParams,
} from '../assets/js/core/ansi.js';
import { fromRuns, toRuns } from '../assets/js/core/doc.js';
import { TEMPLATES } from '../assets/js/data/templates.js';

const r = (text, style = {}) => ({ text, style: makeStyle(style) });
const enc = (...runs) => encodeRuns(runs);
const show = (s) => s.replaceAll(ESC, '\\e');

test('plain text needs no codes', () => {
  assert.equal(enc(r('hello world')), 'hello world');
});

test('a lone color restates itself after a reset', () => {
  assert.equal(show(enc(r('Red', { fg: 31 }), r(' plain'))), '\\e[0;31mRed\\e[0m plain');
});

test('several new properties combine into one code', () => {
  assert.equal(show(enc(r('Hi', { b: true, fg: 32 }))), '\\e[1;32mHi');
  assert.equal(show(enc(r('Hi', { b: true, u: true, fg: '#7c86ff' }))), '\\e[1;4;38;2;124;134;255mHi');
});

test('custom colors use 38;2 and 48;2', () => {
  assert.equal(show(enc(r('x', { fg: '#ff0000', bg: '#000080' }))), '\\e[38;2;255;0;0;48;2;0;0;128mx');
});

test('changing only the color skips the reset', () => {
  assert.equal(show(enc(r('a', { fg: '#ff0000' }), r('b', { fg: '#00ff00' }))), '\\e[38;2;255;0;0ma\\e[38;2;0;255;0mb');
});

test('switching a property off resets and restates', () => {
  assert.equal(show(enc(r('a', { b: true, fg: 31 }), r('b', { fg: 31 }))), '\\e[1;31ma\\e[0;31mb');
});

test('spaces and line breaks keep the current color', () => {
  assert.equal(show(enc(r('A', { fg: 31 }), r(' '), r('B', { fg: 31 }))), '\\e[0;31mA B');
  assert.equal(show(enc(r('A', { fg: 31 }), r('\n'), r('B', { fg: 31 }))), '\\e[0;31mA\nB');
});

test('spaces still break a background, underline or strike', () => {
  assert.equal(show(enc(r('A', { u: true }), r(' '), r('B', { u: true }))), '\\e[0;4mA\\e[0m \\e[0;4mB');
  assert.equal(show(enc(r('A', { bg: 41 }), r(' '), r('B', { bg: 41 }))), '\\e[0;41mA\\e[0m \\e[0;41mB');
});

test('never emits a single non-reset parameter', () => {
  const runs = TEMPLATES.flatMap((tpl) => tpl.build());
  const body = encodeRuns(runs);
  for (const m of body.matchAll(/\u001b\[(\d+)m/g)) assert.equal(m[1], '0', `found ${m[0]}`);
});

test('message wraps the body and blocks early fences', () => {
  const msg = toMessage(encodeRuns([r('a ``` b')]));
  assert.ok(msg.startsWith('```ansi\n'));
  assert.ok(msg.endsWith('\n```'));
  assert.equal(msg.slice(8, -4).includes('```'), false);
  assert.deepEqual(importText(msg).map((x) => x.text).join(''), 'a ``` b');
});

test('measure counts codes', () => {
  const body = enc(r('a', { fg: 31 }), r('b', { fg: 32 }));
  const m = measure(body);
  assert.equal(m.codes, 2);
  assert.equal(m.codeChars, body.length - 2);
});

// Visible equivalence: what Discord would draw for each character.
function visible(doc) {
  return [...doc.text].map((ch, i) => {
    if (ch === '\n') return 'br';
    const st = styleOf(doc.keys[i]);
    if (/\s/.test(ch)) return `sp|${st.bg}|${st.u}|${st.s}|${st.u || st.s ? st.fg : ''}`;
    return keyOf(st);
  });
}

function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

test('round trip keeps every visible style (fuzz)', () => {
  const rand = seeded(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const fgs = [null, null, 31, 37, '#ff8800', '#00ccff'];
  const bgs = [null, null, null, 41, 44, '#202060'];
  for (let round = 0; round < 400; round += 1) {
    const runs = [];
    const n = 1 + Math.floor(rand() * 12);
    for (let i = 0; i < n; i += 1) {
      const len = 1 + Math.floor(rand() * 4);
      let text = '';
      for (let j = 0; j < len; j += 1) text += pick(['a', 'b', ' ', ' ', '\n', 'Z', '\u00e9']);
      runs.push(r(text, { b: rand() < 0.3, i: rand() < 0.2, u: rand() < 0.2, s: rand() < 0.15, fg: pick(fgs), bg: pick(bgs) }));
    }
    const doc = fromRuns(runs);
    const back = fromRuns(decodeAnsi(encodeRuns(toRuns(doc))));
    assert.equal(back.text, doc.text);
    assert.deepEqual(visible(back), visible(doc), `round ${round}`);
  }
});

test('decodes the example from the kkrypt0nn guide', () => {
  const a = importText('\\u001b[0;40m\\u001b[1;32mThat\'s some cool formatted text right?\\u001b[0m');
  const b = importText('\\u001b[1;40;32mThat\'s some cool formatted text right?\\u001b[0m');
  for (const runs of [a, b]) {
    assert.equal(runs.length, 1);
    assert.deepEqual({ ...runs[0].style }, { b: true, i: false, u: false, s: false, fg: 32, bg: 40 });
  }
});

test('decodes Rebane style output with filler codes', () => {
  const src = 'Simple app to make \\u001b[48;2;59;61;78m\\u001b[2;3;2m\\u001b[38;2;255;0;0mc\\u001b[0m \\u001b[48;2;88;101;242m\\u001b[38;2;255;255;255m\\u001b[2;1;2mDiscord\\u001b[0m text';
  const runs = importText(src);
  const c = runs.find((x) => x.text === 'c');
  assert.deepEqual({ ...c.style }, { b: false, i: true, u: false, s: false, fg: '#ff0000', bg: '#3b3d4e' });
  const d = runs.find((x) => x.text === 'Discord');
  assert.deepEqual({ ...d.style }, { b: true, i: false, u: false, s: false, fg: '#ffffff', bg: '#5865f2' });
  assert.equal(runs.map((x) => x.text).join(''), 'Simple app to make c Discord text');
});

test('decodes terminal output: bright, 256 color, colon form, other escapes', () => {
  const runs = decodeAnsi(`${ESC}[91mA${ESC}[38;5;196mB${ESC}[38;5;4mC${ESC}[38:2::255:128:0mD${ESC}[2K${ESC}]0;title\u0007E\r\n`);
  assert.equal(runs.map((x) => x.text).join(''), 'ABCDE\n');
  const fg = (ch) => runs.find((x) => x.text.includes(ch)).style.fg;
  assert.equal(fg('A'), 91);
  assert.equal(fg('B'), '#ff0000');
  assert.equal(fg('C'), 34);
  assert.equal(fg('D'), '#ff8000');
});

// Discord draws 90-97 and 100-107 in their own theme colors, so they must not
// turn into the classic ones on the way in.
test('bright colors stay bright when decoding', () => {
  const style = (src) => ({ ...decodeAnsi(`${src}x`)[0].style });
  assert.deepEqual(style(`${ESC}[90;107m`), { ...style(''), fg: 90, bg: 107 });
  assert.deepEqual(style(`${ESC}[1;97;100m`), { ...style(''), b: true, fg: 97, bg: 100 });
  assert.equal(style(`${ESC}[91m${ESC}[39m`).fg, null);
});

test('256 color entries 0-7 are classic and 8-15 are bright', () => {
  const style = (src) => decodeAnsi(`${src}x`)[0].style;
  assert.equal(style(`${ESC}[38;5;1m`).fg, 31);
  assert.equal(style(`${ESC}[38;5;8m`).fg, 90);
  assert.equal(style(`${ESC}[38;5;9m`).fg, 91);
  assert.equal(style(`${ESC}[38;5;15m`).fg, 97);
  assert.equal(style(`${ESC}[48;5;4m`).bg, 44);
  assert.equal(style(`${ESC}[48;5;12m`).bg, 104);
  assert.equal(style(`${ESC}[38:5:11m`).fg, 93);
});

test('bright colors survive an encode and decode round trip', () => {
  const runs = [r('a', { fg: 91 }), r('b', { fg: 97, bg: 104 }), r('c', { b: true, fg: 31, bg: 100 }), r('d')];
  const body = encodeRuns(runs);
  assert.equal(show(body), '\\e[0;91ma\\e[97;104mb\\e[1;31;100mc\\e[0md');
  assert.deepEqual(
    decodeAnsi(body).map((x) => [x.text, keyOf(x.style)]),
    runs.map((x) => [x.text, keyOf(x.style)]),
  );
});

test('import understands literals, code lines, caret notation and fences', () => {
  const want = `${ESC}[31mHi\nthere`;
  assert.equal(normalizeImport('"\\u001b[31mHi\\nthere"'), want);
  assert.equal(normalizeImport("await channel.send('\\x1b[31mHi\\nthere');"), want);
  assert.equal(normalizeImport('^[[31mHi\nthere'), want);
  assert.equal(normalizeImport('\u241b[31mHi\nthere'), want);
  assert.equal(normalizeImport(`\`\`\`ansi\n${ESC}[31mHi\nthere\n\`\`\``), want);
  assert.equal(normalizeImport(`Look:\n\`\`\`ansi\n${ESC}[31mHi\nthere\n\`\`\``), want);
  assert.equal(normalizeImport('plain C:\\new folder'), 'plain C:\\new folder');
});

test('looksLikeAnsi', () => {
  assert.ok(looksLikeAnsi(`${ESC}[0;31mx`));
  assert.ok(looksLikeAnsi('"\\u001b[31mx"'));
  assert.ok(looksLikeAnsi('```ansi\nhello\n```'));
  assert.equal(looksLikeAnsi('just text [31m'), false);
});

test('string literal is valid JSON and has no raw escape character', () => {
  const msg = toMessage(encodeRuns([r('Quote " and \\ and\ttab', { fg: '#ff0000' }), r('\nline\u2028')]));
  const lit = toStringLiteral(msg);
  assert.equal(lit.includes(ESC), false);
  assert.ok(lit.includes('\\u001b['));
  assert.equal(JSON.parse(lit), msg);
  for (const f of COPY_FORMATS) assert.equal(typeof f.build(msg, 'body'), 'string');
  assert.equal(JSON.parse(COPY_FORMATS.find((f) => f.id === 'webhook').build(msg)).content, msg);
});

test('style keys survive untrusted input', () => {
  assert.equal(normalizeKey('1000|31|'), '1000|31|');
  assert.equal(normalizeKey('1111|#FFAA00|47'), '1111|#ffaa00|47');
  assert.equal(normalizeKey('garbage'), PLAIN_KEY);
  assert.equal(normalizeKey('0000|41|31'), PLAIN_KEY); // codes in the wrong slot are dropped
  assert.equal(normalizeKey('0000|91|104'), '0000|91|104');
  assert.equal(normalizeKey('0000|101|91'), PLAIN_KEY);
  assert.equal(normalizeKey('0000|38|'), PLAIN_KEY);
  assert.equal(normalizeKey('0000|98|108'), PLAIN_KEY);
  assert.equal(normalizeKey('0000|<script>|'), PLAIN_KEY);
});

test('describeParams reads codes in plain words', () => {
  assert.equal(describeParams('0;1;31'), 'Reset, bold, text color 31');
  assert.equal(describeParams('38;2;255;0;0'), 'Text rgb(255, 0, 0)');
  assert.equal(describeParams('0;91;104'), 'Reset, bright text color 91, bright background 104');
});

test('templates stay well under the message limit', () => {
  for (const tpl of TEMPLATES) {
    const len = toMessage(encodeRuns(tpl.build())).length;
    assert.ok(len < 2000, `${tpl.id} is ${len} characters`);
  }
});
