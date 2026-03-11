/**
 * Node.js SEA (Single Executable Application) builder.
 * Builds for the current platform only — run on each OS for that platform's binary.
 * Usage:
 *   node scripts/sea.mjs           → builds for the current OS
 */
import { execSync }                  from 'child_process';
import { copyFileSync, mkdirSync,
         existsSync, createWriteStream,
         readFileSync, writeFileSync }  from 'fs';
import { join, dirname }             from 'path';
import { fileURLToPath }             from 'url';
import { createRequire }             from 'module';
import https                         from 'https';

// Helper: download a file by following redirects
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

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

// Patch PE headers after rcedit/postject modifications:
//  1. Zero the Certificates Directory — rcedit strips the MS Authenticode
//     signature but leaves the directory entry pointing to stale data; signtool
//     tries to parse that stale data and fails with ERROR_BAD_EXE_FORMAT.
//  2. Recompute the Optional Header checksum — postject injects a new section
//     without updating it, which also breaks signtool.
function fixPEHeaders(filePath) {
  const buf = readFileSync(filePath);
  const peOffset      = buf.readUInt32LE(0x3C);
  const optHdrOffset  = peOffset + 24;                  // PE sig(4) + COFF(20)

  // ── Clear the Certificates Directory (index 4 in DataDirectory) ──────────
  // PE32+ optional header: DataDirectory starts at offset 112 (NOT 96 like PE32)
  // because ImageBase is 8 bytes in PE32+ vs 4 bytes in PE32.
  // Offsets within Optional Header:
  //   0  Magic (2)   +2  MajorLinker(1) +1  MinorLinker(1)
  //   +4  SizeOfCode  +4  InitData  +4  UninitData  +4  EntryPoint  +4  BaseOfCode
  //   +8  ImageBase (8 in PE32+)
  //   +4  SectionAlign  +4  FileAlign  +2+2+2+2+2+2  versions  +4 Win32Ver
  //   +4  SizeOfImage  +4  SizeOfHeaders  +4  CheckSum  +2  Subsystem  +2  DllChar
  //   +8+8+8+8  stack/heap reserves  +4  LoaderFlags  +4  NumberOfRvaAndSizes
  //   → DataDirectory[0] starts at offset 112
  // Certificates = DataDirectory[4], each entry is 8 bytes
  const certDirOffset = optHdrOffset + 112 + (4 * 8);  // offset 144 from opt hdr start
  buf.writeUInt32LE(0, certDirOffset);                  // VirtualAddress = 0
  buf.writeUInt32LE(0, certDirOffset + 4);              // Size = 0

  // ── Recompute Optional Header CheckSum ───────────────────────────────────
  const checksumOffset = optHdrOffset + 64;
  buf.writeUInt32LE(0, checksumOffset);

  let sum32 = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    sum32 += buf.readUInt16LE(i);
    if (sum32 > 0xFFFF) sum32 = (sum32 & 0xFFFF) + 1;
  }
  if (buf.length & 1) {
    sum32 += buf[buf.length - 1];
    if (sum32 > 0xFFFF) sum32 = (sum32 & 0xFFFF) + 1;
  }
  const checksum = ((sum32 & 0xFFFF) + (sum32 >> 16)) + buf.length;
  buf.writeUInt32LE(checksum >>> 0, checksumOffset);

  writeFileSync(filePath, buf);
}

// Detect the actual NODE_SEA_FUSE sentinel from the base binary at runtime
// (the UUID differs across Node.js versions, so we don't hardcode it).
function detectFuse(binPath) {
  const buf    = readFileSync(binPath);
  const prefix = Buffer.from('NODE_SEA_FUSE_');
  const idx    = buf.indexOf(prefix);
  if (idx === -1) throw new Error(`NODE_SEA_FUSE sentinel not found in ${binPath}`);
  // Read until the first non-hex character (fuse ends at the colon or null)
  let end = idx + prefix.length;
  while (end < buf.length && /[0-9a-f]/i.test(String.fromCharCode(buf[end]))) end++;
  return buf.slice(idx, end).toString('ascii');
}

mkdirSync('bin', { recursive: true });

// 1. Generate the SEA blob
console.log('▸ Generating SEA blob…');
execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

// 2. Obtain the official Node.js binary as the SEA base.
//    NVM / custom installations lack the NODE_SEA fuse compiled in, so we
//    download the matching official binary from nodejs.org instead.
const nodeVersion = process.version;          // e.g. "v22.12.0"
const arch        = process.arch === 'x64' ? 'x64' : process.arch;
const officialNodeUrl = `https://nodejs.org/dist/${nodeVersion}/win-${arch}/node.exe`;
const officialNodeCache = join(root, `dist/node-sea-base-${nodeVersion}-${arch}.exe`);

if (platform === 'win32') {
  if (!existsSync(officialNodeCache)) {
    console.log(`▸ Downloading official node.exe ${nodeVersion} ${arch} (required for SEA fuse)…`);
    await download(officialNodeUrl, officialNodeCache);
    console.log('  ✔  Downloaded.');
  } else {
    console.log(`▸ Using cached official node.exe (${officialNodeCache})`);
  }
  copyFileSync(officialNodeCache, OUTPUT);
} else {
  console.log(`▸ Copying node binary → ${OUTPUT}`);
  copyFileSync(process.execPath, OUTPUT);
}

// 3. macOS: strip existing code signature before injection
if (platform === 'darwin') {
  try { execSync(`codesign --remove-signature "${OUTPUT}"`, { stdio: 'pipe' }); } catch { /* unsigned builds are fine */ }
}

// 3b. Windows: set icon with rcedit BEFORE injection — rcedit strips the
//     Authenticode signature as a side effect, which is required so that
//     postject can locate the NODE_SEA fuse sentinel in the binary.
if (platform === 'win32') {
  console.log('▸ Generating .ico from FELLA_CAT.png…');
  execSync('node scripts/gen-ico.mjs', { stdio: 'inherit', cwd: root });

  console.log('▸ Setting icon (+ stripping signature) with rcedit…');
  const require = createRequire(import.meta.url);
  const rcedit  = require('rcedit');
  await new Promise((resolve, reject) => {
    rcedit(join(root, OUTPUT), { icon: join(root, 'assets', 'FELLA_CAT.ico') }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
  console.log('✔  Icon set, signature stripped.');
}

// 4. Inject the blob using postject
console.log('▸ Injecting blob…');
const fuse    = detectFuse(OUTPUT);
console.log(`  fuse: ${fuse}`);
const macFlag = platform === 'darwin' ? '--macho-segment-name NODE_SEA' : '';
execSync(
  `npx postject "${OUTPUT}" NODE_SEA_BLOB "${BLOB}" --sentinel-fuse ${fuse} ${macFlag}`.trim(),
  { stdio: 'inherit' },
);

// 4b. Fix PE headers: zero the stale Certificates Directory, recompute checksum
if (platform === 'win32') {
  fixPEHeaders(OUTPUT);
  console.log('  PE headers fixed (cert dir cleared, checksum updated).');
}

// 5. macOS: re-sign with ad-hoc identity
if (platform === 'darwin') {
  try { execSync(`codesign --sign - "${OUTPUT}"`, { stdio: 'pipe' }); } catch { /* optional */ }
}

// 6. Windows: Authenticode-sign the binary so SmartScreen doesn't block it.
//    Uses a self-signed cert stored in CurrentUser\My.  On first run the cert
//    is created and added to CurrentUser\TrustedPublisher so that SmartScreen
//    skips it on this machine without prompting.
//    NOTE: for public distribution replace with a trusted CA code-signing cert.
if (platform === 'win32') {
  console.log('▸ Signing binary…');
  const absOutput = join(root, OUTPUT).replace(/\\/g, '\\');
  const psLines = [
    `$ErrorActionPreference = 'Stop'`,
    `$store = 'Cert:\\CurrentUser\\My'`,
    `$subject = 'CN=Fella CLI Dev'`,
    `$cert = Get-ChildItem $store -CodeSigningCert | Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1`,
    `if (-not $cert) {`,
    `  Write-Host '  Creating self-signed code-signing cert...'`,
    `  $cert = New-SelfSignedCertificate -Subject $subject -CertStoreLocation $store -Type CodeSigning -NotAfter (Get-Date).AddYears(5)`,
    `  $tp = [System.Security.Cryptography.X509Certificates.X509Store]::new('TrustedPublisher','CurrentUser')`,
    `  $tp.Open('ReadWrite'); $tp.Add($cert); $tp.Close()`,
    `  Write-Host '  Cert added to TrustedPublisher - SmartScreen will not block on this machine.'`,
    `}`,
    `$r = Set-AuthenticodeSignature -FilePath '${absOutput}' -Certificate $cert -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256`,
    `if ($r.Status -notin @('Valid','UnknownError')) { Write-Warning "Signing: $($r.Status) - $($r.StatusMessage)" }`,
    `Write-Host ('  Signer: ' + $cert.Subject + '  [' + $cert.Thumbprint.Substring(0,8) + '...]')`,
  ];
  const psFile = join(root, 'dist', '_sign.ps1');
  writeFileSync(psFile, psLines.join('\r\n'), 'utf8');

  try {
    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`,
      { stdio: 'inherit' },
    );
    console.log('✔  Signed.');
  } catch (e) {
    console.warn('⚠  Signing failed (non-fatal):', e.message);
  }
}

console.log(`\n✔  Binary ready: ${OUTPUT}`);
