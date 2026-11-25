// Generates the PWA icons: a rounded Material-blue square with a white "L"
// drawn as pixel rectangles (no font rendering needed). Idempotent — run via
// `npm run icons` when rebranding.
//   node scripts/gen-icons.mjs
import fs from "node:fs";
import zlib from "node:zlib";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, painter) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = painter(x, y, size);
      const i = (y * size + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// blue background, rounded corners; white "L" = vertical stem + foot
const BG = [0x0b, 0x57, 0xd0, 255];
const FG = [255, 255, 255, 255];

function icon(x, y, s) {
  const rad = s * 0.18;
  const dx = Math.min(x, s - 1 - x);
  const dy = Math.min(y, s - 1 - y);
  if (dx < rad && dy < rad) {
    const cx = rad - dx;
    const cy = rad - dy;
    if (cx * cx + cy * cy > rad * rad) return [0, 0, 0, 0];
  }
  const t = s * 0.16;
  const x0 = s * 0.32;
  const y0 = s * 0.22;
  const y1 = s * 0.78;
  const x1 = s * 0.68;
  if (x >= x0 && x <= x0 + t && y >= y0 && y <= y1) return FG;
  if (x >= x0 && x <= x1 && y >= y1 - t && y <= y1) return FG;
  return BG;
}

fs.mkdirSync("public", { recursive: true });
for (const size of [192, 512, 180]) {
  fs.writeFileSync(`public/icon-${size}.png`, png(size, icon));
  console.log(`public/icon-${size}.png written`);
}
