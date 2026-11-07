// Bundles the ES modules in assets/js into one classic script, assets/js/chromacord.js.
//
// The page loads the bundle instead of main.js so it also works when index.html
// is opened straight from disk: browsers refuse to load ES modules over file://.
//
//   npm run build           write the bundle
//   npm run build -- --check fail if the committed bundle is out of date (CI)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const out = fileURLToPath(new URL('../assets/js/chromacord.js', import.meta.url));
const check = process.argv.includes('--check');

const result = await build({
  entryPoints: [fileURLToPath(new URL('../assets/js/main.js', import.meta.url))],
  bundle: true,
  format: 'iife',
  target: ['chrome100', 'firefox100', 'safari15.4'],
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  banner: { js: '// Chromacord, built from assets/js by scripts/build.mjs. Edit the modules, then run npm run build.' },
  write: false,
});

const code = result.outputFiles[0].text;

if (check) {
  let current = '';
  try {
    current = readFileSync(out, 'utf8');
  } catch {}
  if (current !== code) {
    console.error('assets/js/chromacord.js is out of date. Run npm run build and commit the result.');
    process.exit(1);
  }
  console.log('assets/js/chromacord.js is up to date.');
} else {
  writeFileSync(out, code);
  console.log(`Wrote assets/js/chromacord.js (${(code.length / 1024).toFixed(1)} KB)`);
}
