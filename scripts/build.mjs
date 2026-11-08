// Bundles the ES modules in assets/js into one classic script, assets/js/chromacord.js,
// and copies the shared modules into the Vencord plugin.
//
// The page loads the bundle instead of main.js so it also works when index.html
// is opened straight from disk: browsers refuse to load ES modules over file://.
//
// The Vencord plugin is a folder people copy into their Vencord checkout, so it
// can't import from assets/js. It gets its own copy in vencord/chromacord/lib.
//
//   npm run build           write the bundle and the plugin copies
//   npm run build -- --check fail if either is out of date (CI)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const check = process.argv.includes('--check');

const result = await build({
  entryPoints: [path('assets/js/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome100', 'firefox100', 'safari15.4'],
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  banner: { js: '// Chromacord, built from assets/js by scripts/build.mjs. Edit the modules, then run npm run build.' },
  write: false,
});

const outputs = [['assets/js/chromacord.js', result.outputFiles[0].text]];

for (const source of ['core/ansi.js', 'core/color.js', 'core/effects.js', 'core/style.js', 'data/palettes.js']) {
  const name = source.split('/')[1];
  const banner = `// Copied from assets/js/${source} by scripts/build.mjs. Edit the original, then run npm run build.\n\n`;
  outputs.push([`vencord/chromacord/lib/${name}`, banner + readFileSync(path(`assets/js/${source}`), 'utf8')]);
}

if (check) {
  const stale = outputs.filter(([file, code]) => {
    try {
      return readFileSync(path(file), 'utf8') !== code;
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(`Out of date: ${stale.map(([file]) => file).join(', ')}. Run npm run build and commit the result.`);
    process.exit(1);
  }
  console.log('The bundle and the plugin copies are up to date.');
} else {
  for (const [file, code] of outputs) writeFileSync(path(file), code);
  console.log(`Wrote assets/js/chromacord.js (${(outputs[0][1].length / 1024).toFixed(1)} KB) and the plugin copies in vencord/chromacord/lib`);
}
