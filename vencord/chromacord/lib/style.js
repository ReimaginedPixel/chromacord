// Copied from assets/js/core/style.js by scripts/build.mjs. Edit the original, then run npm run build.

// Text styles and their compact string keys.
//
// A style is a frozen object: { b, i, u, s, fg, bg }
//   b, i, u, s  bold, italic, underline, strikethrough (booleans)
//   fg          null, a classic ANSI text color (30-37) or a "#rrggbb" string
//   bg          null, a classic ANSI background color (40-47) or a "#rrggbb" string
//
// Every character in the editor stores the key of its style, for example
// "1000|31|" (bold red) or "0000|#ff8800|44". Keys are cheap to compare and
// to store, and identical keys merge into one run when rendering or encoding.

export const PLAIN_KEY = '0000||';
export const PLAIN = Object.freeze({ b: false, i: false, u: false, s: false, fg: null, bg: null });

const cache = new Map([[PLAIN_KEY, PLAIN]]);

function parseColor(value, min, max) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) && value >= min && value <= max ? value : null;
  const v = String(value).trim().toLowerCase();
  if (v[0] === '#') return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Build a clean, frozen style from any partial or untrusted object. */
export function makeStyle(partial = {}) {
  return Object.freeze({
    b: !!partial.b,
    i: !!partial.i,
    u: !!partial.u,
    s: !!partial.s,
    fg: parseColor(partial.fg, 30, 37),
    bg: parseColor(partial.bg, 40, 47),
  });
}

export function keyOf(st) {
  return `${st.b ? 1 : 0}${st.i ? 1 : 0}${st.u ? 1 : 0}${st.s ? 1 : 0}|${st.fg ?? ''}|${st.bg ?? ''}`;
}

/** Style for a key. Unknown or malformed parts fall back to "off". */
export function styleOf(key) {
  const hit = cache.get(key);
  if (hit) return hit;
  const [flags = '', fg = '', bg = ''] = String(key).split('|');
  const st = makeStyle({ b: flags[0] === '1', i: flags[1] === '1', u: flags[2] === '1', s: flags[3] === '1', fg, bg });
  if (cache.size > 5000) cache.clear();
  cache.set(key, st);
  return st;
}

/** Re-serialize a key from an untrusted source (clipboard, share link). */
export function normalizeKey(key) {
  return keyOf(styleOf(key));
}

export function patchStyle(st, patch) {
  return makeStyle({ ...st, ...patch });
}

export function isPlain(st) {
  return keyOf(st) === PLAIN_KEY;
}
