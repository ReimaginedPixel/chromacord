// Color data: the 8 classic ANSI slots, color palettes and effect presets.

/** Classic slots. Text code is `code`, background code is `code + 10`. */
export const CLASSIC = [
  { code: 30, name: 'Black' },
  { code: 31, name: 'Red' },
  { code: 32, name: 'Green' },
  { code: 33, name: 'Gold' },
  { code: 34, name: 'Blue' },
  { code: 35, name: 'Pink' },
  { code: 36, name: 'Teal' },
  { code: 37, name: 'Gray' },
];

export const PALETTES = [
  {
    id: 'roles',
    name: 'Discord role colors',
    colors: [
      ['#1abc9c', 'Teal'], ['#2ecc71', 'Green'], ['#3498db', 'Blue'], ['#9b59b6', 'Purple'], ['#e91e63', 'Magenta'],
      ['#f1c40f', 'Gold'], ['#e67e22', 'Orange'], ['#e74c3c', 'Red'], ['#95a5a6', 'Light gray'], ['#607d8b', 'Navy gray'],
      ['#11806a', 'Dark teal'], ['#1f8b4c', 'Dark green'], ['#206694', 'Dark blue'], ['#71368a', 'Dark purple'], ['#ad1457', 'Dark magenta'],
      ['#c27c0e', 'Dark gold'], ['#a84300', 'Dark orange'], ['#992d22', 'Dark red'], ['#979c9f', 'Gray'], ['#546e7a', 'Dark navy gray'],
    ],
  },
  {
    id: 'minecraft',
    name: 'Minecraft chat',
    colors: [
      ['#000000', 'Black (0)'], ['#0000aa', 'Dark blue (1)'], ['#00aa00', 'Dark green (2)'], ['#00aaaa', 'Dark aqua (3)'],
      ['#aa0000', 'Dark red (4)'], ['#aa00aa', 'Dark purple (5)'], ['#ffaa00', 'Gold (6)'], ['#aaaaaa', 'Gray (7)'],
      ['#555555', 'Dark gray (8)'], ['#5555ff', 'Blue (9)'], ['#55ff55', 'Green (a)'], ['#55ffff', 'Aqua (b)'],
      ['#ff5555', 'Red (c)'], ['#ff55ff', 'Light purple (d)'], ['#ffff55', 'Yellow (e)'], ['#ffffff', 'White (f)'],
    ],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    colors: [
      ['#ffb3ba', 'Blush'], ['#ffd6a5', 'Apricot'], ['#fdffb6', 'Butter'], ['#caffbf', 'Mint'], ['#9bf6ff', 'Sky'],
      ['#a0c4ff', 'Periwinkle'], ['#bdb2ff', 'Lavender'], ['#ffc6ff', 'Orchid'], ['#e2ece9', 'Fog'], ['#f1e3d3', 'Sand'],
    ],
  },
  {
    id: 'neon',
    name: 'Neon',
    colors: [
      ['#ff2e88', 'Hot pink'], ['#ff5f1f', 'Blaze'], ['#ffe600', 'Volt'], ['#39ff14', 'Laser green'], ['#00f0ff', 'Electric cyan'],
      ['#4d7cff', 'Ultra blue'], ['#b026ff', 'Purple haze'], ['#ff00e6', 'Magenta'],
    ],
  },
  {
    id: 'grays',
    name: 'Grays',
    colors: [
      ['#ffffff', 'White'], ['#e6e6e6', 'Gray 10'], ['#c4c4c4', 'Gray 25'], ['#9e9e9e', 'Gray 40'],
      ['#7a7a7a', 'Gray 55'], ['#575757', 'Gray 70'], ['#333333', 'Gray 85'], ['#000000', 'Black'],
    ],
  },
];

/** Color sets for effects. */
export const PRESETS = [
  { id: 'rainbow', name: 'Rainbow', colors: ['#ff5a5a', '#ff9f43', '#ffe45e', '#4cd97b', '#3ed3e6', '#5b8cff', '#b26bff'] },
  { id: 'pastel', name: 'Pastel', colors: ['#ffb3ba', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff'] },
  { id: 'sunset', name: 'Sunset', colors: ['#ff5f6d', '#ffc371'] },
  { id: 'peach', name: 'Peach', colors: ['#fd9855', '#d161a2'] },
  { id: 'vapor', name: 'Vapor', colors: ['#ff71ce', '#01cdfe', '#b967ff'] },
  { id: 'ocean', name: 'Ocean', colors: ['#2193b0', '#6dd5ed'] },
  { id: 'aurora', name: 'Aurora', colors: ['#00c9ff', '#92fe9d'] },
  { id: 'fire', name: 'Fire', colors: ['#f12711', '#f5af19'] },
  { id: 'toxic', name: 'Toxic', colors: ['#a8ff78', '#78ffd6'] },
  { id: 'candy', name: 'Candy', colors: ['#ffafcc', '#cdb4db', '#a2d2ff'] },
  { id: 'gold', name: 'Gold', colors: ['#bf953f', '#fcf6ba', '#b38728'] },
  { id: 'ice', name: 'Ice', colors: ['#ffffff', '#9be7ff', '#3a8dde'] },
  { id: 'royal', name: 'Royal', colors: ['#4776e6', '#8e54e9'] },
  { id: 'blood', name: 'Blood', colors: ['#8e0e00', '#ff4b2b'] },
  { id: 'matrix', name: 'Matrix', colors: ['#00ff41', '#008f11'] },
  { id: 'mint', name: 'Mint', colors: ['#00b09b', '#96c93d'] },
  { id: 'pride', name: 'Pride', flag: true, colors: ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787'] },
  { id: 'trans', name: 'Trans', flag: true, colors: ['#5bcefa', '#f5a9b8', '#ffffff', '#f5a9b8', '#5bcefa'] },
  { id: 'bi', name: 'Bi', flag: true, colors: ['#d60270', '#9b4f96', '#0038a8'] },
  { id: 'pan', name: 'Pan', flag: true, colors: ['#ff218c', '#ffd800', '#21b1ff'] },
  { id: 'nonbinary', name: 'Nonbinary', flag: true, colors: ['#fcf434', '#ffffff', '#9c59d1', '#2c2c2c'] },
  { id: 'lesbian', name: 'Lesbian', flag: true, colors: ['#d52d00', '#ff9a56', '#ffffff', '#d362a4', '#a30262'] },
];

/** Classic colors per Discord theme, as hex, for HTML copies and docs. */
export const THEME_HEX = {
  light: { 30: '#000000', 31: '#e75858', 32: '#399b5d', 33: '#c07600', 34: '#3789ea', 35: '#e444bb', 36: '#0098a3', 37: '#b6b7bc', text: '#36373e', base: '#fbfbfb' },
  ash: { 30: '#000000', 31: '#ec6361', 32: '#45a366', 33: '#ce8100', 34: '#4591ec', 35: '#f549c9', 36: '#049faa', 37: '#b6b7bc', text: '#ffffff', base: '#323339' },
  dark: { 30: '#000000', 31: '#de464a', 32: '#1b8d4d', 33: '#b36c00', 34: '#1a7ce6', 35: '#d53fae', 36: '#008995', 37: '#b6b7bc', text: '#e4e4e6', base: '#1a1a1e' },
  onyx: { 30: '#000000', 31: '#d22d39', 32: '#008043', 33: '#a56100', 34: '#006dd4', 35: '#bc3699', 36: '#007c87', 37: '#b6b7bc', text: '#d1d1d5', base: '#070709' },
};

export const THEMES = [
  { id: 'light', name: 'Light' },
  { id: 'ash', name: 'Ash' },
  { id: 'dark', name: 'Dark' },
  { id: 'onyx', name: 'Onyx' },
];
