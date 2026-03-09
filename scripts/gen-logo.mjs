/**
 * Generates assets/logo.png — the FELLA ASCII art logo with gradient.
 * Run once: node scripts/gen-logo.mjs
 * Requires: npm install canvas  (dev-only, not bundled)
 */
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT   = path.join(__dir, '..', 'assets', 'logo.png');

const LINES = [
  '███████╗ ███████╗ ██╗      ██╗       █████╗ ',
  '██╔════╝ ██╔════╝ ██║      ██║      ██╔══██╗',
  '█████╗   █████╗   ██║      ██║      ███████║',
  '██╔══╝   ██╔══╝   ██║      ██║      ██╔══██║',
  '██║      ███████╗ ███████╗ ███████╗ ██║  ██║',
  '╚═╝      ╚══════╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝',
];

const COLORS = ['#bbe2fd', '#a9d7fc', '#a0cafd', '#66b9fd', '#49b9ff', '#44a8fb'];

const FONT_SIZE   = 16;
const FONT_FAMILY = 'monospace';
const LINE_H      = 22;
const PAD_X       = 32;
const PAD_Y       = 28;
// Measure canvas width from longest line
const measure = createCanvas(1, 1).getContext('2d');
measure.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
const textW  = Math.max(...LINES.map(l => measure.measureText(l).width));
const W      = Math.ceil(textW + PAD_X * 2);
const H      = PAD_Y + LINES.length * LINE_H + PAD_Y;

const canvas = createCanvas(W, H);
const ctx    = canvas.getContext('2d');

// Background
ctx.fillStyle = '#0d1117';
ctx.beginPath();
ctx.roundRect(0, 0, W, H, 12);
ctx.fill();

// ASCII lines with per-row gradient colour
ctx.font      = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
ctx.textAlign = 'center';
LINES.forEach((line, i) => {
  ctx.fillStyle = COLORS[i] ?? '#ffffff';
  ctx.fillText(line, W / 2, PAD_Y + i * LINE_H + FONT_SIZE);
});


mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, canvas.toBuffer('image/png'));
console.log(`✓  Logo written to ${OUT}  (${W}×${H})`);
