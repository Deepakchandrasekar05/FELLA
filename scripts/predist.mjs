/**
 * predist.mjs — installs native/external packages into dist/node_modules
 * so caxa bundles them inside the .exe alongside dist/index.js.
 *
 * We use `npm install --prefix dist` rather than manual cpSync so that:
 *  1. All transitive dependencies are resolved correctly by npm
 *  2. package.json / package-lock presence enables proper module resolution
 *  3. Native .node addons are rebuilt for the current platform if needed
 */

import { execSync }             from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname }        from 'path';
import { fileURLToPath }        from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = join(__dirname, '..');
const distDir   = join(root, 'dist');

// Ensure dist/ exists (build may not have run yet)
mkdirSync(distDir, { recursive: true });

// Write a minimal package.json into dist/ so npm has a valid install target.
// private:true prevents it from being accidentally published.
// type:module tells Node that index.js is ESM — no reparse warning.
writeFileSync(
  join(distDir, 'package.json'),
  JSON.stringify({ name: 'fella-runtime', version: '1.0.0', private: true, type: 'module' }, null, 2) + '\n',
);

// Install every package that esbuild marks --external into dist/node_modules/.
// npm resolves the full transitive dep tree so nothing is missing at runtime.
const PACKAGES = [
  '@nut-tree-fork/nut-js',
  'better-sqlite3',
  'trash',
].join(' ');

console.log('▸ Installing native packages into dist/node_modules/ …');
execSync(`npm install --prefix dist --omit=dev --no-save ${PACKAGES}`, {
  stdio: 'inherit',
  cwd: root,
});

// Copy assets into dist/ so caxa bundles them inside the exe
import { cpSync } from 'fs';
const assetsDir = join(root, 'assets');
const distAssets = join(distDir, 'assets');
cpSync(assetsDir, distAssets, { recursive: true, force: true });
console.log('✔  assets copied to dist/assets/');

console.log('✔  predist complete — native packages ready in dist/node_modules/');
