#!/usr/bin/env node
/**
 * Generates app icons (PNG, RGBA) with zero dependencies:
 *   assets/icon.png          1024×1024  square app icon
 *   assets/adaptive-icon.png 1024×1024  adaptive foreground (transparent bg)
 *   assets/splash-icon.png    768×768   splash glyph (transparent bg)
 *   assets/favicon.png        48×48
 *
 * The glyph is a geometric "order ticket" mark in the Orders-app identity
 * (emerald #34D399 on charcoal #0A0D0B) — distinct from the Admin (blue) and
 * Kitchen (amber) apps. Replace with real brand art before store submission:
 * same filenames, same sizes.
 *
 * Run: node scripts/gen-icons.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const EMERALD = [52, 211, 153, 255];
const CHARCOAL = [10, 13, 11, 255];

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

// ── Drawing helpers (raster primitives) ─────────────────────────────────────

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
  const u = (s / 1024) * scale;

  // Order ticket: emerald rounded rectangle…
  fillRect(canvas, s * 0.26, s * 0.22, s * 0.74, s * 0.72, EMERALD, 48 * u);
  // …with dark "text" lines (the order items)…
  fillRect(canvas, s * 0.34, s * 0.32, s * 0.66, s * 0.365, CHARCOAL, 12 * u);
  fillRect(canvas, s * 0.34, s * 0.43, s * 0.60, s * 0.475, CHARCOAL, 12 * u);
  fillRect(canvas, s * 0.34, s * 0.54, s * 0.63, s * 0.585, CHARCOAL, 12 * u);
  // …a notched right edge (the classic ticket tear line)…
  fillCircle(canvas, s * 0.74, s * 0.63, 26 * u, CHARCOAL);
  // …and a bold "total" bar at the bottom of the ticket.
  fillRect(canvas, s * 0.34, s * 0.635, s * 0.56, s * 0.68, CHARCOAL, 10 * u);
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
  fillRect(canvas, 12, 11, 36, 35, EMERALD, 4);
  fillRect(canvas, 16, 16, 32, 19, CHARCOAL, 1.5);
  fillRect(canvas, 16, 22, 29, 25, CHARCOAL, 1.5);
  fillRect(canvas, 16, 28, 26, 31, CHARCOAL, 1.5);
  write('favicon.png', encodePng(48, 48, canvas.pixels));
}
