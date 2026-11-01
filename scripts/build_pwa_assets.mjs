#!/usr/bin/env node
// Makes the app icons of the installable app (part 03.06) with nothing but node:zlib: "ERP" in white with an amber bar on the shell's dark blue,
// at the sizes the manifest names. `--check` verifies the files exist with the right sizes without writing (the regression runs it).
import { crc32, deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/icons';
const BG = [0x1c, 0x25, 0x30, 255];
const WHITE = [255, 255, 255, 255];
const AMBER = [0xf2, 0xa9, 0x00, 255];
const GLYPHS = {
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
};

/** RGBA pixels of an icon: `scale` is how much of the square the lettering may use (a maskable icon keeps to the middle 60%). */
function draw(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) px.set(BG, i * 4);
  const cols = 3 * 5 + 2; // three letters of five columns and two gaps
  const cell = Math.max(1, Math.floor((size * scale) / cols));
  const textW = cols * cell;
  const textH = 7 * cell;
  const x0 = Math.floor((size - textW) / 2);
  const y0 = Math.floor((size - textH) / 2) - Math.floor(cell * 0.8);
  const fill = (x, y, w, h, c) => { for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) px.set(c, (yy * size + xx) * 4); };
  [...'ERP'].forEach((ch, li) => GLYPHS[ch].forEach((row, r) => [...row].forEach((bit, c) => { if (bit === '1') fill(x0 + (li * 6 + c) * cell, y0 + r * cell, cell, cell, WHITE); })));
  fill(x0, y0 + textH + Math.floor(cell * 1.2), textW, Math.max(2, Math.floor(cell * 0.8)), AMBER);
  return px;
}

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
};

function png(size, scale) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const px = draw(size, scale);
  for (let y = 0; y < size; y += 1) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filter byte 0 at the start of each row
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 0.72 },
  { file: 'icon-512.png', size: 512, scale: 0.72 },
  { file: 'maskable-512.png', size: 512, scale: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.64 },
];

/** { width, height } of a PNG file's bytes, or null when it is not a PNG. */
export function pngSize(bytes) {
  return bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const check = process.argv.includes('--check');
  const problems = [];
  if (!check) mkdirSync(OUT, { recursive: true });
  for (const i of ICONS) {
    const file = join(OUT, i.file);
    if (!check) writeFileSync(file, png(i.size, i.scale));
    else if (!existsSync(file)) problems.push(`${file} is missing (run node scripts/build_pwa_assets.mjs)`);
    else {
      const s = pngSize(readFileSync(file));
      if (!s || s.width !== i.size || s.height !== i.size) problems.push(`${file} is not a ${i.size} x ${i.size} PNG`);
    }
  }
  if (problems.length) { console.error(`App icons FAILED:\n- ${problems.join('\n- ')}`); process.exit(1); }
  console.log(check ? `App icons OK: ${ICONS.length} files.` : `Wrote ${ICONS.length} icons to ${OUT}.`);
}
