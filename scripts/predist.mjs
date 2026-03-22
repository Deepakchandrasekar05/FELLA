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
import { writeFileSync, mkdirSync, appendFileSync, copyFileSync, existsSync, cpSync, readFileSync } from 'fs';
import { join, dirname }        from 'path';
import { fileURLToPath }        from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = join(__dirname, '..');
const distDir   = join(root, 'dist');

// Ensure dist/ exists (build may not have run yet)
mkdirSync(distDir, { recursive: true });

// Write a runtime package.json into dist/.
// This is important: caxa runs `npm dedupe --production` on its build directory.
// If dist/package.json has no dependencies, caxa will prune most of dist/node_modules,
// causing packaged builds to crash with ERR_MODULE_NOT_FOUND.
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const rootDeps = rootPkg?.dependencies ?? {};

const REQUIRED_DEPS = [
  '@nut-tree-fork/nut-js',
  'better-sqlite3',
  'trash',
  'playwright',
];

const distDeps = Object.fromEntries(
  REQUIRED_DEPS.map((name) => [name, rootDeps[name] ?? '*']),
);

writeFileSync(
  join(distDir, 'package.json'),
  JSON.stringify(
    { name: 'fella-runtime', version: '1.0.0', private: true, type: 'module', dependencies: distDeps },
    null,
    2,
  ) + '\n',
);

console.log('▸ Installing runtime packages into dist/node_modules/ …');
// Use explicit installs with --no-save to avoid npm rewriting dist/package.json
// to include a self-link dependency like "fella-cli": "file:..".
execSync(`npm install --prefix dist --omit=dev --no-save ${REQUIRED_DEPS.join(' ')}`, {
  stdio: 'inherit',
  cwd: root,
  env: {
    ...process.env,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  },
});

// Defensive: remove any accidental self-link dependency that could cause caxa's
// internal npm operations to attempt a symlink back to the repo (EPERM on Windows).
try {
  const distPkgPath = join(distDir, 'package.json');
  const distPkg = JSON.parse(readFileSync(distPkgPath, 'utf8'));
  const selfName = String(rootPkg?.name ?? '').trim();
  if (selfName && distPkg?.dependencies?.[selfName]) {
    delete distPkg.dependencies[selfName];
    writeFileSync(distPkgPath, JSON.stringify(distPkg, null, 2) + '\n');
    console.log(`✔  Removed self-link dependency from dist/package.json: ${selfName}`);
  }
} catch {
  // Non-fatal.
}

// Copy the Node runtime into dist/ so the packaged .exe can launch even
// on machines without Node installed or without PATH available in GUI.
if (process.platform === 'win32') {
  try {
    const nodeExe = process.execPath;
    const target = join(distDir, 'node.exe');
    copyFileSync(nodeExe, target);
    console.log('✔  Node runtime copied → dist/node.exe');
  } catch {
    console.log('✖  Could not copy Node runtime into dist/. The packaged exe may require Node on PATH.');
  }
}

// Copy assets into dist/ so caxa bundles them inside the exe
const assetsDir = join(root, 'assets');
const distAssets = join(distDir, 'assets');
cpSync(assetsDir, distAssets, { recursive: true, force: true });
console.log('✔  assets copied to dist/assets/');

// ── Stamp cat icon onto the caxa stub BEFORE caxa appends the archive ────────
// rcedit modifies PE resources in-place. If we stamp AFTER caxa, the appended
// tar archive + JSON footer gets corrupted. Stamping the stub first is safe.
if (process.platform === 'win32') {
  const ico     = join(root, 'assets', 'FELLA_CAT.ico');
  const rcedit  = join(root, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
  const origStub = join(root, 'node_modules', 'caxa', 'stubs', 'stub--win32--x64');
  const stampedStub = join(distDir, 'fella-stub.exe');

  if (!existsSync(ico)) {
    console.log('▸ Generating FELLA_CAT.ico from PNG…');
    execSync('node scripts/gen-ico.mjs', { stdio: 'inherit', cwd: root });
  }

  console.log('▸ Stamping cat icon onto caxa stub…');
  copyFileSync(origStub, stampedStub);
  execSync(
    `"${rcedit}" "${stampedStub}" --set-icon "${ico}"`,
    { stdio: 'inherit' },
  );

  // rcedit rewrites the PE file and strips the last 14 bytes of the original
  // stub, which are the caxa archive separator (\nCAXACAXACAXA\n).  The Go stub
  // uses bytes.Index to find this separator and locate where the tarball starts.
  // Without it, caxa reports "Failed to find archive" and the exe won't launch.
  // Re-append the separator so caxa can build correctly on top of this stub.
  appendFileSync(stampedStub, '\nCAXACAXACAXA\n', 'binary');

  console.log('✔  Stub icon stamped → dist/fella-stub.exe');
}

console.log('✔  predist complete — native packages ready in dist/node_modules/');
