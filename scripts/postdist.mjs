/**
 * postdist.mjs — stamps the cat icon onto bin/fella-win.exe after caxa builds it.
 * npm automatically runs this as the "postdist" lifecycle hook.
 * No-op on non-Windows platforms.
 */
import { execSync }      from 'child_process';
import { existsSync }    from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root    = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe     = join(root, 'bin', 'fella-win.exe');
const ico     = join(root, 'assets', 'FELLA_CAT.ico');
const rcedit  = join(root, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');

if (process.platform !== 'win32') process.exit(0);

if (!existsSync(exe)) {
  console.error('postdist: bin/fella-win.exe not found — skipping icon stamp.');
  process.exit(0);
}

if (!existsSync(ico)) {
  console.log('postdist: FELLA_CAT.ico not found — generating from PNG…');
  execSync('node scripts/gen-ico.mjs', { stdio: 'inherit', cwd: root });
}

console.log('▸ Stamping cat icon onto bin/fella-win.exe…');

// Windows Defender / SmartScreen may scan the newly-written exe and hold a
// transient lock on it.  Retry up to 5 times with increasing delays.
const cmd = `"${rcedit}" "${exe}" --set-icon "${ico}" --set-file-version "1.0.0.0" --set-product-version "1.0.0.0"`;

let lastErr;
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    execSync(cmd, { stdio: 'inherit' });
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    const delayMs = attempt * 1500;
    console.log(`  Attempt ${attempt} failed — retrying in ${delayMs / 1000}s…`);
    await new Promise(r => setTimeout(r, delayMs));
  }
}
if (lastErr) throw lastErr;

console.log('✔  Icon stamped successfully.');
