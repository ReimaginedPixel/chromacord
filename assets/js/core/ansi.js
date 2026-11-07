// Turning styled runs into a Discord ANSI message, and back.
//
// Discord colors text inside ```ansi code blocks using SGR escape codes:
//   ESC [ <params> m      with ESC = U+001B
//   0 reset, 1 bold, 3 italic, 4 underline, 9 strikethrough
//   30-37 classic text color, 40-47 classic background color
//   38;2;R;G;B custom text color, 48;2;R;G;B custom background color
//
// The encoder writes the shortest sequence it safely can, because every code
// counts toward Discord's 2,000 character limit:
//   - it only emits what changed between two runs,
//   - it resets (0) only when a style has to be switched off,
//   - spaces and line breaks don't trigger codes for properties they can't show.

import { PLAIN, keyOf, makeStyle } from './style.js';
import { hexToRgb, xterm256 } from './color.js';

export const ESC = '\u001b';
export const MESSAGE_LIMIT = 2000;
export const NITRO_LIMIT = 4000;

const SGR = /\u001b\[([0-9;:]*)m/g;

function colorParam(color, base) {
  if (typeof color === 'number') return String(color);
  return `${base};2;${hexToRgb(color).join(';')}`;
}

/** SGR parameters that switch on everything in a style. */
export function styleParams(st) {
  const p = [];
  if (st.b) p.push('1');
  if (st.i) p.push('3');
  if (st.u) p.push('4');
  if (st.s) p.push('9');
  if (st.fg != null) p.push(colorParam(st.fg, 38));
  if (st.bg != null) p.push(colorParam(st.bg, 48));
  return p;
}

function transition(cur, next) {
  const switchedOff =
    (cur.b && !next.b) ||
    (cur.i && !next.i) ||
    (cur.u && !next.u) ||
    (cur.s && !next.s) ||
    (cur.fg != null && next.fg == null) ||
    (cur.bg != null && next.bg == null);

  if (switchedOff) {
    const p = styleParams(next);
    return p.length ? `${ESC}[0;${p.join(';')}m` : `${ESC}[0m`;
  }

  const delta = [];
  if (next.b && !cur.b) delta.push('1');
  if (next.i && !cur.i) delta.push('3');
  if (next.u && !cur.u) delta.push('4');
  if (next.s && !cur.s) delta.push('9');
  if (next.fg !== cur.fg) delta.push(colorParam(next.fg, 38));
  if (next.bg !== cur.bg) delta.push(colorParam(next.bg, 48));
  if (!delta.length) return '';

  // A lone parameter such as ESC[31m. Discord's own docs and every guide use
  // the "{format};{color}" shape, so restate the style after a reset instead.
  if (delta.length === 1 && !delta[0].includes(';')) {
    return `${ESC}[0;${styleParams(next).join(';')}m`;
  }
  return `${ESC}[${delta.join(';')}m`;
}

const BLANK = /^[ \t\u00a0\n]*$/;
const ONLY_BREAKS = /^\n*$/;

// Would switching from `cur` to `next` change anything you can see on this text?
function looksTheSame(cur, next, text) {
  if (ONLY_BREAKS.test(text)) return true;
  if (!BLANK.test(text)) return false;
  if (cur.bg !== next.bg || cur.u !== next.u || cur.s !== next.s) return false;
  // underline and strike lines take the text color, so it matters there
  if ((next.u || next.s) && cur.fg !== next.fg) return false;
  return true;
}

/** Encode runs ({ text, style }) to the ANSI body of a message. */
export function encodeRuns(runs) {
  let cur = PLAIN;
  let curKey = keyOf(PLAIN);
  let out = '';
  for (const run of runs) {
    if (!run.text) continue;
    const key = keyOf(run.style);
    if (key !== curKey && !looksTheSame(cur, run.style, run.text)) {
      out += transition(cur, run.style);
      cur = run.style;
      curKey = key;
    }
    out += run.text;
  }
  return out;
}

/** Break up ``` inside the text so it can't close the code block early. */
export function protectFences(body) {
  return body.replace(/`(?=``)/g, '`\u200b');
}

/** The full message to paste into Discord. */
export function toMessage(body) {
  return `\`\`\`ansi\n${protectFences(body)}\n\`\`\``;
}

/** Count codes and the characters they use in a message body. */
export function measure(body) {
  let codes = 0;
  let codeChars = 0;
  for (const m of body.matchAll(SGR)) {
    codes += 1;
    codeChars += m[0].length;
  }
  return { codes, codeChars };
}

// ---------------------------------------------------------------------------
// Decoding: ANSI text back into runs. Used for pasting and importing, so it is
// generous: it understands terminal output too (bright colors, 256 colors,
// colon separated params) and maps anything Discord can't show to what it can.

function applyParams(st, raw) {
  const groups = raw === '' ? ['0'] : raw.split(';');
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    if (g.includes(':')) {
      applyColonGroup(st, g.split(':'));
      continue;
    }
    const p = g === '' ? 0 : parseInt(g, 10);
    if (p === 38 || p === 48) {
      const mode = parseInt(groups[i + 1], 10);
      if (mode === 2) {
        setRgb(st, p, groups.slice(i + 2, i + 5));
        i += 4;
      } else if (mode === 5) {
        set256(st, p, parseInt(groups[i + 2], 10));
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    applySimple(st, p);
  }
}

function applyColonGroup(st, parts) {
  const p = parseInt(parts[0], 10);
  if (p === 38 || p === 48) {
    const mode = parseInt(parts[1], 10);
    if (mode === 2) {
      const nums = parts.slice(2);
      setRgb(st, p, nums.length >= 4 ? nums.slice(1, 4) : nums.slice(0, 3));
    } else if (mode === 5) {
      set256(st, p, parseInt(parts[2], 10));
    }
    return;
  }
  if (p === 58) return; // underline color, not supported by Discord
  applySimple(st, p);
}

function setRgb(st, p, nums) {
  if (nums.length < 3) return;
  const hex = `#${nums
    .map((n) => Math.max(0, Math.min(255, parseInt(n, 10) || 0)).toString(16).padStart(2, '0'))
    .join('')}`;
  st[p === 38 ? 'fg' : 'bg'] = hex;
}

function set256(st, p, n) {
  if (!Number.isInteger(n) || n < 0 || n > 255) return;
  const fg = p === 38;
  if (n < 16) st[fg ? 'fg' : 'bg'] = (fg ? 30 : 40) + (n % 8);
  else st[fg ? 'fg' : 'bg'] = xterm256(n);
}

function applySimple(st, p) {
  if (Number.isNaN(p)) return;
  if (p === 0) Object.assign(st, PLAIN);
  else if (p === 1) st.b = true;
  else if (p === 3) st.i = true;
  else if (p === 4 || p === 21) st.u = true;
  else if (p === 9) st.s = true;
  else if (p === 22) st.b = false;
  else if (p === 23) st.i = false;
  else if (p === 24) st.u = false;
  else if (p === 29) st.s = false;
  else if (p >= 30 && p <= 37) st.fg = p;
  else if (p === 39) st.fg = null;
  else if (p >= 40 && p <= 47) st.bg = p;
  else if (p === 49) st.bg = null;
  else if (p >= 90 && p <= 97) st.fg = p - 60;
  else if (p >= 100 && p <= 107) st.bg = p - 60;
  // 2 (faint), 5 (blink), 7 (reverse) and friends do nothing in Discord
}

const OTHER_ESCAPES = /\u001b\[[0-9;:?<=>]*[ -/]*[@-ln-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]?/g;

function cleanChunk(text) {
  return text
    .replace(OTHER_ESCAPES, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Decode an ANSI string (no code fences) into merged runs. */
export function decodeAnsi(input) {
  const runs = [];
  const st = { ...PLAIN };
  const push = (text) => {
    const clean = cleanChunk(text);
    if (!clean) return;
    const style = makeStyle(st);
    const last = runs[runs.length - 1];
    if (last && keyOf(last.style) === keyOf(style)) last.text += clean;
    else runs.push({ text: clean, style });
  };
  let last = 0;
  for (const m of input.matchAll(SGR)) {
    push(input.slice(last, m.index));
    applyParams(st, m[1]);
    last = m.index + m[0].length;
  }
  push(input.slice(last));
  return runs;
}

/** Walk a body as text pieces (with their style) and codes, for the codes view. */
export function* tokenize(body) {
  const st = { ...PLAIN };
  let last = 0;
  for (const m of body.matchAll(SGR)) {
    if (m.index > last) yield { type: 'text', text: body.slice(last, m.index), style: makeStyle(st) };
    yield { type: 'code', raw: m[0], params: m[1] };
    applyParams(st, m[1]);
    last = m.index + m[0].length;
  }
  if (last < body.length) yield { type: 'text', text: body.slice(last), style: makeStyle(st) };
}

const TEXT_ESCAPE = /\\(?:u001b|u001B|u\{1b\}|u\{1B\}|x1b|x1B|033|e)\[/;

/** True when pasted text carries ANSI codes, real or written out as \u001b. */
export function looksLikeAnsi(text) {
  return /\u001b\[[0-9;:]*m/.test(text) || TEXT_ESCAPE.test(text) || /(?:\^\[|\u241b|\u238b)\[[0-9;:]*m/.test(text) || /^\s*```ansi\s*\n/i.test(text);
}

/**
 * Turn whatever the user pasted into a plain ANSI body:
 * a Discord message with ```ansi fences, a JS / Python / Java string literal
 * with \u001b escapes, caret notation (^[) or the visible \u241b symbol.
 */
export function normalizeImport(raw) {
  let s = String(raw).replace(/\r\n?/g, '\n');

  // Code from a bot: unwrap the string literal and resolve its escapes.
  if (TEXT_ESCAPE.test(s)) {
    const whole = /^\s*(["'`])([\s\S]*)\1\s*[;,)]*\s*$/.exec(s);
    const inner = whole ? null : findEscapedLiteral(s);
    if (whole) s = whole[2];
    else if (inner != null) s = inner;
    s = s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|0?33|e|n|t|r|"|'|`|\\)/g, (m, g) => {
      if (g[0] === 'u') return String.fromCodePoint(parseInt(g[1] === '{' ? g.slice(2, -1) : g.slice(1), 16));
      if (g[0] === 'x') return String.fromCharCode(parseInt(g.slice(1), 16));
      if (g === '033' || g === '33' || g === 'e') return ESC;
      if (g === 'n') return '\n';
      if (g === 't') return '\t';
      if (g === 'r') return '';
      return g;
    });
  }

  s = s.replace(/(?:\^\[|\u241b|\u238b)(?=\[)/g, ESC);

  // A Discord message: keep what is inside the code block(s).
  const blocks = [...s.matchAll(/```(?:ansi)?[ \t]*\n([\s\S]*?)\n?```/gi)];
  if (blocks.length) s = blocks.map((b) => b[1]).join('\n');

  // Undo the zero width spaces we add to keep ``` from closing the block.
  return s.replace(/`\u200b(?=`)/g, '`');
}

function findEscapedLiteral(s) {
  for (const m of s.matchAll(/(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g)) {
    if (TEXT_ESCAPE.test(m[2])) return m[2];
  }
  return null;
}

/** Everything in one go: pasted text to runs. */
export function importText(raw) {
  return decodeAnsi(normalizeImport(raw));
}

// ---------------------------------------------------------------------------
// Copy formats for bots and scripts.

/** A double quoted string literal valid in JS, TS, JSON, Python, Java, Kotlin, C# and Go. */
export function toStringLiteral(s) {
  const body = s.replace(/[\\"\u0000-\u001f\u007f\u2028\u2029]/g, (c) => {
    if (c === '\\') return '\\\\';
    if (c === '"') return '\\"';
    if (c === '\n') return '\\n';
    if (c === '\t') return '\\t';
    if (c === '\r') return '\\r';
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return `"${body}"`;
}

export const COPY_FORMATS = [
  { id: 'discord', label: 'Discord message', hint: 'Paste straight into a channel', build: (msg) => msg },
  { id: 'raw', label: 'Raw ANSI', hint: 'Without the code block, for terminals', build: (msg, body) => body },
  { id: 'string', label: 'Escaped string', hint: 'JS, Python, Java, C#, Go, JSON', build: (msg) => toStringLiteral(msg) },
  { id: 'djs', label: 'discord.js', hint: 'JavaScript bot', build: (msg) => `await channel.send(${toStringLiteral(msg)});` },
  { id: 'dpy', label: 'discord.py', hint: 'Python bot', build: (msg) => `await channel.send(${toStringLiteral(msg)})` },
  { id: 'jda', label: 'JDA', hint: 'Java bot', build: (msg) => `channel.sendMessage(${toStringLiteral(msg)}).queue();` },
  { id: 'webhook', label: 'Webhook JSON', hint: 'Body for a webhook POST', build: (msg) => `{"content": ${toStringLiteral(msg)}}` },
];

/** Plain-language meaning of an SGR parameter list, for the codes view. */
export function describeParams(raw) {
  const words = [];
  const groups = raw === '' ? ['0'] : raw.split(';');
  for (let i = 0; i < groups.length; i += 1) {
    const p = parseInt(groups[i], 10);
    if (p === 38 || p === 48) {
      if (groups[i + 1] === '2') {
        words.push(`${p === 38 ? 'text' : 'background'} rgb(${groups.slice(i + 2, i + 5).join(', ')})`);
        i += 4;
      } else i += 2;
      continue;
    }
    const names = { 0: 'reset', 1: 'bold', 3: 'italic', 4: 'underline', 9: 'strikethrough' };
    if (names[p]) words.push(names[p]);
    else if (p >= 30 && p <= 37) words.push(`text color ${p}`);
    else if (p >= 40 && p <= 47) words.push(`background ${p}`);
    else if (!Number.isNaN(p)) words.push(`code ${p}`);
  }
  const text = words.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
