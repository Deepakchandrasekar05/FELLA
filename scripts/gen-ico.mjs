/**
 * gen-ico.mjs — converts assets/FELLA_CAT.png to assets/FELLA_CAT.ico
 * Embeds four sizes (16, 32, 48, 256) as PNG-in-ICO (Vista+ format).
 * Run: node scripts/gen-ico.mjs
 * Requires: canvas  (already a devDep)
 */
import { createCanvas, loadImage } from 'canvas';
import { writeFileSync }           from 'fs';
import { fileURLToPath }           from 'url';
import path                        from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC  = path.join(root, 'assets', 'FELLA_CAT.png');
const OUT  = path.join(root, 'assets', 'FELLA_CAT.ico');

const SIZES = [16, 32, 48, 256];

const img = await loadImage(SRC);

// Render each size to a PNG buffer
const pngs = SIZES.map(size => {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  return canvas.toBuffer('image/png');
});

// ICO file layout:
//   6-byte ICONDIR header
//   16-byte ICONDIRENTRY × n
//   PNG data blocks
const headerSize   = 6;
const dirEntrySize = 16;
const dataStart    = headerSize + dirEntrySize * SIZES.length;

const parts = [];

// ICONDIR
const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);          // reserved
iconDir.writeUInt16LE(1, 2);          // type = 1 (ICO)
iconDir.writeUInt16LE(SIZES.length, 4);
parts.push(iconDir);

// ICONDIRENTRY for each size
let offset = dataStart;
for (let i = 0; i < SIZES.length; i++) {
  const size = SIZES[i];
  const png  = pngs[i];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);   // width  (0 encodes 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1);   // height (0 encodes 256)
  entry.writeUInt8(0, 2);                         // color count (0 = truecolor)
  entry.writeUInt8(0, 3);                         // reserved
  entry.writeUInt16LE(1, 4);                      // planes
  entry.writeUInt16LE(32, 6);                     // bits per pixel
  entry.writeUInt32LE(png.length, 8);             // size of image data
  entry.writeUInt32LE(offset, 12);                // offset to image data
  parts.push(entry);
  offset += png.length;
}

// PNG image data
for (const png of pngs) parts.push(png);

writeFileSync(OUT, Buffer.concat(parts));
console.log(`✓  ICO written to ${OUT}  (${SIZES.join(', ')} px)`);
