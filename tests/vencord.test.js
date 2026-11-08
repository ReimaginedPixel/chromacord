import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, cssOf, cssColor, PLAIN } from '../vencord/chromacord/tokenize.js';
import { colorBody, colorMessage, colorRuns, plainText, PLUGIN_EFFECTS } from '../vencord/chromacord/colorize.js';
import { encodeRuns, toMessage } from '../assets/js/core/ansi.js';
import { makeStyle } from '../assets/js/core/style.js';
import { TEMPLATES } from '../assets/js/data/templates.js';
import { PRESETS } from '../assets/js/data/palettes.js';

const E = '\u001b';
const one = (input) => {
  const tokens = tokenize(input);
  assert.equal(tokens.length, 1, `expected one token, got ${JSON.stringify(tokens)}`);
  return tokens[0];
};
const styled = (patch) => ({ ...PLAIN, ...patch });

// --- tokenize: what Discord shows ----------------------------------------

test('plain text is one unstyled token', () => {
  assert.deepEqual(tokenize('hello\nworld'), [{ text: 'hello\nworld', style: PLAIN }]);
  assert.deepEqual(tokenize(''), []);
});

test('classic colors and backgrounds become theme indexes', () => {
  assert.deepEqual(one(`${E}[0;31mRed`).style, styled({ fg: 1 }));
  assert.deepEqual(one(`${E}[1;44;37mx`).style, styled({ bold: true, bg: 4, fg: 7 }));
});

test('bright colors keep their own theme slot', () => {
  assert.deepEqual(one(`${E}[91;104mx`).style, styled({ fg: 9, bg: 12 }));
});

test('24-bit and 256 colors', () => {
  assert.deepEqual(one(`${E}[38;2;124;134;255;48;2;0;0;128mx`).style, styled({ fg: '#7c86ff', bg: '#000080' }));
  assert.equal(one(`${E}[38;5;1mx`).style.fg, 1);
  assert.equal(one(`${E}[38;5;196mx`).style.fg, '#ff0000');
  assert.equal(one(`${E}[38;5;244mx`).style.fg, '#808080');
  assert.equal(one(`${E}[38;2;300;0;0mx`).style.fg, '#ff0000');
});

test('a 256 color outside the table clears the color, like Discord', () => {
  assert.equal(one(`${E}[31m${E}[38;5;300mx`).style.fg, null);
});

test('an incomplete color is ignored', () => {
  assert.equal(one(`${E}[31m${E}[38;2;1;2mx`).style.fg, 1);
  assert.equal(one(`${E}[31m${E}[38;9mx`).style.fg, 1);
});

test('ESC[m without a number changes nothing', () => {
  assert.deepEqual(one(`${E}[31mred${E}[mstill`).style, styled({ fg: 1 }));
});

test('resets apply before the rest of the sequence', () => {
  assert.deepEqual(one(`${E}[1;4m${E}[31;0mx`).style, styled({ fg: 1 }));
});

test('decorations switch on and off', () => {
  const [a, b, c] = tokenize(`${E}[1;3;4;9;53ma${E}[21;23mb${E}[22;24;29;55mc`);
  assert.deepEqual(a.style, styled({ bold: true, italic: true, underline: true, strike: true, overline: true }));
  assert.deepEqual(b.style, styled({ underline: true, strike: true, overline: true }));
  assert.deepEqual(c.style, PLAIN);
});

test('codes Discord does not show are skipped', () => {
  assert.deepEqual(one(`${E}[2;5;7;8;31mx`).style, styled({ fg: 1 }));
});

test('other escape sequences are removed from the text', () => {
  assert.deepEqual(tokenize(`a${E}[2Kb${E}[?25lc${E}[?1md${E}[1 me`), [{ text: 'abcde', style: PLAIN }]);
});

test('39 and 49 reset only their color', () => {
  const [, b, c] = tokenize(`${E}[1;31;42ma${E}[39mb${E}[49mc`);
  assert.deepEqual(b.style, styled({ bold: true, bg: 2 }));
  assert.deepEqual(c.style, styled({ bold: true }));
});

test('neighbours with the same style merge', () => {
  assert.deepEqual(tokenize(`${E}[31ma${E}[31mb${E}[0mc`), [
    { text: 'ab', style: styled({ fg: 1 }) },
    { text: 'c', style: PLAIN },
  ]);
});

test('theme colors use Discord variables with a fallback', () => {
  assert.equal(cssColor(1), 'var(--ansi-red, #de464a)');
  assert.equal(cssColor(9), 'var(--ansi-bright-red, #de464a)');
  assert.equal(cssColor(0), 'var(--ansi-black, #000000)');
  assert.equal(cssColor('#123456'), '#123456');
});

test('cssOf sets the same properties Discord does', () => {
  assert.deepEqual(cssOf(PLAIN), {});
  assert.deepEqual(cssOf(styled({ fg: 3, bg: '#000080', bold: true, italic: true, underline: true, strike: true, overline: true })), {
    color: 'var(--ansi-yellow, #b36c00)',
    backgroundColor: '#000080',
    fontWeight: 'bold',
    fontStyle: 'italic',
    textDecorationLine: 'underline line-through overline',
  });
});

// The plugin has to show every message Chromacord writes as Chromacord meant it.
test('every template reads back with its own text and styles', () => {
  for (const tpl of TEMPLATES) {
    const runs = tpl.build();
    const want = [];
    for (const run of runs) for (const ch of run.text) want.push([ch, run.style]);
    const got = [];
    for (const tok of tokenize(encodeRuns(runs))) for (const ch of tok.text) got.push([ch, tok.style]);
    assert.equal(got.map((g) => g[0]).join(''), want.map((w) => w[0]).join(''), tpl.id);
    got.forEach(([ch, st], k) => {
      if (/\s/.test(ch)) return; // the encoder may skip codes on spaces
      const w = want[k][1];
      const theme = (c, base) => (typeof c === 'number' ? c - base : c);
      assert.deepEqual(
        [st.fg, st.bg, st.bold, st.italic, st.underline, st.strike],
        [theme(w.fg, 30), theme(w.bg, 40), w.b, w.i, w.u, w.s],
        `${tpl.id} at ${k} (${ch})`,
      );
    });
  }
});

// --- colorize: what the chat bar tool writes -------------------------------

test('one classic color', () => {
  assert.equal(colorMessage('Hello', { color: 31 }), `\`\`\`ansi\n${E}[0;31mHello\n\`\`\``);
});

test('classic colors move to 40-47 for backgrounds', () => {
  assert.equal(colorBody('Hi', { color: 34, target: 'bg' }), `${E}[0;44mHi`);
});

test('a custom color with formatting', () => {
  assert.equal(colorBody('Hi', { color: '#7c86ff', b: true, u: true }), `${E}[1;4;38;2;124;134;255mHi`);
  assert.equal(colorBody('Hi', { b: true }), `${E}[0;1mHi`);
});

test('a gradient preset reads back with its first and last color', () => {
  const sunset = PRESETS.find((p) => p.id === 'sunset').colors;
  const tokens = tokenize(colorBody('Sunset glow', { preset: 'sunset' }));
  assert.equal(tokens.map((t) => t.text).join(''), 'Sunset glow');
  assert.equal(tokens[0].style.fg, sunset[0]);
  assert.equal(tokens[tokens.length - 1].style.fg, sunset[1]);
});

test('other effects work and random is left out', () => {
  assert.ok(!PLUGIN_EFFECTS.some((e) => e.id === 'random'));
  const tokens = tokenize(colorBody('one two', { preset: 'pride', effect: 'words' }));
  const pride = PRESETS.find((p) => p.id === 'pride').colors;
  assert.equal(tokens[0].style.fg, pride[0]);
  assert.equal(tokens[tokens.length - 1].style.fg, pride[1]);
});

test('runs keep surrogate pairs together', () => {
  const runs = colorRuns('a😀b', { preset: 'rainbow' });
  assert.equal(runs.map((r) => r.text).join(''), 'a😀b');
  assert.ok(runs.every((r) => !/^[\udc00-\udfff]/.test(r.text)));
});

test('the message stays valid with backticks inside', () => {
  const msg = colorMessage('a ``` b', { color: 32 });
  assert.equal((msg.match(/```/g) || []).length, 2);
});

test('plainText turns colored messages back into their text', () => {
  const msg = toMessage(encodeRuns([{ text: 'Server online', style: makeStyle({ b: true, fg: 32 }) }]));
  assert.equal(plainText(msg), 'Server online');
  assert.equal(plainText('just text'), 'just text');
  assert.equal(plainText('a﻿b'), 'ab');
});
