// Renders the Pulse icon SVG into the 16/48/128 PNGs required by the
// Chrome extension manifest. Run on demand:
//
//   npm run icons
//
// Source of truth: src/icons/icon.svg (square logomark).

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SRC = resolve(root, 'src/icons/icon.svg');
const SIZES = [16, 48, 128];

const svg = await readFile(SRC);

for (const size of SIZES) {
  const out = resolve(root, `src/icons/icon-${size}.png`);
  // density scales the SVG rasterization. We pick a comfortable density so
  // 16px gets at least a 96-dpi render and 128px a 384-dpi render — sharp
  // handles the downscale to the requested size cleanly.
  const density = Math.max(96, size * 6);
  await sharp(svg, { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(out);
  console.log(`wrote ${out}`);
}
