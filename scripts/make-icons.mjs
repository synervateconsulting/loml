// Generates loml's app icons: a warm candle glow on the night background,
// echoing the login mark. Pure Node — no image libraries. Run with:
//   node scripts/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// --- tiny PNG encoder (8-bit RGBA) ---------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- the artwork ----------------------------------------------------------
const NIGHT = [24, 12, 19]; // #180c13
const CANDLE = [240, 178, 107]; // #f0b26b
const CREAM = [247, 234, 230]; // #f7eae6
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function drawIcon(N) {
  const buf = Buffer.alloc(N * N * 4);
  const cx = N / 2;
  const cy = N * 0.46; // glow sits a touch above centre, like a flame
  const glowR = N * 0.4;
  const coreR = N * 0.12;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      // soft radial halo
      const halo = Math.pow(clamp01(1 - dist / glowR), 2.2);
      // hot centre
      const core = Math.pow(clamp01(1 - dist / coreR), 1.6);
      let r = mix(NIGHT[0], CANDLE[0], halo * 0.92);
      let g = mix(NIGHT[1], CANDLE[1], halo * 0.92);
      let b = mix(NIGHT[2], CANDLE[2], halo * 0.92);
      r = mix(r, CREAM[0], core * 0.9);
      g = mix(g, CREAM[1], core * 0.9);
      b = mix(b, CREAM[2], core * 0.9);
      const i = (y * N + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = 255;
    }
  }
  return encodePNG(N, N, buf);
}

const iconsDir = path.join(root, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const outputs = [
  [path.join(root, 'public', 'apple-touch-icon.png'), 180],
  [path.join(iconsDir, 'icon-192.png'), 192],
  [path.join(iconsDir, 'icon-512.png'), 512],
];

for (const [file, size] of outputs) {
  fs.writeFileSync(file, drawIcon(size));
  console.log(`wrote ${path.relative(root, file)} (${size}px)`);
}
