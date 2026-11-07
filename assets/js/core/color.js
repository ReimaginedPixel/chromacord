// Color math. Pure functions, no DOM, safe to import in Node tests.
// Gradients are mixed in OKLab so the middle of a gradient stays bright and
// even instead of turning muddy like a plain RGB blend.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** "#abc", "abc", "#AABBCC" or "aabbcc" to "#aabbcc". Anything else gives null. */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) throw new TypeError(`Not a hex color: ${hex}`);
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toGamma = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToRgb(lab) {
  return oklabToLinear(lab).map(toGamma);
}

const inGamut = (lin) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH (L 0-1, C 0-0.4, hue in degrees) to hex, lowering chroma until it fits sRGB. */
export function oklchToHex(L, C, hue) {
  const h = (hue * Math.PI) / 180;
  const lab = (c) => [L, c * Math.cos(h), c * Math.sin(h)];
  let c = C;
  if (!inGamut(oklabToLinear(lab(c)))) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(lab(mid)))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return rgbToHex(oklabToRgb(lab(c)));
}

/** Mix two hex colors in OKLab. t = 0 gives a, t = 1 gives b. */
export function mixHex(a, b, t) {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb(A.map((v, i) => v + (B[i] - v) * t)));
}

/** Color at position t (0-1) along evenly spaced stops. */
export function sampleStops(stops, t) {
  if (stops.length === 1) return normalizeHex(stops[0]);
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return mixHex(stops[i], stops[i + 1], x - i);
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1 to 21). */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever reads better on the given background. */
export function readableOn(bg) {
  return contrast(bg, '#ffffff') >= contrast(bg, '#000000') ? '#ffffff' : '#000000';
}

/** xterm 256-color palette entry 16-255 as hex (0-15 are mapped to classic codes elsewhere). */
export function xterm256(n) {
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return rgbToHex([v, v, v]);
  }
  const i = n - 16;
  const level = [0, 95, 135, 175, 215, 255];
  return rgbToHex([level[Math.floor(i / 36) % 6], level[Math.floor(i / 6) % 6], level[i % 6]]);
}
