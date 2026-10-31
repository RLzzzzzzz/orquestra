import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve('electron/assets/orquestra.ico');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function blend(pixel, index, color, alpha) {
  const existing = pixel[index + 3] / 255;
  const next = alpha + existing * (1 - alpha);
  if (!next) return;
  pixel[index] = Math.round((color[2] * alpha + pixel[index] * existing * (1 - alpha)) / next);
  pixel[index + 1] = Math.round((color[1] * alpha + pixel[index + 1] * existing * (1 - alpha)) / next);
  pixel[index + 2] = Math.round((color[0] * alpha + pixel[index + 2] * existing * (1 - alpha)) / next);
  pixel[index + 3] = Math.round(next * 255);
}

function stroke(pixel, size, ax, ay, bx, by, width, color) {
  const pad = Math.ceil(width + 1);
  for (let y = Math.max(0, Math.floor(Math.min(ay, by) - pad)); y <= Math.min(size - 1, Math.ceil(Math.max(ay, by) + pad)); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - pad)); x <= Math.min(size - 1, Math.ceil(Math.max(ax, bx) + pad)); x++) {
      const vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, ((x + .5 - ax) * vx + (y + .5 - ay) * vy) / (vx * vx + vy * vy)));
      const distance = Math.hypot(x + .5 - (ax + vx * t), y + .5 - (ay + vy * t));
      const alpha = Math.max(0, Math.min(1, (width / 2 + .65 - distance)));
      if (alpha) blend(pixel, (y * size + x) * 4, color, alpha);
    }
  }
}

function harp(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 256, gold = [231, 192, 95], light = [255, 229, 157], dark = [155, 105, 39];
  const line = (a, b, c, d, width, color) => stroke(pixels, size, a * s, b * s, c * s, d * s, width * s, color);
  // A stylised concert harp: curved neck, soundbox, pillar, and five strings.
  for (let i = 0; i < 32; i++) {
    const t1 = i / 32, t2 = (i + 1) / 32;
    const x = t => 70 + 114 * t - 25 * t * t;
    const y = t => 57 + 13 * t + 55 * t * t;
    line(x(t1), y(t1), x(t2), y(t2), 18, gold);
  }
  line(70, 57, 103, 210, 22, gold);
  line(103, 210, 178, 210, 25, dark);
  line(178, 210, 158, 111, 16, gold);
  line(69, 57, 90, 42, 16, light);
  for (let i = 0; i < 5; i++) {
    const x = 94 + i * 15;
    line(x, 84 + i * 8, x + 18, 190, 4, light);
  }
  return pixels;
}

function dib(size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const source = harp(size), data = Buffer.alloc(source.length);
  for (let row = 0; row < size; row++) source.copy(data, (size - 1 - row) * size * 4, row * size * 4, (row + 1) * size * 4);
  return Buffer.concat([header, data]);
}

const images = sizes.map(dib);
const directory = Buffer.alloc(6 + images.length * 16);
directory.writeUInt16LE(0, 0); directory.writeUInt16LE(1, 2); directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16, size = sizes[index];
  directory[entry] = size === 256 ? 0 : size; directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8); directory.writeUInt32LE(offset, entry + 12); offset += image.length;
});
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.concat([directory, ...images]));
console.log(`Ícone gerado: ${target}`);
