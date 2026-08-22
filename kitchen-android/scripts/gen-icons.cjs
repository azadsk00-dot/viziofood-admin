#!/usr/bin/env node
/**
 * Generates placeholder app icons (PNG, RGBA) with zero dependencies:
 *   assets/icon.png          1024×1024  square app icon
 *   assets/adaptive-icon.png 1024×1024  adaptive foreground (transparent bg)
 *   assets/splash-icon.png    768×768   splash glyph (transparent bg)
 *   assets/favicon.png        48×48
 *
 * The glyph is a simple geometric "kitchen bell + order ticket" mark in the
 * brand colours (amber #E7C54A on charcoal #0B0E13). Replace these files with
 * real brand art before store submission — same filenames, same sizes.
 *
 * Run: node scripts/gen-icons.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const AMBER = [231, 197, 74, 255];
const CHARCOAL = [11, 14, 19, 255];
const WHITE = [242, 245, 250, 255];

// ── Minimal PNG encoder ─────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, pixels /* RGBA Uint8Array */) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Drawing helpers (supersampled raster primitives) ────────────────────────

function makeCanvas(size) {
  return { size, pixels: new Uint8Array(size * size * 4) };
}

function fillRect(canvas, x0, y0, x1, y1, color, radius = 0) {
  const { size, pixels } = canvas;
  for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
      if (radius > 0) {
        // Rounded corners: distance to nearest corner centre.
        const cx = Math.max(x0 + radius, Math.min(x, x1 - radius));
        const cy = Math.max(y0 + radius, Math.min(y, y1 - radius));
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      }
      const i = (y * size + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = color[3];
    }
  }
}

function fillCircle(canvas, cx, cy, r, color) {
  const { size, pixels } = canvas;
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(size, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(size, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const i = (y * size + x) * 4;
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = color[3];
      }
    }
  }
}

function drawGlyph(canvas, scale = 1) {
  const s = canvas.size;
  const u = s / 1024; // unit

  // Charcoal rounded-square backdrop (only for non-adaptive icons)
  // — caller draws background first when wanted.

  // Bell dome (amber circle) + dark clapper dot.
  fillCircle(canvas, s / 2, s * 0.44, 300 * u * scale, AMBER);
  fillCircle(canvas, s / 2, s * 0.47, 190 * u * scale, CHARCOAL.slice(0, 3).concat(255));
  // Bell base plate
  fillRect(canvas, s * 0.28, s * 0.68, s * 0.72, s * 0.74, AMBER, 20 * u);
  // Clapper
  fillCircle(canvas, s / 2, s * 0.82, 52 * u, AMBER);
  // Ticket lines on the dome (dark)
  fillRect(canvas, s * 0.42, s * 0.34, s * 0.58, s * 0.38, CHARCOAL.slice(0, 3).concat(255), 14 * u);
  fillRect(canvas, s * 0.42, s * 0.44, s * 0.58, s * 0.48, CHARCOAL.slice(0, 3).concat(255), 14 * u);
  return canvas;
}

// ── Build the assets ────────────────────────────────────────────────────────

const assetsDir = path.join(__dirname, '..', 'assets');

function write(name, buffer) {
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, name), buffer);
  console.log(`Wrote assets/${name} (${buffer.length} bytes)`);
}

// icon.png — square with charcoal bg
{
  const canvas = makeCanvas(1024);
  fillRect(canvas, 0, 0, 1024, 1024, CHARCOAL, 180);
  drawGlyph(canvas);
  write('icon.png', encodePng(1024, 1024, canvas.pixels));
}

// adaptive-icon.png — transparent background, glyph in safe zone
{
  const canvas = makeCanvas(1024);
  drawGlyph(canvas, 0.85);
  write('adaptive-icon.png', encodePng(1024, 1024, canvas.pixels));
}

// splash-icon.png — glyph on transparent bg
{
  const canvas = makeCanvas(768);
  drawGlyph(canvas, 0.9);
  write('splash-icon.png', encodePng(768, 768, canvas.pixels));
}

// favicon.png
{
  const canvas = makeCanvas(48);
  fillRect(canvas, 0, 0, 48, 48, CHARCOAL, 8);
  fillCircle(canvas, 24, 20, 14, AMBER);
  fillCircle(canvas, 24, 21.5, 9, CHARCOAL);
  fillRect(canvas, 13, 33, 35, 36.5, AMBER, 2);
  fillCircle(canvas, 24, 40, 3, AMBER);
  write('favicon.png', encodePng(48, 48, canvas.pixels));
}
