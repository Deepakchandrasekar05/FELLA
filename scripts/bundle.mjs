/**
 * bundle.mjs — runs esbuild with secrets injected from .env at build time.
 * This bakes GROQ_API_KEY and Supabase credentials into dist/index.js so
 * end-users don't need a .env file of their own.
 */
import { execSync }    from 'child_process';
import { config }      from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

const cmd = [
  'esbuild src/index.tsx',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--outfile=dist/index.js',
  '--external:better-sqlite3',
  '--external:trash',
  '--external:@nut-tree-fork/nut-js',
  '--external:@nut-tree-fork/shared',
  '--external:@nut-tree-fork/provider-interfaces',
  '--alias:react-devtools-core=./src/stubs/devtools-stub.js',
  `--banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"`,
  defines,
].join(' ');

console.log('▸ Bundling with secrets injected from .env…');
execSync(cmd, { stdio: 'inherit', cwd: root });
