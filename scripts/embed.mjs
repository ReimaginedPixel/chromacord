// Writes the link preview Discord shows for the site into index.html.
// Run it after changing the site URL (forks) or the preview text:
//   node scripts/embed.mjs https://you.github.io/chromacord/

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeStyle } from '../assets/js/core/style.js';
import { encodeRuns } from '../assets/js/core/ansi.js';
import { fx } from '../assets/js/data/templates.js';
import { PRESETS } from '../assets/js/data/palettes.js';

const SITE = process.argv[2] ?? 'https://reimaginedpixel.github.io/chromacord/';
const colors = (id) => PRESETS.find((p) => p.id === id).colors;
const t = (text, style = {}) => ({ text, style: makeStyle(style) });

const runs = [
  ...fx('Colored text', colors('vapor'), { style: { b: true } }),
  t(' for Discord, with '),
  ...fx('gradients', colors('sunset')),
  t(', '),
  ...fx('effects', colors('rainbow'), { effect: 'bands' }),
  t(' and '),
  t(' templates ', { b: true, fg: '#ffffff', bg: '#5b8cff' }),
];

const embed = {
  component: {
    type: 17,
    accent_color: 0x4591ec,
    components: [
      {
        type: 10,
        content: `### [Chromacord](${SITE})\n\`\`\`ansi\n${encodeRuns(runs)}\n\`\`\``,
      },
    ],
  },
};

const json = JSON.stringify(embed, null, 2).replaceAll('</', '<\\/');
const tag = `<!-- DISCORD-EMBED -->\n<script id="discord:component-embed" type="application/json">\n${json}\n</script>\n<!-- /DISCORD-EMBED -->`;

const file = fileURLToPath(new URL('../index.html', import.meta.url));
const html = readFileSync(file, 'utf8');
const block = /<!-- DISCORD-EMBED -->[\s\S]*?<!-- \/DISCORD-EMBED -->|<!-- DISCORD-EMBED -->/;
if (!block.test(html)) throw new Error('No <!-- DISCORD-EMBED --> marker in index.html');
writeFileSync(file, html.replace(block, tag));
console.log(`Embed written for ${SITE} (${json.length} characters)`);
