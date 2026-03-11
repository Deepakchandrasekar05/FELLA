/**
 * bundle.mjs — runs esbuild with secrets injected from .env at build time.
 * This bakes GROQ_API_KEY and Supabase credentials into dist/index.js so
 * end-users don't need a .env file of their own.
 */
import { execSync }    from 'child_process';
import { config }      from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as esbuild    from 'esbuild';
import { copyFileSync } from 'fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Load .env from project root
const { parsed, error } = config({ path: resolve(root, '.env') });
if (error || !parsed) {
  console.error('✖  Could not read .env — secrets will not be bundled.');
  process.exit(1);
}

function def(key) {
  const val = parsed[key] ?? '';
  // esbuild --define replaces the expression literally; wrap in JSON.stringify
  return `--define:process.env.${key}=${JSON.stringify(JSON.stringify(val))}`;
}

const defines = [
  def('GROQ_API_KEY'),
  def('SUPABASE_URL'),
  def('SUPABASE_ANON_KEY'),
].join(' ');

const externalList = [
  'better-sqlite3',
  'trash',
  '@nut-tree-fork/nut-js',
  '@nut-tree-fork/shared',
  '@nut-tree-fork/provider-interfaces',
];

const externals = [
  '--external:better-sqlite3',
  '--external:trash',
  '--external:@nut-tree-fork/nut-js',
  '--external:@nut-tree-fork/shared',
  '--external:@nut-tree-fork/provider-interfaces',
  '--alias:react-devtools-core=./src/stubs/devtools-stub.js',
].join(' ');

// ESM bundle — used at dev/runtime via `node dist/index.js`
const esmCmd = [
  'esbuild src/index.tsx',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--outfile=dist/index.js',
  externals,
  `--banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"`,
  defines,
].join(' ');

// CJS bundle — used as the Node.js SEA entry (SEA only supports CJS).
// Top-level await is wrapped in an async IIFE via banner/footer.
// import.meta.url is polyfilled with a pathToFileURL(__filename) shim.
copyFileSync(resolve(root, 'src/sea-entry.cjs'), resolve(root, 'dist/sea-entry.cjs'));
console.log('  ✔  dist/sea-entry.cjs (SEA bootstrap) copied');

console.log('▸ Bundling with secrets injected from .env…');
execSync(esmCmd, { stdio: 'inherit', cwd: root });
