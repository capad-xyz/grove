/**
 * Generates the Grove app icon.
 *
 * Committed as a generator rather than a binary so the mark stays editable and
 * its reasons stay readable. Run `node packaging/make-icon.mjs`.
 *
 * The mark is Grove's own commit-graph gutter: two lanes, a node on each, and
 * the fork between them. It is the one shape that is unmistakably this app —
 * the gutter is the thing you look at every time you use it — and it survives
 * being 16px in a taskbar, which most logotypes do not.
 *
 * Colours are the design system's, unmodified: --ink for the field, --paper for
 * the strokes. No accent, because there isn't one.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZE = 512;
const INK = [0x0b, 0x0b, 0x0d];
const PAPER = [0xf1, 0xf0, 0xec];

// RGBA canvas, transparent to start.
const px = new Uint8Array(SIZE * SIZE * 4);

const put = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const i = (y * SIZE + x) * 4;
  const src = a;
  const dst = (px[i + 3] / 255) * (1 - src);
  const out = src + dst;
  if (out <= 0) return;
  px[i] = (r * src + px[i] * dst) / out;
  px[i + 1] = (g * src + px[i + 1] * dst) / out;
  px[i + 2] = (b * src + px[i + 2] * dst) / out;
  px[i + 3] = Math.round(out * 255);
};

/** Coverage of a pixel by a shape, sampled 4x4 for antialiasing. */
const aa = (x, y, inside) => {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
    }
  }
  return hits / 16;
};

const fill = (colour, inside) => {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = aa(x, y, inside);
      if (a > 0) put(x, y, colour, a);
    }
  }
};

const roundedRect = (x0, y0, x1, y1, r) => (x, y) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r || (x > x0 + r && x < x1 - r) || (y > y0 + r && y < y1 - r);
  }
  return false;
};

const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const ring = (cx, cy, r, w) => (x, y) => {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r && d >= r - w;
};

/** Thick line segment with rounded caps. */
const seg = (x1, y1, x2, y2, w) => (x, y) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return (x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2 <= (w / 2) ** 2;
};

// --- The field -------------------------------------------------------------
fill(INK, roundedRect(0, 0, SIZE - 1, SIZE - 1, 112));

// --- The gutter ------------------------------------------------------------
// A trunk, a node on it, and a branch forking to a second node. An earlier
// version also merged the branch back; at icon sizes the extra strokes closed
// into a blob, and four segments is simply more than 16 pixels can hold. Two
// lanes, two nodes, one fork.
const LX = 192;
const RX = 330;
const W = 32;
const NODE = 56;

fill(PAPER, seg(LX, 92, LX, SIZE - 92, W)); // trunk, full height
fill(PAPER, seg(LX, 196, RX, 322, W)); // fork, node centre to node centre

// Nodes last, so they sit on top of the strokes feeding them.
//
// The trunk node gets no ink halo: it is the same colour as the lane it sits
// on, and cutting a gap around it severed the fork into a floating stub. A
// commit on its lane is continuous with it. The hollow node does need one, or
// the incoming stroke fills the ring and it stops reading as hollow.
fill(PAPER, disc(LX, 196, NODE));
fill(INK, disc(RX, 322, NODE + 16));
fill(PAPER, ring(RX, 322, NODE, 22));

// --- PNG encoding ----------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
// 10..12 default: deflate, adaptive filtering, no interlace.

// Each scanline is prefixed with its filter byte (0 = none).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(import.meta.dirname, 'icon.png');
writeFileSync(out, png);
console.log(`wrote ${out}  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(1)} KB`);
