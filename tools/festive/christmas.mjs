// Christmas artwork, drawn as gold-thread (zari) embroidery to match the brand. Writes SVGs for the storefront and
// the admin preview. Deterministic: re-running gives the same files. Run: node tools/festive/christmas.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outs = ['apps/storefront/public/festive/christmas', 'apps/admin/public/festive/christmas'].map((p) => join(root, p));
let seed = 1225;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const r = (a, b) => a + rnd() * (b - a);
const f = (n) => Math.round(n * 10) / 10;
const GOLD = ['#9A6E22', '#B98A35', '#C79A3E', '#D9AE55', '#E4C27A'];
const files = {};

const goldDefs = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset=".45" stop-color="#D9AE55"/><stop offset="1" stop-color="#9A6E22"/></linearGradient>
<radialGradient id="berry" cx=".35" cy=".32" r=".75"><stop offset="0" stop-color="#C9405C"/><stop offset=".6" stop-color="#8E1D33"/><stop offset="1" stop-color="#4A0C18"/></radialGradient>
<radialGradient id="pearl" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#F6EBDD"/><stop offset="1" stop-color="#D8C3A8"/></radialGradient>`;

/** A zari star: long four-point star over a shorter diagonal one, with a pearl centre. */
function star(cx, cy, R, id = 'g') {
  const pts = (n, ro, ri, rot) => Array.from({ length: n * 2 }, (_, i) => {
    const a = rot + (i * Math.PI) / n, rr = i % 2 ? ri : ro;
    return `${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`;
  }).join(' ');
  return `<polygon points="${pts(4, R * 0.62, R * 0.2, Math.PI / 4 - Math.PI / 2)}" fill="url(#${id})" opacity=".85" stroke="#7A5418" stroke-width=".5"/>
<polygon points="${pts(4, R, R * 0.24, -Math.PI / 2)}" fill="url(#${id})" stroke="#7A5418" stroke-width=".6"/>
<path d="M${cx} ${f(cy - R * 0.85)}V${f(cy + R * 0.85)}M${f(cx - R * 0.85)} ${cy}H${f(cx + R * 0.85)}" stroke="#FFF4D0" stroke-width=".5" opacity=".7"/>
<circle cx="${cx}" cy="${cy}" r="${f(R * 0.16)}" fill="url(#pearl)"/>`;
}

// ───────── the arch garland: embroidered pine following the logo's arch ─────────
{
  const W = 600, H = 100, cx = 300, A = 120, y0 = 12, D = 20, reach = 166;
  const bez = (t, p0, p1, p2, p3) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
  // left half, from the centre outwards: the arch curve, then along the header line
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.01) pts.push([bez(t, cx, cx - 0.5 * A, cx - 0.55 * A, cx - A), bez(t, y0 + D, y0 + D, y0, y0) + 5]);
  for (let x = cx - A - 2; x >= cx - A - reach; x -= 2) pts.push([x, y0 + 5]);
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = len[len.length - 1];
  const at = (s) => {
    let i = len.findIndex((v) => v >= s); if (i <= 0) i = 1;
    const [x0, yA] = pts[i - 1], [x1, yB] = pts[i], k = (s - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return { x: x0 + (x1 - x0) * k, y: yA + (yB - yA) * k, a: Math.atan2(yB - yA, x1 - x0) };
  };
  const shades = GOLD.map(() => []);
  const needle = (x, y, ang, l) => { shades[Math.floor(r(0, GOLD.length))].push(`M${f(x)} ${f(y)}l${f(Math.cos(ang) * l)} ${f(Math.sin(ang) * l)}`); };
  let stem = `M${f(pts[0][0])} ${f(pts[0][1])}` + pts.slice(1).map(([x, y]) => `L${f(x)} ${f(y)}`).join('');
  // satin-stitch needles swept back towards the tip
  for (let s = 6; s < L - 2; s += 2.6) {
    const p = at(s), taper = 1 - s / L;
    const l = 6.5 + 11 * Math.min(1, taper * 1.5) + r(-1.2, 1.2);
    needle(p.x, p.y, p.a - 0.62 + r(-0.12, 0.12), l);
    needle(p.x, p.y, p.a + 0.62 + r(-0.12, 0.12), l);
  }
  // a few side sprigs hanging below the stem
  let sprigs = '';
  for (const s of [48, 104, 160, 222, 270]) {
    const p = at(s), dir = p.a - 0.95, sl = 15 - s / 30;
    const ex = p.x + Math.cos(dir) * sl, ey = p.y + Math.sin(dir) * sl;
    sprigs += `M${f(p.x)} ${f(p.y)}L${f(ex)} ${f(ey)}`;
    for (let k = 3; k < sl; k += 2.4) {
      const sx = p.x + Math.cos(dir) * k, sy = p.y + Math.sin(dir) * k, nl = 5.5 * (1 - k / sl) + 2;
      needle(sx, sy, dir - 0.65, nl); needle(sx, sy, dir + 0.65, nl);
    }
  }
  let beads = '';
  for (const s of [36, 124, 214, 286]) {
    const p = at(s);
    for (const [dx, dy] of [[0, 6], [4.4, 7.6], [1.8, 10.8]]) beads += `<circle cx="${f(p.x + dx)}" cy="${f(p.y + dy)}" r="2.3" fill="url(#berry)"/><circle cx="${f(p.x + dx - .7)}" cy="${f(p.y + dy - .8)}" r=".6" fill="#fff" opacity=".7"/>`;
  }
  for (const s of [74, 168, 250]) { const p = at(s); beads += `<circle cx="${f(p.x + r(-2, 2))}" cy="${f(p.y - 3)}" r="1.6" fill="url(#pearl)"/>`; }
  const half = `<g><path d="${stem}${sprigs}" stroke="#9A6E22" stroke-width="1.1" fill="none" stroke-linecap="round"/>${shades.map((p, i) => `<path d="${p.join('')}" stroke="${GOLD[i]}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`).join('')}${beads}</g>`;
  const c = y0 + D + 5;
  const knot = [[-4.2, 1.6], [4.2, 1.6], [0, 4.6]].map(([dx, dy]) => `<circle cx="${f(cx + dx)}" cy="${f(c + dy)}" r="2.6" fill="url(#berry)"/><circle cx="${f(cx + dx - .8)}" cy="${f(c + dy - .9)}" r=".7" fill="#fff" opacity=".7"/>`).join('')
    + `<circle cx="${cx - 7.5}" cy="${c - 1.5}" r="1.7" fill="url(#pearl)"/><circle cx="${cx + 7.5}" cy="${c - 1.5}" r="1.7" fill="url(#pearl)"/>`;
  const pend = `<path d="M${cx} ${c + 7}v7" stroke="#B98A35" stroke-width=".8"/>${star(cx, c + 23, 10)}${knot}`;
  files['arch-garland.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${goldDefs}</defs>${half}<g transform="translate(${2 * cx} 0) scale(-1 1)">${half}</g>${pend}</svg>`;
}

// ───────── hanging zari star ─────────
files['star.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="-20 -20 40 40"><defs>${goldDefs}</defs>${star(0, 0, 18)}</svg>`;

// ───────── footer band: the zari hem, re-embroidered with stitched fir trees and stars ─────────
{
  const W = 96, H = 48, tx = 24, top = 12, bot = 36;
  const shades = GOLD.map(() => []);
  for (let y = top + 3; y <= bot - 3; y += 2.2) {
    const k = (y - top) / (bot - top), l = 2.5 + 9 * k;
    shades[Math.floor(r(1, GOLD.length))].push(`M${tx} ${f(y)}l${f(-l * 0.82)} ${f(l * 0.57)}M${tx} ${f(y)}l${f(l * 0.82)} ${f(l * 0.57)}`);
  }
  files['band.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${goldDefs}</defs>
<path d="M0 6.5H${W}M0 9.5H${W}M0 38.5H${W}M0 41.5H${W}" stroke="#C79A3E" stroke-width="1"/>
<path d="M${tx} ${top + 2}V${bot + 1}" stroke="#B98A35" stroke-width="1" stroke-linecap="round"/>
${shades.map((p, i) => `<path d="${p.join('')}" stroke="${GOLD[i]}" stroke-width=".9" stroke-linecap="round" fill="none"/>`).join('')}
<circle cx="${tx - 5}" cy="29" r="1.6" fill="url(#berry)"/><circle cx="${tx + 4}" cy="24" r="1.6" fill="url(#berry)"/><circle cx="${tx + 6}" cy="32" r="1.4" fill="url(#pearl)"/>
${star(tx, top, 4.5)}${star(72, 24, 8)}</svg>`;
}

for (const dir of outs) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, svg] of Object.entries(files)) writeFileSync(join(dir, name), svg.replace(/\n\s*/g, '\n'));
}
console.log(`Wrote ${Object.keys(files).join(', ')}`);
