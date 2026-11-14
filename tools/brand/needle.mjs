// Turns design/reference/needle-gold.png (gold needle, transparent or white background) into apps/storefront/public/brand/needle.webp:
// background removed, needle laid horizontal (eye left, point right), trimmed. Prints the eye centre for the SVG.
import sharp from 'sharp';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = join(ROOT, 'design/reference/needle-gold.png');
const OUT = join(ROOT, 'apps/storefront/public/brand/needle.webp');

// 1. Key out the white background (and the white seen through the eye).
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const px = Buffer.from(data);
let sx = 0, sy = 0, n = 0;
const pts = [];
for (let i = 0; i < W * H; i++) {
  // Source already has a transparent background (eye included); if it ever arrives on white, key the white out.
  const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], a0 = px[i * 4 + 3] / 255;
  const d = Math.max(255 - r, 255 - g, 255 - b);
  const keyed = a0 < 1 ? a0 : Math.max(0, Math.min(1, (d - 10) / 45));
  const a = Math.min(a0, keyed === 0 && a0 === 1 && d > 10 ? 1 : a0 < 1 ? a0 : keyed);
  px[i * 4 + 3] = Math.round(a * 255);
  if (a > 0.5) { const x = i % W, y = (i / W) | 0; sx += x; sy += y; n++; if (i % 7 === 0) pts.push([x, y]); }
}
// 2. Needle axis by principal component of the opaque pixels.
const mx = sx / n, my = sy / n;
let cxx = 0, cyy = 0, cxy = 0;
for (const [x, y] of pts) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
let angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // radians, screen coords (y down)
const dir = [Math.cos(angle), Math.sin(angle)];
// Which end is the eye? The eye end is thicker: compare spread of pixels near each end.
const proj = pts.map(([x, y]) => (x - mx) * dir[0] + (y - my) * dir[1]);
const lo = proj.reduce((a, b) => Math.min(a, b), Infinity), hi = proj.reduce((a, b) => Math.max(a, b), -Infinity);
const width = (end) => {
  const sel = pts.filter((_, i) => Math.abs(proj[i] - end) < (hi - lo) * 0.12);
  const perp = sel.map(([x, y]) => (x - mx) * -dir[1] + (y - my) * dir[0]);
  return perp.reduce((a, b) => Math.max(a, b), -Infinity) - perp.reduce((a, b) => Math.min(a, b), Infinity);
};
if (width(lo) < width(hi)) angle += Math.PI; // make +dir point from the eye (thick) to the point (thin)
// Rotate so +dir → +x (eye on the left).
const deg = (-angle * 180) / Math.PI;
const rotated = await sharp(px, { raw: { width: W, height: H, channels: 4 } })
  .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer();
const trimmed = await sharp(rotated).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer();
const meta = await sharp(trimmed).metadata();

// 3. Find the eye: on the centre row, the transparent run enclosed by gold near the left end.
const { data: t } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true });
const tw = meta.width, th = meta.height;
const alphaAt = (x, y) => t[(y * tw + x) * 4 + 3];
let best = null;
for (let y = Math.floor(th * 0.3); y < Math.ceil(th * 0.7); y++) {
  let x = 0;
  while (x < tw * 0.4 && alphaAt(x, y) < 128) x++;          // back of the needle
  while (x < tw * 0.4 && alphaAt(x, y) >= 128) x++;          // gold rim
  const s = x;
  while (x < tw * 0.4 && alphaAt(x, y) < 128) x++;          // the eye (hole)
  const e = x;
  if (e > s && e - s > (best?.len ?? 0) && alphaAt(Math.min(tw - 1, e), y) >= 128) best = { len: e - s, cx: (s + e) / 2, y };
}
const finalW = 480; // ~4x the on-screen length on desktop
const k = finalW / tw;
await sharp(trimmed).resize({ width: finalW }).webp({ quality: 88, alphaQuality: 100 }).toFile(OUT);
console.log(JSON.stringify({ rotatedBy: +deg.toFixed(2), size: [finalW, Math.round(th * k)], eye: best ? { x: +(best.cx * k).toFixed(1), y: +(best.y * k).toFixed(1), len: +(best.len * k).toFixed(1) } : null }));
