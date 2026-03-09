// 1. Prepend shebang to dist/index.js so `npm install -g` wires it as a CLI.
// 2. Write a tiny CJS wrapper for pkg/caxa entry points.
import { writeFileSync, readFileSync, mkdirSync } from 'fs';

// ── Shebang patch ─────────────────────────────────────────────────────────────
const SHEBANG = '#!/usr/bin/env node\n';
const bundle  = readFileSync('dist/index.js', 'utf8');
if (!bundle.startsWith('#!')) {
  writeFileSync('dist/index.js', SHEBANG + bundle, 'utf8');
  console.log('✔  shebang prepended to dist/index.js');
}

// ── CJS wrapper ───────────────────────────────────────────────────────────────
mkdirSync('dist', { recursive: true });
writeFileSync(
  'dist/run.cjs',
  `'use strict';\n(async () => { await import('./index.js'); })();\n`,
);
console.log('✔  dist/run.cjs written');
