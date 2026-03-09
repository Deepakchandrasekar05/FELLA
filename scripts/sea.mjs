/**
 * Node.js SEA (Single Executable Application) builder.
 * Builds for the current platform only — run on each OS for that platform's binary.
 * Usage:
 *   node scripts/sea.mjs           → builds for the current OS
 */
import { execSync }                  from 'child_process';
import { copyFileSync, mkdirSync }   from 'fs';
import { join, dirname }             from 'path';
import { fileURLToPath }             from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = join(__dirname, '..');

process.chdir(root);

const platform = process.platform; // 'win32' | 'linux' | 'darwin'

const OUTPUT = {
  win32:  'bin/fella-win.exe',
  linux:  'bin/fella-linux',
  darwin: 'bin/fella-macos',
}[platform] ?? `bin/fella-${platform}`;

const BLOB    = 'dist/sea-prep.blob';
const FUSE    = 'NODE_SEA_FUSE_fce680ab2cc467b346dea5f4701801e3';

mkdirSync('bin', { recursive: true });

// 1. Generate the SEA blob
console.log('▸ Generating SEA blob…');
execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

// 2. Copy the running node binary as the base executable
console.log(`▸ Copying node binary → ${OUTPUT}`);
copyFileSync(process.execPath, OUTPUT);

// 3. macOS: strip existing code signature before injection
if (platform === 'darwin') {
  try { execSync(`codesign --remove-signature "${OUTPUT}"`, { stdio: 'pipe' }); } catch { /* unsigned builds are fine */ }
}

// 4. Inject the blob using postject
console.log('▸ Injecting blob…');
const macFlag = platform === 'darwin' ? '--macho-segment-name NODE_SEA' : '';
execSync(
  `npx postject "${OUTPUT}" NODE_SEA_BLOB "${BLOB}" --sentinel-fuse ${FUSE} ${macFlag}`.trim(),
  { stdio: 'inherit' },
);

// 5. macOS: re-sign with ad-hoc identity
if (platform === 'darwin') {
  try { execSync(`codesign --sign - "${OUTPUT}"`, { stdio: 'pipe' }); } catch { /* optional */ }
}

console.log(`\n✔  Binary ready: ${OUTPUT}`);
