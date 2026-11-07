// Ready-made messages. Each template returns runs ({ text, style }).

import { makeStyle } from '../core/style.js';
import { effectColors } from '../core/effects.js';
import { PRESETS } from './palettes.js';

const preset = (id) => PRESETS.find((p) => p.id === id).colors;

const t = (text, style = {}) => ({ text, style: makeStyle(style) });

/** Color text with an effect and return it as runs. */
export function fx(text, colors, { effect = 'gradient', target = 'fg', style = {} } = {}) {
  const cs = effectColors(text, { effect, colors, target });
  const runs = [];
  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (j < text.length && cs[j] === cs[i]) j += 1;
    const color = cs[i] === undefined ? style[target] ?? null : cs[i];
    runs.push(t(text.slice(i, j), { ...style, [target]: color }));
    i = j;
  }
  return runs;
}

const GRAY = '#8b919a';
const nl = () => t('\n');

function bar(label, pct, colors) {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  return [
    t(label.padEnd(6), { b: true }),
    ...fx('█'.repeat(filled), colors),
    t('░'.repeat(width - filled), { fg: '#4e5058' }),
    t(`${String(pct).padStart(5)}%`, { fg: GRAY }),
  ];
}

export const TEMPLATES = [
  {
    id: 'welcome',
    name: 'Welcome',
    hidden: true,
    build: () => [
      t('Welcome to ', { b: true }),
      ...fx('Chromacord', preset('vapor'), { style: { b: true } }),
      nl(),
      t('Select any text, then pick '),
      t('a color', { fg: 31 }),
      t(', '),
      ...fx('a gradient', preset('sunset')),
      t(' or '),
      t('a style', { i: true, u: true }),
      t('.\n'),
      t('Classic colors', { fg: 36 }),
      t(" follow each reader's theme. "),
      t('Custom ones', { fg: '#ff8a3d' }),
      t(' look the same to all.\n'),
      t('When it looks right, press '),
      t('Copy for Discord', { b: true }),
      t(' and paste it into any channel.'),
    ],
  },
  {
    id: 'announcement',
    name: 'Announcement',
    build: () => [
      ...fx('◆ Season 4 starts Friday ◆', preset('vapor'), { style: { b: true } }),
      t('\nDoors open at 18:00 CET. Bring your friends.\n\n'),
      t(' NEW ', { b: true, fg: '#ffffff', bg: 42 }),
      t(' Ranks, kits and a map twice the size\n'),
      t(' NEW ', { b: true, fg: '#ffffff', bg: 42 }),
      t(' Weekly tournaments with real prizes\n'),
      t(' BYE ', { b: true, fg: '#ffffff', bg: 41 }),
      t(' The old spawn is retired\n\n'),
      ...fx('See you on the server!', preset('candy'), { style: { i: true } }),
    ],
  },
  {
    id: 'status',
    name: 'Server status',
    build: () => [
      t('Server status', { b: true, u: true }),
      nl(),
      t('● ', { fg: 32 }), t('Lobby       '), t('online', { fg: 32 }), nl(),
      t('● ', { fg: 32 }), t('Survival    '), t('online', { fg: 32 }), nl(),
      t('● ', { fg: 33 }), t('Creative    '), t('maintenance', { fg: 33 }), nl(),
      t('● ', { fg: 31 }), t('Minigames   '), t('offline', { fg: 31 }), nl(),
      t('Checked 2 minutes ago', { i: true, fg: GRAY }),
    ],
  },
  {
    id: 'changelog',
    name: 'Changelog',
    build: () => [
      t('v2.4.0', { b: true, fg: 36 }),
      t('  November update', { fg: GRAY }),
      nl(),
      t('+ ', { b: true, fg: 32 }), t('Added', { fg: 32 }), t('   party chat and /msg history\n'),
      t('~ ', { b: true, fg: 33 }), t('Changed', { fg: 33 }), t(' spawn protection radius to 32\n'),
      t('* ', { b: true, fg: 34 }), t('Fixed', { fg: 34 }), t('   elytra boosts desyncing\n'),
      t('- ', { b: true, fg: 31 }), t('Removed', { fg: 31 }), t(' the legacy '), t('/warp', { s: true }), t(' aliases'),
    ],
  },
  {
    id: 'console',
    name: 'Console log',
    build: () => {
      const line = (time, level, bg, fg, msg) => [
        t(`${time} `, { fg: GRAY }),
        t(` ${level.padEnd(5)} `, { b: true, fg, bg }),
        t(` ${msg}\n`),
      ];
      const runs = [
        ...line('12:04:31', 'INFO', 44, '#ffffff', 'Server started on port 25565'),
        ...line('12:04:33', 'WARN', 43, '#000000', 'Tick took 312 ms, server may be overloaded'),
        ...line('12:05:10', 'ERROR', 41, '#ffffff', 'Could not save chunk at -12, 7'),
        ...line('12:05:12', 'DEBUG', 45, '#ffffff', 'Autosave finished in 84 ms'),
      ];
      runs[runs.length - 1] = t(' Autosave finished in 84 ms');
      return runs;
    },
  },
  {
    id: 'bars',
    name: 'Progress bars',
    build: () => [
      t('Level 42', { b: true }), t('  7,420 / 10,000 XP to the next level', { fg: GRAY }), nl(),
      ...bar('XP', 71, ['#4cd97b', '#b6ff6b']), nl(),
      ...bar('HP', 100, ['#ff5a5a', '#ff9f43']), nl(),
      ...bar('Mana', 40, ['#3ed3e6', '#5b8cff']),
    ],
  },
  {
    id: 'leaderboard',
    name: 'Leaderboard',
    build: () => [
      ...fx('Top players this week', preset('gold'), { style: { b: true } }),
      nl(),
      t('1  SkyRunner      12,450 pts', { b: true, fg: '#ffc94a' }), nl(),
      t('2  Pixelmancer    11,980 pts', { b: true, fg: '#c7ced8' }), nl(),
      t('3  Crafty         10,205 pts', { b: true, fg: '#d08c55' }), nl(),
      t('4  BedrockBaron    9,870 pts'), nl(),
      t('5  LlamaDrama      9,410 pts'),
    ],
  },
  {
    id: 'rules',
    name: 'Rules',
    build: () => [
      ...fx('Server rules', preset('fire'), { style: { b: true } }),
      nl(),
      t('1. ', { b: true, fg: 33 }), t('Be kind. No harassment or hate speech.\n'),
      t('2. ', { b: true, fg: 33 }), t('No cheats, hacked clients or x-ray.\n'),
      t('3. ', { b: true, fg: 33 }), t('Keep #general in English.\n'),
      t('4. ', { b: true, fg: 33 }), t('No advertising other servers.\n'),
      t('5. ', { b: true, fg: 33 }), t('Staff decisions are final.\n'),
      t('Breaking a rule can get you muted or banned.', { i: true, fg: GRAY }),
    ],
  },
];

export const templateById = (id) => TEMPLATES.find((x) => x.id === id);
