#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const isTsx =
  process.env.FELLA_TSX_LOADED === '1' ||
  process.execArgv.some((arg) => arg.includes('tsx'));

if (!isTsx) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, FELLA_TSX_LOADED: '1' },
    }
  );
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
} else {
  await import('../cli/index.jsx');
}
