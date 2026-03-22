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

const defines = {
  'process.env.GROQ_API_KEY': JSON.stringify(parsed['GROQ_API_KEY'] ?? ''),
  'process.env.SUPABASE_URL': JSON.stringify(parsed['SUPABASE_URL'] ?? ''),
  'process.env.SUPABASE_ANON_KEY': JSON.stringify(parsed['SUPABASE_ANON_KEY'] ?? ''),
};

const externalList = [
  'better-sqlite3',
  'trash',
  '@nut-tree-fork/nut-js',
  '@nut-tree-fork/shared',
  '@nut-tree-fork/provider-interfaces',
  // Keep Playwright and its dynamic BiDi internals external for Node runtime resolution.
  'playwright',
  'playwright-core',
  'chromium-bidi',
];

const aliases = {
  'react-devtools-core': './src/stubs/devtools-stub.js',
};

// CJS bundle — used as the Node.js SEA entry (SEA only supports CJS).
// Top-level await is wrapped in an async IIFE via banner/footer.
// import.meta.url is polyfilled with a pathToFileURL(__filename) shim.
copyFileSync(resolve(root, 'src/sea-entry.cjs'), resolve(root, 'dist/sea-entry.cjs'));
console.log('  ✔  dist/sea-entry.cjs (SEA bootstrap) copied');

console.log('▸ Bundling with secrets injected from .env…');
await esbuild.build({
  entryPoints: [resolve(root, 'src/index.tsx')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(root, 'dist/index.js'),
  external: externalList,
  alias: aliases,
  banner: {
    js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
  },
  define: defines,
});
