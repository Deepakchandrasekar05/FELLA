/**
 * bundle-desktop.mjs — Builds the Electron desktop avatar app.
 *
 * Three separate builds:
 *   1. Main process  (desktop/main.ts)  → desktop-dist/main.js    (Node/Electron)
 *   2. Preload       (desktop/preload.ts) → desktop-dist/preload.js (Node/Electron)
 *   3. Avatar renderer (desktop/renderer/AvatarApp.tsx) → desktop-dist/renderer/avatar-bundle.js (browser)
 *   4. Input renderer  (desktop/renderer/InputApp.tsx)  → desktop-dist/renderer/input-bundle.js  (browser)
 *
 * HTML files are copied verbatim into desktop-dist/renderer/.
 */
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopSrc = resolve(root, 'desktop');
const out = resolve(root, 'desktop-dist');

// Load .env for build-time defines
const { parsed } = config({ path: resolve(root, '.env') });
const defines = {
  'process.env.GROQ_API_KEY':      JSON.stringify(parsed?.['GROQ_API_KEY'] ?? ''),
  'process.env.SUPABASE_URL':      JSON.stringify(parsed?.['SUPABASE_URL'] ?? ''),
  'process.env.SUPABASE_ANON_KEY': JSON.stringify(parsed?.['SUPABASE_ANON_KEY'] ?? ''),
};

// Ensure output dirs exist
mkdirSync(resolve(out, 'renderer'), { recursive: true });

// Shared externals — Electron APIs + Node native modules
const nodeExternals = [
  'electron',
  'better-sqlite3',
  'trash',
  '@nut-tree-fork/nut-js',
  '@nut-tree-fork/shared',
  '@nut-tree-fork/provider-interfaces',
  'playwright',
  'playwright-core',
  'chromium-bidi',
];

console.log('▸ Building desktop main process…');
await esbuild.build({
  entryPoints: [resolve(desktopSrc, 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: resolve(out, 'main.js'),
  external: nodeExternals,
  define: defines,
  alias: {
    'react-devtools-core': resolve(root, 'src/stubs/devtools-stub.js'),
  },
  banner: {
    js: "import{createRequire as __customCreateRequire}from'module';const require=__customCreateRequire(import.meta.url);",
  },
});
console.log('  ✔ desktop-dist/main.js');

console.log('▸ Building preload…');
await esbuild.build({
  entryPoints: [resolve(desktopSrc, 'preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',   // preload MUST be CJS for Electron
  target: 'node18',
  outfile: resolve(out, 'preload.js'),
  external: ['electron'],
});
console.log('  ✔ desktop-dist/preload.js');

console.log('▸ Building avatar renderer…');
await esbuild.build({
  entryPoints: [resolve(desktopSrc, 'renderer', 'AvatarApp.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome110',
  outfile: resolve(out, 'renderer', 'avatar-bundle.js'),
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('  ✔ desktop-dist/renderer/avatar-bundle.js');

console.log('▸ Building input renderer…');
await esbuild.build({
  entryPoints: [resolve(desktopSrc, 'renderer', 'InputApp.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome110',
  outfile: resolve(out, 'renderer', 'input-bundle.js'),
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('  ✔ desktop-dist/renderer/input-bundle.js');

// Copy HTML files
console.log('▸ Copying HTML files…');
copyFileSync(
  resolve(desktopSrc, 'renderer', 'index.html'),
  resolve(out, 'renderer', 'index.html'),
);
copyFileSync(
  resolve(desktopSrc, 'renderer', 'input.html'),
  resolve(out, 'renderer', 'input.html'),
);
console.log('  ✔ HTML files copied');

console.log('\n✅ Desktop build complete → desktop-dist/');
