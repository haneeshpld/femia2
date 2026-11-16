// Festive artwork for every theme, drawn as zari (gold-thread) embroidery to match the brand. Writes SVGs for the
// storefront (public/festive/<theme>) and the admin preview. Deterministic: re-running gives the same files.
// Run: node tools/festive/art.mjs
//
// Each theme has the same kinds of pieces, so the storefront treats them alike:
//   strip.svg   repeats along the header's lower edge (the one bold element)
//   <drops>     ornaments that hang from the header on threads (wide screens)
//   hem.svg     repeats along the top of the footer
//   mark.svg    replaces the small gold diamonds (used as a mask)
//   seal.svg    the motif in the middle of the home-page seal
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let seed = 1225;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const r = (a, b) => a + rnd() * (b - a);
const f = (n) => Math.round(n * 100) / 100;
const GOLD = ['#9A6E22', '#B98A35', '#C79A3E', '#D9AE55', '#E4C27A'];
const svg = (w, h, body, defs = '', vb = `0 0 ${w} ${h}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}"><defs>${GOLD_DEFS}${defs}</defs>${body}</svg>`;

const GOLD_DEFS = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset=".45" stop-color="#D9AE55"/><stop offset="1" stop-color="#9A6E22"/></linearGradient>
<linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset=".5" stop-color="#D2A24A"/><stop offset="1" stop-color="#8E6420"/></linearGradient>
<linearGradient id="gh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9A6E22"/><stop offset=".35" stop-color="#E4C27A"/><stop offset=".55" stop-color="#F6E3AE"/><stop offset="1" stop-color="#9A6E22"/></linearGradient>
<radialGradient id="pearl" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#F6EBDD"/><stop offset="1" stop-color="#D8C3A8"/></radialGradient>`;

/** Points of an n-point star around (cx, cy). */
const starPts = (cx, cy, n, ro, ri, rot = -Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => {
  const a = rot + (i * Math.PI) / n, rr = i % 2 ? ri : ro;
  return `${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`;
}).join(' ');

/** Satin-stitch needles in five gold shades: collect strokes, then draw them as five paths. */
function stitches() {
  const shades = GOLD.map(() => []);
  return {
    add(x, y, ang, l, from = 0) { shades[Math.floor(r(from, GOLD.length))].push(`M${f(x)} ${f(y)}l${f(Math.cos(ang) * l)} ${f(Math.sin(ang) * l)}`); },
    draw(w = 1.1) { return shades.map((p, i) => (p.length ? `<path d="${p.join('')}" stroke="${GOLD[i]}" stroke-width="${w}" fill="none" stroke-linecap="round"/>` : '')).join(''); },
  };
}

/** Walk a polyline by arc length. */
function walker(pts) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = len[len.length - 1];
  const at = (s) => {
    let i = len.findIndex((v) => v >= s); if (i <= 0) i = 1;
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], k = (s - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, a: Math.atan2(y1 - y0, x1 - x0) };
  };
  return { L, at };
}
/** A thread sagging between two pins at the same height (a parabola, close enough to a catenary). */
const sag = (x0, x1, y, depth, step = 2) => {
  const pts = [];
  for (let x = x0; x <= x1 + 0.001; x += step) { const u = (x - x0) / (x1 - x0); pts.push([x, y + depth * 4 * u * (1 - u)]); }
  return pts;
};
const pathOf = (pts) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}`;
/** The hem's frame: two fine gold lines above and below, like the edge of a sari border. */
const hemLines = (W) => `<path d="M0 6.5H${W}M0 9.5H${W}M0 38.5H${W}M0 41.5H${W}" stroke="#C79A3E" stroke-width="1"/>`;

const themes = {};

// ═════════════════════════════ Christmas: pine & berry ═════════════════════════════
{
  const files = {};
  const defs = `<radialGradient id="berry" cx=".35" cy=".32" r=".75"><stop offset="0" stop-color="#C9405C"/><stop offset=".6" stop-color="#8E1D33"/><stop offset="1" stop-color="#4A0C18"/></radialGradient>`;
  const berry = (x, y, rr = 2.4) => `<circle cx="${f(x)}" cy="${f(y)}" r="${rr}" fill="url(#berry)"/><circle cx="${f(x - rr * .3)}" cy="${f(y - rr * .35)}" r="${f(rr * .28)}" fill="#fff" opacity=".7"/>`;
  /** A zari star: long four-point star over a shorter diagonal one, with a pearl centre. */
  const star = (cx, cy, R) => `<polygon points="${starPts(cx, cy, 4, R * 0.62, R * 0.2, Math.PI / 4 - Math.PI / 2)}" fill="url(#g)" opacity=".85" stroke="#7A5418" stroke-width=".5"/>
<polygon points="${starPts(cx, cy, 4, R, R * 0.24)}" fill="url(#g)" stroke="#7A5418" stroke-width=".6"/>
<path d="M${cx} ${f(cy - R * 0.85)}V${f(cy + R * 0.85)}M${f(cx - R * 0.85)} ${cy}H${f(cx + R * 0.85)}" stroke="#FFF4D0" stroke-width=".5" opacity=".7"/>
<circle cx="${cx}" cy="${cy}" r="${f(R * 0.16)}" fill="url(#pearl)"/>`;

  // strip: an embroidered pine swag, sagging between pins; berries and a pearl at each pin
  {
    const W = 240, H = 48, y0 = 6;
    const pts = sag(0, W, y0, 20);
    const { L, at } = walker(pts);
    const st = stitches();
    for (let s = 1; s < L - 1; s += 1.6) {
      const p = at(s);
      const u = s / L, thick = 0.8 + 0.35 * Math.sin(Math.PI * u); // fullest in the middle of each swag
      const l = (10 + r(-1.5, 1.5)) * thick;
      // needles swept back along the rope on both sides, a second shorter layer for depth, and a few hanging down
      for (const side of [-1, 1]) st.add(p.x, p.y, p.a + Math.PI + side * (0.62 + r(-0.18, 0.18)), l);
      for (const side of [-1, 1]) if (rnd() < 0.6) st.add(p.x, p.y, p.a + Math.PI + side * (1.05 + r(-0.2, 0.2)), l * 0.62, 2);
      if (rnd() < 0.3) st.add(p.x, p.y, Math.PI / 2 + r(-0.6, 0.6), l * 0.75);
    }
    let sprigs = '';
    for (const s of [L * 0.3, L * 0.7]) { // two small sprigs hanging from each swag
      const p = at(s), dir = Math.PI / 2 + (s < L / 2 ? 0.35 : -0.35), sl = 10;
      sprigs += `M${f(p.x)} ${f(p.y)}l${f(Math.cos(dir) * sl)} ${f(Math.sin(dir) * sl)}`;
      for (let k = 2; k < sl; k += 2.2) {
        const sx = p.x + Math.cos(dir) * k, sy = p.y + Math.sin(dir) * k, nl = 4.6 * (1 - k / sl) + 1.8;
        st.add(sx, sy, dir - 0.7, nl); st.add(sx, sy, dir + 0.7, nl);
      }
    }
    const mid = at(L / 2);
    const pins = [0, W].map((x) => berry(x - 3.4, y0 + 3) + berry(x + 3.4, y0 + 3) + berry(x, y0 + 6.6, 2.6) + `<circle cx="${x}" cy="${y0 - 1}" r="2" fill="url(#pearl)"/>`).join('');
    files['strip.svg'] = svg(W, H, `<path d="${pathOf(pts)}${sprigs}" stroke="#9A6E22" stroke-width="1.2" fill="none" stroke-linecap="round"/>${st.draw()}
${berry(mid.x - 5, mid.y + 4, 2)}${berry(mid.x + 4, mid.y + 5, 2)}<circle cx="${f(mid.x)}" cy="${f(mid.y + 2)}" r="1.5" fill="url(#pearl)"/>${pins}`, defs);
  }

  files['star.svg'] = svg(40, 40, star(0, 0, 18), defs, '-20 -20 40 40');
  files['mark.svg'] = files['star.svg'];
  files['seal.svg'] = files['star.svg'];

  // baubles: pine and berry glass with a gold cap and a zari band
  for (const [name, a, b, c] of [['bauble-pine', '#3E7A5C', '#1F4D3A', '#0E2A1E'], ['bauble-berry', '#C9405C', '#8E1D33', '#4A0C18']]) {
    files[`${name}.svg`] = svg(36, 46, `
<path d="M18 0.8a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2Z" fill="none" stroke="url(#g)" stroke-width="1.1"/>
<rect x="13" y="5.6" width="10" height="5.4" rx="1.2" fill="url(#gh)" stroke="#7A5418" stroke-width=".5"/>
<path d="M13.6 7.4h8.8M13.6 9.2h8.8" stroke="#7A5418" stroke-width=".35" opacity=".7"/>
<circle cx="18" cy="27" r="16" fill="url(#bulb)"/>
<path d="M2.6 25.4q15.4 6 30.8 0" stroke="url(#gh)" stroke-width="2.2" fill="none"/>
<path d="M2.4 28.6q15.6 6 31.2 0" stroke="url(#gh)" stroke-width=".8" fill="none" opacity=".9"/>
${[5, 9.5, 14, 18, 22, 26.5, 31].map((x) => `<circle cx="${x}" cy="${f(26.8 + 3 * Math.sin(Math.PI * (x - 2.6) / 30.8))}" r=".7" fill="#FFF4D0"/>`).join('')}
<ellipse cx="11.5" cy="19.5" rx="4.2" ry="2.6" transform="rotate(-35 11.5 19.5)" fill="#fff" opacity=".35"/>
<circle cx="10.2" cy="20.2" r="1.1" fill="#fff" opacity=".7"/>`,
    `<radialGradient id="bulb" cx=".36" cy=".32" r=".8"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`);
  }

  // hem: stitched fir trees and stars between two gold lines
  {
    const W = 96, tx = 24, top = 12, bot = 36;
    const st = stitches();
    for (let y = top + 3; y <= bot - 3; y += 2.2) {
      const k = (y - top) / (bot - top), l = 2.5 + 9 * k;
      st.add(tx, y, Math.PI - 0.6, l, 1); st.add(tx, y, 0.6, l, 1);
    }
    files['hem.svg'] = svg(W, 48, `${hemLines(W)}<path d="M${tx} ${top + 2}V${bot + 1}" stroke="#B98A35" stroke-width="1" stroke-linecap="round"/>${st.draw(0.9)}
${berry(tx - 5, 29, 1.6)}${berry(tx + 4, 24, 1.6)}<circle cx="${tx + 6}" cy="32" r="1.4" fill="url(#pearl)"/>${star(tx, top, 4.5)}${star(72, 24, 8)}`, defs);
  }
  themes.christmas = files;
}

// ═════════════════════════════ Ramzan & Eid al-Fitr: lantern night ═════════════════════════════
{
  const files = {};
  const glass = `<radialGradient id="glow" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#FFF3C9"/><stop offset=".45" stop-color="#F5C766"/><stop offset="1" stop-color="#B8641F"/></radialGradient>
<radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFE3A0" stop-opacity=".55"/><stop offset="1" stop-color="#FFE3A0" stop-opacity="0"/></radialGradient>
<radialGradient id="bulb" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF8E0"/><stop offset=".35" stop-color="#FFD98A"/><stop offset="1" stop-color="#F0A848" stop-opacity="0"/></radialGradient>`;
  /** A crescent opening to the right, its back at (cx - R): drawn as a filled path between two arcs. */
  const crescent = (cx, cy, R, k = 0.78, dx = 0.42) => {
    const ri = R * k, ix = cx + R * dx;
    // the two circles meet where (x-cx)²+(y-cy)²=R² and (x-ix)²+(y-cy)²=ri²
    const xm = (R * R - ri * ri + ix * ix - cx * cx) / (2 * (ix - cx)), ym = Math.sqrt(Math.max(0, R * R - (xm - cx) ** 2));
    return `M${f(xm)} ${f(cy - ym)}A${f(R)} ${f(R)} 0 1 0 ${f(xm)} ${f(cy + ym)}A${f(ri)} ${f(ri)} 0 1 1 ${f(xm)} ${f(cy - ym)}Z`;
  };

  // the fanous: domed brass lantern with pointed-arch windows of amber glass, a crescent finial and a bead drop
  files['lantern.svg'] = svg(44, 100, `
<circle cx="22" cy="54" r="22" fill="url(#halo)"/>
<path d="M22 0.8a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 1 1 0-4.8Z" fill="none" stroke="url(#g)" stroke-width="1"/>
<path d="${crescent(21, 10.5, 4.2, 0.8, 0.4)}" fill="url(#g)" stroke="#7A5418" stroke-width=".35"/>
<path d="M22 15v4" stroke="url(#gv)" stroke-width="1.4"/>
<path d="M10 33C10 25 15.5 20 22 19C28.5 20 34 25 34 33Z" fill="url(#gv)" stroke="#7A5418" stroke-width=".5"/>
${[[15, 28], [19, 25.4], [22, 24.8], [25, 25.4], [29, 28], [17.2, 30.6], [22, 29.6], [26.8, 30.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".95" fill="#5A3A12"/><circle cx="${x}" cy="${y}" r=".5" fill="#FFE7A6"/>`).join('')}
<rect x="7.5" y="33" width="29" height="3.4" rx="1" fill="url(#gh)" stroke="#7A5418" stroke-width=".4"/>
<path d="M9.5 36.4L12 68H32L34.5 36.4Z" fill="url(#glow)"/>
<path d="M14 40.5V64M30 40.5V64" stroke="#7A5418" stroke-width=".4" opacity=".6"/>
<path d="M17 64V45Q17 40 22 37.8Q27 40 27 45V64Z" fill="#FFF6D6" opacity=".55"/>
<path d="M17 64V45Q17 40 22 37.8Q27 40 27 45V64" fill="none" stroke="url(#gv)" stroke-width="1.3"/>
<path d="M11.2 64.6L10.3 46Q10.4 41.6 13.2 39.6Q15 41.6 15.2 45.6L15.6 64.6" fill="none" stroke="url(#gv)" stroke-width="1"/>
<path d="M32.8 64.6L33.7 46Q33.6 41.6 30.8 39.6Q29 41.6 28.8 45.6L28.4 64.6" fill="none" stroke="url(#gv)" stroke-width="1"/>
<path d="M22 44v16M18.6 52h6.8" stroke="#C48A2E" stroke-width=".55" opacity=".8"/>
<polygon points="${starPts(22, 52, 8, 2.8, 1.5, -Math.PI / 2)}" fill="#FFF8E2" opacity=".85"/>
<path d="M9.5 36.4L12 68H32L34.5 36.4" fill="none" stroke="url(#gv)" stroke-width="1.4" stroke-linejoin="round"/>
<rect x="10.5" y="67.6" width="23" height="3.2" rx="1" fill="url(#gh)" stroke="#7A5418" stroke-width=".4"/>
<path d="M12 70.8Q14 79 22 84Q30 79 32 70.8Z" fill="url(#gv)" stroke="#7A5418" stroke-width=".5"/>
${[15.5, 19, 22, 25, 28.5].map((x, i) => `<circle cx="${x}" cy="${[73.6, 75.8, 76.6, 75.8, 73.6][i]}" r=".7" fill="#FFE7A6" opacity=".9"/>`).join('')}
<path d="M22 84v5" stroke="url(#gv)" stroke-width="1"/>
<circle cx="22" cy="91" r="2.2" fill="url(#pearl)"/>
<path d="M22 93.2v3.4" stroke="#B98A35" stroke-width=".7"/>
<circle cx="22" cy="97.6" r="1.2" fill="url(#g)"/>`, glass);

  // crescent with a small star in its curve; the thread meets the top of the crescent's back
  const star5 = (cx, cy, R) => `<polygon points="${starPts(cx, cy, 5, R, R * 0.42)}" fill="url(#g)" stroke="#7A5418" stroke-width=".4" stroke-linejoin="round"/>`;
  files['crescent.svg'] = svg(44, 46, `
<path d="M22 0.8a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4Z" fill="none" stroke="url(#g)" stroke-width="1"/>
<path d="${crescent(22, 24, 18, 0.8, 0.36)}" fill="url(#g)" stroke="#7A5418" stroke-width=".5"/>
<path d="${crescent(22, 24, 15.6, 0.86, 0.32)}" fill="none" stroke="#FFF4D0" stroke-width=".5" opacity=".55"/>
<path d="M33.6 19.2v5" stroke="#B98A35" stroke-width=".55"/>
${star5(33.6, 28.4, 4.6)}`);
  files['star.svg'] = svg(24, 24, star5(12, 12.6, 10.5));
  files['mark.svg'] = svg(40, 40, `<path d="${crescent(17, 20, 17, 0.8, 0.36)}" fill="#000"/><polygon points="${starPts(30.5, 20, 5, 6.4, 2.7)}" fill="#000"/>`);
  files['seal.svg'] = svg(48, 48, `<path d="${crescent(20, 24, 19, 0.8, 0.36)}" fill="url(#g)" stroke="#7A5418" stroke-width=".5"/>${star5(34.6, 23, 6)}`);

  // strip: a strand of warm lights on a zari thread, sagging between pins, with small stars and a crescent hanging from it
  {
    const W = 180, y0 = 4, pts = sag(0, W, y0, 12);
    const { L, at } = walker(pts);
    let bulbs = '';
    for (let s = 9; s < L - 4; s += 15) {
      const p = at(s);
      bulbs += `<circle cx="${f(p.x)}" cy="${f(p.y + 3.4)}" r="5" fill="url(#bulb)" opacity=".75"/><path d="M${f(p.x)} ${f(p.y)}v1.6" stroke="#9A6E22" stroke-width=".7"/><ellipse cx="${f(p.x)}" cy="${f(p.y + 3.2)}" rx="1.45" ry="1.9" fill="#FFF1C8" stroke="#E9A94A" stroke-width=".4"/>`;
    }
    const hang = (x, len, art) => { const p = at(x / W * L); return `<path d="M${f(p.x)} ${f(p.y)}v${len}" stroke="#B98A35" stroke-width=".6"/>${art(p.x, p.y + len)}`; };
    const small = (x, y) => star5(x, y + 3.4, 3.4);
    const moon = (x, y) => `<path d="${crescent(x, y + 5, 5, 0.78, 0.4)}" fill="url(#g)" stroke="#7A5418" stroke-width=".3"/>`;
    files['strip.svg'] = svg(W, 40, `<path d="${pathOf(pts)}" stroke="url(#gh)" stroke-width="1" fill="none"/>${hang(45, 7, small)}${hang(90, 9, moon)}${hang(135, 7, small)}${bulbs}
${[0, W].map((x) => `<circle cx="${x}" cy="${y0}" r="2" fill="url(#pearl)"/>`).join('')}`, glass);
  }

  // hem: a mehndi (henna) vine, mango leaves turning above and below, dotted trails and small flowers
  {
    const W = 120, mid = 24, amp = 6;
    const vine = Array.from({ length: 61 }, (_, i) => [i * 2, mid + amp * Math.sin((i * 2 / W) * Math.PI * 2)]);
    const leaf = (x, y, up) => { // a paisley: round belly, tip curling back
      const s = up ? -1 : 1;
      return `<path d="M${x} ${y}C${x - 6} ${y + s * 2} ${x - 7} ${y + s * 10} ${x} ${y + s * 11}C${x + 6} ${y + s * 11} ${x + 7} ${y + s * 4} ${x + 2.4} ${y + s * 2.4}C${x + 1} ${y + s * 1.6} ${x + 0.6} ${y + s * .6} ${x} ${y}Z" fill="none" stroke="url(#g)" stroke-width="1"/>
<path d="M${x} ${y + s * 3.4}C${x - 2.6} ${y + s * 4.6} ${x - 2.8} ${y + s * 8.2} ${x} ${y + s * 8.4}" fill="none" stroke="#C79A3E" stroke-width=".6"/><circle cx="${x + 1}" cy="${y + s * 6.6}" r=".9" fill="#D9AE55"/>`;
    };
    const flower = (x, y) => [0, 1, 2, 3].map((k) => { const a = k * Math.PI / 2 + Math.PI / 4; return `<ellipse cx="${f(x + Math.cos(a) * 2.2)}" cy="${f(y + Math.sin(a) * 2.2)}" rx="1.6" ry=".9" transform="rotate(${f(a * 180 / Math.PI)} ${f(x + Math.cos(a) * 2.2)} ${f(y + Math.sin(a) * 2.2)})" fill="none" stroke="#D9AE55" stroke-width=".55"/>`; }).join('') + `<circle cx="${x}" cy="${y}" r=".8" fill="#E4C27A"/>`;
    const almond = (x, y, s) => { // a small leaf leaning off the vine, with its vein
      const tx = x + 4.6, ty = y + s * 6.4;
      return `<path d="M${f(x)} ${f(y)}Q${f(x - 1.6)} ${f(y + s * 5)} ${f(tx)} ${f(ty)}Q${f(x + 5.4)} ${f(y + s * 1.6)} ${f(x)} ${f(y)}Z" fill="none" stroke="#D9AE55" stroke-width=".8"/><path d="M${f(x + .6)} ${f(y + s * .8)}L${f(tx - 1)} ${f(ty - s * 1.2)}" stroke="#C79A3E" stroke-width=".45"/>`;
    };
    const dots = (x, y, dx, dy) => [1, 2, 3].map((k) => `<circle cx="${f(x + dx * k)}" cy="${f(y + dy * k)}" r="${f(.85 - k * .15)}" fill="#D9AE55"/>`).join('');
    files['hem.svg'] = svg(W, 48, `${hemLines(W)}<path d="${pathOf(vine)}" stroke="url(#gh)" stroke-width="1.1" fill="none"/>
${leaf(30, mid + amp - 1, true)}${leaf(90, mid - amp + 1, false)}${flower(60, mid)}${flower(0, mid)}${flower(W, mid)}
${[[12, 1], [48, -1], [72, 1], [108, -1]].map(([x, s]) => almond(x, mid + amp * Math.sin((x / W) * Math.PI * 2), s)).join('')}
${dots(30, mid + amp + 1, 0, 2.3)}${dots(90, mid - amp - 1, 0, -2.3)}`);
  }
  themes.ramzan = files;
}

// ═════════════════════════════ Bakrid: toran & jaali ═════════════════════════════
{
  const files = {};
  const teal = `<linearGradient id="teal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B5A62"/><stop offset="1" stop-color="#0C3A40"/></linearGradient>
<radialGradient id="enamel" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#2A7680"/><stop offset="1" stop-color="#0C3A40"/></radialGradient>
<radialGradient id="saffron" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#F7CF7A"/><stop offset=".6" stop-color="#D9902B"/><stop offset="1" stop-color="#9C5C14"/></radialGradient>`;
  /** The eight-point star: two squares turned 45° to each other. */
  const star8 = (cx, cy, R, fill, stroke = '#7A5418', sw = .5) => {
    const sq = (rot) => Array.from({ length: 4 }, (_, i) => { const a = rot + i * Math.PI / 2; return `${f(cx + Math.cos(a) * R)},${f(cy + Math.sin(a) * R)}`; }).join(' ');
    return `<polygon points="${starPts(cx, cy, 8, R, R * 0.76, -Math.PI / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
<polygon points="${sq(-Math.PI / 2)}" fill="none" stroke="${stroke}" stroke-width="${sw * .6}" opacity=".5"/><polygon points="${sq(-Math.PI / 4)}" fill="none" stroke="${stroke}" stroke-width="${sw * .6}" opacity=".5"/>`;
  };

  // strip: a toran (doorway valance) of cusped arches in deep teal, edged in zari, a gold star in each arch,
  // and a small saffron bead hanging where the arches meet
  {
    const W = 56, top = 5, H = 40;
    // the cusped arch: three lobes, the middle one deepest
    const edge = `M0 ${top + 9}C4 ${top + 9} 7 ${top + 12} 9 ${top + 15}C10.5 ${top + 13} 13 ${top + 12.4} 15.5 ${top + 13.6}C17.5 ${top + 18} 22 ${top + 21.5} 28 ${top + 22}C34 ${top + 21.5} 38.5 ${top + 18} 40.5 ${top + 13.6}C43 ${top + 12.4} 45.5 ${top + 13} 47 ${top + 15}C49 ${top + 12} 52 ${top + 9} ${W} ${top + 9}`;
    files['strip.svg'] = svg(W, H, `
<path d="${edge}V0H0Z" fill="url(#teal)"/>
<path d="M0 ${top}H${W}" stroke="url(#gh)" stroke-width="2.2"/><path d="M0 ${top + 3.2}H${W}" stroke="#C79A3E" stroke-width=".5" opacity=".9"/>
<path d="${edge}" fill="none" stroke="url(#gh)" stroke-width="1.6"/>
<path d="${edge}" fill="none" stroke="#E4C27A" stroke-width=".45" transform="translate(0 -2.2)" opacity=".75"/>
${star8(28, top + 11.6, 3.6, 'url(#g)', '#7A5418', .4)}
${[9, 47].map((x) => `<circle cx="${x}" cy="${top + 10.2}" r=".9" fill="#E4C27A"/>`).join('')}
${[0, W].map((x) => `<path d="M${x} ${top + 9}v6" stroke="#B98A35" stroke-width=".7"/><circle cx="${x}" cy="${top + 17.4}" r="2.4" fill="url(#saffron)"/><path d="M${x} ${top + 19.8}v3.4" stroke="#B98A35" stroke-width=".6"/><circle cx="${x}" cy="${top + 24.2}" r="1" fill="url(#g)"/>`).join('')}`, teal);
  }

  // the medallion: an eight-point star in zari around a teal enamel star, an ivory rosette at its heart
  const rosette = (cx, cy, R) => Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4, x = cx + Math.cos(a) * R * .55, y = cy + Math.sin(a) * R * .55;
    return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(R * .45)}" ry="${f(R * .2)}" transform="rotate(${f(a * 180 / Math.PI)} ${f(x)} ${f(y)})" fill="#FBF5EA" stroke="#B98A35" stroke-width=".4"/>`;
  }).join('') + `<circle cx="${cx}" cy="${cy}" r="${f(R * .22)}" fill="url(#g)"/>`;
  const medallion = (cx, cy, R) => `${star8(cx, cy, R, 'url(#g)', '#7A5418', .6)}${star8(cx, cy, R * .72, 'url(#enamel)', '#C79A3E', .5)}
<circle cx="${cx}" cy="${cy}" r="${f(R * .4)}" fill="#0C3A40" stroke="#E4C27A" stroke-width=".5"/>${rosette(cx, cy, R * .36)}`;
  files['medallion.svg'] = svg(44, 52, `<path d="M22 0.8a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4Z" fill="none" stroke="url(#g)" stroke-width="1"/><path d="M22 5.2v3" stroke="#B98A35" stroke-width=".8"/>${medallion(22, 29, 20)}`, teal);
  files['seal.svg'] = svg(48, 48, medallion(24, 24, 22), teal);
  files['mark.svg'] = svg(40, 40, `<polygon points="${starPts(20, 20, 8, 19, 14.5)}" fill="#000"/>`);

  // tassel: a saffron bead, a gold cap and fine gold threads
  {
    const threads = Array.from({ length: 13 }, (_, i) => { const x0 = 10 + (i - 6) * .55, x1 = 10 + (i - 6) * 1.05; return `<path d="M${f(x0)} 26Q${f(x0 + (x1 - x0) * .4)} 38 ${f(x1)} 48" stroke="${GOLD[i % GOLD.length]}" stroke-width=".8" fill="none" stroke-linecap="round"/>`; }).join('');
    files['tassel.svg'] = svg(20, 50, `<path d="M10 0v6" stroke="#B98A35" stroke-width=".7"/><circle cx="10" cy="9.2" r="3.6" fill="url(#saffron)"/><circle cx="8.8" cy="8" r=".9" fill="#fff" opacity=".6"/>
<path d="M10 12.8v2.4" stroke="#B98A35" stroke-width=".8"/><path d="M6.4 15.2h7.2l-1 5.4c-.2 1-.9 1.6-1.8 1.6h-1.6c-.9 0-1.6-.6-1.8-1.6Z" fill="url(#gv)" stroke="#7A5418" stroke-width=".4"/>
<path d="M6.8 17.4h6.4" stroke="#7A5418" stroke-width=".3" opacity=".7"/><rect x="7.6" y="22" width="4.8" height="4.4" rx="1" fill="url(#gh)"/>${threads}
<path d="M7 26.6h6" stroke="#7A5418" stroke-width=".4"/>`, teal);
  }

  // hem: a jaali band of eight-point stars linked by a fine lattice
  {
    const W = 64, mid = 24;
    files['hem.svg'] = svg(W, 48, `${hemLines(W)}
<path d="M0 ${mid}H${W}" stroke="#B98A35" stroke-width=".5" opacity=".7"/>
<path d="M16 12L32 ${mid}L16 36L0 ${mid}ZM48 12L64 ${mid}L48 36L32 ${mid}Z" fill="none" stroke="#C79A3E" stroke-width=".7"/>
${star8(16, mid, 8.5, 'none', '#D9AE55', 1)}${star8(48, mid, 8.5, 'none', '#D9AE55', 1)}
<circle cx="16" cy="${mid}" r="2.2" fill="url(#saffron)"/><circle cx="48" cy="${mid}" r="2.2" fill="url(#saffron)"/>
${[0, 32, 64].map((x) => `<polygon points="${starPts(x, mid, 4, 3.4, 1.3)}" fill="url(#g)"/>`).join('')}`, teal);
  }
  themes.bakrid = files;
}

/** A flower seen from above: n petals around a centre. */
const bloom = (cx, cy, R, n, petal, centre, rot = 0, pw = 0.42) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i * 2 * Math.PI) / n, x = cx + Math.cos(a) * R * 0.5, y = cy + Math.sin(a) * R * 0.5;
  return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(R * 0.5)}" ry="${f(R * pw)}" transform="rotate(${f(a * 180 / Math.PI)} ${f(x)} ${f(y)})" fill="${petal}"/>`;
}).join('') + (centre ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.26)}" fill="${centre}"/>` : '');
const loop = (x, y = 0.8, rr = 2.2) => `<path d="M${x} ${y}a${rr} ${rr} 0 1 1 0 ${rr * 2}a${rr} ${rr} 0 1 1 0-${rr * 2}Z" fill="none" stroke="url(#g)" stroke-width="1"/>`;

// ═════════════════════════════ Onam: thoranam, pookalam & kasavu ═════════════════════════════
{
  const files = {};
  const defs = `<radialGradient id="mari" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#FFC94A"/><stop offset=".6" stop-color="#F29A1E"/><stop offset="1" stop-color="#C96A0E"/></radialGradient>
<radialGradient id="mari2" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#FFE27A"/><stop offset=".65" stop-color="#F7C22E"/><stop offset="1" stop-color="#D99A12"/></radialGradient>
<linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6E9E36"/><stop offset=".55" stop-color="#3F6F22"/><stop offset="1" stop-color="#284C14"/></linearGradient>
<linearGradient id="kasavu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3DA9A"/><stop offset=".5" stop-color="#D6A647"/><stop offset="1" stop-color="#A9781F"/></linearGradient>`;
  /** A marigold: rings of small ruffled petals, darker towards the middle. */
  const marigold = (cx, cy, R, fill = 'url(#mari)') => {
    let out = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${fill}"/>`;
    for (const [rr, n, op] of [[0.86, 14, 0.55], [0.58, 10, 0.6], [0.3, 6, 0.7]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rr * 3, x = cx + Math.cos(a) * R * rr, y = cy + Math.sin(a) * R * rr;
        out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(R * 0.2)}" fill="#B9560A" opacity="${op * 0.35}"/><circle cx="${f(x - R * .05)}" cy="${f(y - R * .06)}" r="${f(R * 0.13)}" fill="#FFE59A" opacity="${op * 0.5}"/>`;
      }
    }
    return out;
  };
  const mango = (x, y0, L, w) => `<path d="M${x} ${y0}C${f(x - w)} ${f(y0 + L * 0.28)} ${f(x - w * 0.55)} ${f(y0 + L * 0.82)} ${x} ${y0 + L}C${f(x + w * 0.55)} ${f(y0 + L * 0.82)} ${f(x + w)} ${f(y0 + L * 0.28)} ${x} ${y0}Z" fill="url(#leaf)"/>
<path d="M${x} ${y0 + 1}Q${f(x + w * 0.12)} ${f(y0 + L * 0.5)} ${x} ${y0 + L - 1}" stroke="#A9C873" stroke-width=".6" fill="none" opacity=".8"/>`;

  // strip: a thoranam: mango leaves and marigolds on a string, as hung over Kerala doorways
  {
    const W = 96, y = 4;
    const items = [mango(24, y, 34, 7.2), mango(72, y, 30, 6.6), mango(12, y, 20, 4.6), mango(36, y, 22, 4.8), mango(60, y, 20, 4.6), mango(84, y, 22, 4.8)];
    files['strip.svg'] = svg(W, 52, `<path d="M0 ${y}H${W}" stroke="#7A5418" stroke-width="1.2"/>${items.slice(2).join('')}${items.slice(0, 2).join('')}
${[0, 48, W].map((x) => marigold(x, y + 6, 7.2, x === 48 ? 'url(#mari2)' : 'url(#mari)')).join('')}`, defs);
  }
  // pookalam: the flower carpet, as a medallion: rings of marigold, chethi red, thumba white and leaf green
  const pookalam = (cx, cy, R) => {
    let o = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#E8891A"/>`;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      o += `<path d="M${cx} ${cy}L${f(cx + Math.cos(a - .19) * R)} ${f(cy + Math.sin(a - .19) * R)}A${R} ${R} 0 0 1 ${f(cx + Math.cos(a + .19) * R)} ${f(cy + Math.sin(a + .19) * R)}Z" fill="${i % 2 ? '#F7C22E' : '#F29A1E'}"/>`;
    }
    o += `<circle cx="${cx}" cy="${cy}" r="${f(R * .78)}" fill="#B8321F"/>`;
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; o += `<circle cx="${f(cx + Math.cos(a) * R * .66)}" cy="${f(cy + Math.sin(a) * R * .66)}" r="${f(R * .07)}" fill="#FFF8EC"/>`; }
    o += `<circle cx="${cx}" cy="${cy}" r="${f(R * .54)}" fill="#F7E7C0"/>`;
    o += `<polygon points="${starPts(cx, cy, 8, R * .52, R * .3, -Math.PI / 2)}" fill="#4F7F2A"/>`;
    o += `<circle cx="${cx}" cy="${cy}" r="${f(R * .3)}" fill="#F7C22E"/>${bloom(cx, cy, R * .26, 6, '#FFFFFF', '#E8891A')}`;
    return o + `<circle cx="${cx}" cy="${cy}" r="${f(R - .5)}" fill="none" stroke="#7A5418" stroke-width=".8"/>`;
  };
  files['pookalam.svg'] = svg(44, 52, `${loop(22)}<path d="M22 5.2v3" stroke="#B98A35" stroke-width=".8"/>${pookalam(22, 29, 20)}`, defs);
  files['seal.svg'] = svg(48, 48, pookalam(24, 24, 22.5), defs);
  // a hanging string of marigolds, smaller towards the end, finished with a mango leaf
  {
    let o = `<path d="M11 0V96" stroke="#7A5418" stroke-width=".8"/>`;
    [[11, 8.6], [27, 8], [42, 7.4], [56, 6.8], [69, 6.2], [81, 5.6]].forEach(([y, rr], i) => { o += marigold(11, y, rr, i % 2 ? 'url(#mari2)' : 'url(#mari)'); });
    files['marigolds.svg'] = svg(22, 112, o + mango(11, 86, 24, 5), defs);
  }
  // hem: a kasavu border, the gold band of a Kerala sari, with a small woven peak pattern
  {
    const W = 48;
    files['hem.svg'] = svg(W, 48, `${hemLines(W)}<rect x="0" y="15" width="${W}" height="18" fill="url(#kasavu)"/>
<path d="M0 17.5H${W}M0 30.5H${W}" stroke="#FFF1C8" stroke-width=".6" opacity=".8"/>
<path d="${[0, 12, 24, 36].map((x) => `M${x} 29l6-9l6 9`).join('')}" fill="none" stroke="#FFF6DA" stroke-width=".9" opacity=".85"/>
${[6, 18, 30, 42].map((x) => `<circle cx="${x}" cy="27" r=".9" fill="#FFF6DA"/>`).join('')}`, defs);
  }
  files['mark.svg'] = svg(40, 40, bloom(20, 20, 19, 8, '#000', '#000', 0, 0.36));
  themes.onam = files;
}

// ═════════════════════════════ Vishu: kanikonna, the golden shower ═════════════════════════════
{
  const files = {};
  const defs = `<radialGradient id="konna" cx=".45" cy=".4" r=".65"><stop offset="0" stop-color="#FFF2A0"/><stop offset=".55" stop-color="#F8D224"/><stop offset="1" stop-color="#D9A40C"/></radialGradient>
<linearGradient id="vleaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7FAE3E"/><stop offset="1" stop-color="#3A6A1E"/></linearGradient>`;
  /** A konna flower: five rounded yellow petals and a few curved stamens. */
  const konna = (cx, cy, R, rot = 0) => `${bloom(cx, cy, R, 5, 'url(#konna)', null, rot, 0.46)}
<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * .22)}" fill="#E6A90E"/>
${[-0.5, 0, 0.5].map((d) => `<path d="M${f(cx)} ${f(cy)}q${f(R * (0.3 + d))} ${f(R * .3)} ${f(R * (0.15 + d))} ${f(R * .7)}" stroke="#A86B08" stroke-width="${f(R * .06)}" fill="none"/>`).join('')}`;
  const bud = (cx, cy, rr) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr * .75)}" ry="${f(rr)}" fill="#E9CB3A"/><path d="M${f(cx)} ${f(cy - rr)}v${f(-rr * .5)}" stroke="#8DA43A" stroke-width=".5"/>`;
  /** A hanging raceme: big flowers near the top, buds at the tip. */
  const raceme = (x, y0, L, scale = 1) => {
    let o = `<path d="M${x} ${y0}Q${x + 1.5} ${y0 + L * 0.5} ${x} ${y0 + L}" stroke="#7E8F2C" stroke-width="${f(0.9 * scale)}" fill="none"/>`;
    const n = Math.round(L / 6.5);
    for (let i = n - 1; i >= 0; i--) {
      const u = i / n, y = y0 + 4 + u * (L - 6), side = i % 2 ? 1 : -1, rr = (6.4 - 3.8 * u) * scale;
      const fx = x + side * (2.2 + 2.4 * (1 - u)) * scale;
      o += `<path d="M${x} ${f(y - 2)}L${f(fx)} ${f(y)}" stroke="#8DA43A" stroke-width=".5"/>`;
      o += u > 0.66 ? bud(fx, y, rr * .55) : konna(fx, y, rr, i * 0.7);
    }
    return o;
  };
  const leaflets = (x0, y0, ang, n, sz) => { // a pinnate leaf: pairs of oval leaflets along a rachis
    let o = `<path d="M${x0} ${y0}l${f(Math.cos(ang) * n * sz * 1.1)} ${f(Math.sin(ang) * n * sz * 1.1)}" stroke="#4E7A24" stroke-width=".6"/>`;
    for (let i = 1; i <= n; i++) {
      const px = x0 + Math.cos(ang) * i * sz * 1.1, py = y0 + Math.sin(ang) * i * sz * 1.1;
      for (const s of [-1, 1]) {
        const a = ang + s * 0.9, lx = px + Math.cos(a) * sz * .55, ly = py + Math.sin(a) * sz * .55;
        o += `<ellipse cx="${f(lx)}" cy="${f(ly)}" rx="${f(sz * .55)}" ry="${f(sz * .26)}" transform="rotate(${f(a * 180 / Math.PI)} ${f(lx)} ${f(ly)})" fill="url(#vleaf)"/>`;
      }
    }
    return o;
  };
  // strip: a konna branch along the header, leaves and a few blossom sprays
  {
    const W = 150, pts = sag(0, W, 4, 6);
    const tw = `<path d="${pathOf(pts)}" stroke="#6B4F22" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    const lv = leaflets(20, 6, 0.55, 4, 6.5) + leaflets(96, 9, 0.35, 4, 6) + leaflets(132, 7, 2.6, 3, 6);
    const spray = (x, y) => konna(x, y, 4.6, 0.3) + konna(x + 7, y + 3, 3.8, 1.1) + konna(x - 6, y + 4, 3.4, 2) + bud(x + 2, y + 9, 2);
    files['strip.svg'] = svg(W, 46, `${tw}${lv}${spray(62, 11)}${raceme(75, 9, 30, .7)}${spray(140, 9)}${spray(-10, 9)}`, defs);
  }
  files['konna.svg'] = svg(36, 124, `<path d="M18 0v6" stroke="#7E8F2C" stroke-width=".9"/>${leaflets(18, 6, 2.5, 2, 6)}${leaflets(18, 6, 0.64, 2, 6)}${raceme(18, 6, 116)}`, defs);
  files['konna-short.svg'] = svg(36, 84, `<path d="M18 0v6" stroke="#7E8F2C" stroke-width=".9"/>${raceme(18, 6, 76)}`, defs);
  files['seal.svg'] = svg(48, 48, `${leaflets(24, 24, 2.3, 2, 8)}${leaflets(24, 24, 0.85, 2, 8)}${konna(24, 22, 15, 0.3)}`, defs);
  files['mark.svg'] = svg(40, 40, bloom(20, 20, 20, 5, '#000', '#000', -Math.PI / 2, 0.5));
  {
    const W = 72;
    files['hem.svg'] = svg(W, 48, `${hemLines(W)}<path d="M0 24H${W}" stroke="#B98A35" stroke-width=".6" opacity=".7"/>
${leaflets(12, 24, -0.3, 2, 5.5)}${leaflets(60, 24, Math.PI + 0.3, 2, 5.5)}${konna(36, 24, 8.5, 0.2)}${konna(0, 24, 5, 1)}${konna(W, 24, 5, 1)}`, defs);
  }
  themes.vishu = files;
}

// ═════════════════════════════ India: tricolour bunting, kites and the chakra ═════════════════════════════
{
  const files = {};
  const SAFFRON = '#F08A24', GREEN = '#178A3C', NAVY = '#1E2F8C';
  const defs = `<linearGradient id="saf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFAE52"/><stop offset="1" stop-color="#E0761A"/></linearGradient>
<linearGradient id="wht" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EDE9E2"/></linearGradient>
<linearGradient id="grn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24A24E"/><stop offset="1" stop-color="#11712F"/></linearGradient>`;
  /** The Ashoka Chakra: a rim, 24 spokes and a hub. */
  const chakra = (cx, cy, R, col = NAVY, sw = 1) => {
    let o = `<circle cx="${cx}" cy="${cy}" r="${f(R)}" fill="none" stroke="${col}" stroke-width="${f(R * .1 * sw)}"/><circle cx="${cx}" cy="${cy}" r="${f(R * .16)}" fill="${col}"/>`;
    let sp = '';
    for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; sp += `M${cx} ${cy}L${f(cx + Math.cos(a) * R * .95)} ${f(cy + Math.sin(a) * R * .95)}`; }
    return o + `<path d="${sp}" stroke="${col}" stroke-width="${f(R * .045 * sw)}"/>`;
  };
  // strip: pennant bunting in the three colours, sagging on a thread
  {
    const W = 144, pts = sag(0, W, 3, 9), { L, at } = walker(pts);
    const cols = ['url(#saf)', 'url(#wht)', 'url(#grn)'];
    let o = '';
    for (let i = 0; i < 6; i++) {
      const a = at(((i * 24 + 3) / W) * L), b = at(((i * 24 + 21) / W) * L), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2, tx = mx + Math.cos(ang) * 22, ty = my + Math.sin(ang) * 22;
      o += `<path d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}L${f(tx)} ${f(ty)}Z" fill="${cols[i % 3]}" stroke="${i % 3 === 1 ? '#D9D2C6' : 'none'}" stroke-width=".5"/>`;
      if (i % 3 === 1) o += chakra(f(mx + Math.cos(ang) * 7), f(my + Math.sin(ang) * 7), 3.2, NAVY, 0.9);
    }
    files['strip.svg'] = svg(W, 40, `<path d="${pathOf(pts)}" stroke="#8C7B63" stroke-width=".9" fill="none"/>${o}`, defs);
  }
  // a tricolour rosette badge with the chakra at its heart and two ribbon tails
  {
    let pleats = '';
    for (let i = 0; i < 28; i++) {
      const a = i * Math.PI * 2 / 28, a2 = a + Math.PI * 2 / 28;
      pleats += `<path d="M22 28L${f(22 + Math.cos(a) * 19)} ${f(28 + Math.sin(a) * 19)}L${f(22 + Math.cos(a2) * 19)} ${f(28 + Math.sin(a2) * 19)}Z" fill="${i % 2 ? '#E0761A' : '#FFA040'}"/>`;
    }
    files['rosette.svg'] = svg(44, 70, `${loop(22)}<path d="M22 5.2v3" stroke="#8C7B63" stroke-width=".8"/>
<path d="M15 38L9 66L14.5 61L18 67L21 40Z" fill="url(#grn)"/><path d="M29 38L35 66L29.5 61L26 67L23 40Z" fill="url(#saf)"/>
${pleats}<circle cx="22" cy="28" r="13.5" fill="url(#wht)"/><circle cx="22" cy="28" r="13.5" fill="none" stroke="${GREEN}" stroke-width="2.6"/>${chakra(22, 28, 8.5)}`, defs);
  }
  // a kite (patang) in the three colours, with a small tail
  files['kite.svg'] = svg(44, 70, `<path d="M22 0v6" stroke="#8C7B63" stroke-width=".7"/>
<path d="M22 6L39 26L22 48L5 26Z" fill="url(#wht)" stroke="#CFC6B6" stroke-width=".5"/>
<path d="M22 6L39 26L33.4 26Q22 20 10.6 26L5 26Z" fill="url(#saf)"/><path d="M5 26L10.6 26Q22 33 33.4 26L39 26L22 48Z" fill="url(#grn)"/>
${chakra(22, 27, 4.4, NAVY, 0.9)}<path d="M22 6V48M5 26Q22 16 39 26" stroke="#6B5A42" stroke-width=".6" fill="none"/>
<path d="M22 48q-4 6 0 10t0 10" stroke="#8C7B63" stroke-width=".6" fill="none"/><path d="M19 56l3 2l3-2l-3 4Z" fill="url(#saf)"/><path d="M19 64l3 2l3-2l-3 4Z" fill="url(#grn)"/>`, defs);
  files['seal.svg'] = svg(48, 48, `<circle cx="24" cy="24" r="22" fill="#FFFFFF"/><circle cx="24" cy="24" r="22" fill="none" stroke="${SAFFRON}" stroke-width="2.2"/><circle cx="24" cy="24" r="19.4" fill="none" stroke="${GREEN}" stroke-width="1.4"/>${chakra(24, 24, 14)}`, defs);
  files['mark.svg'] = svg(40, 40, `<circle cx="20" cy="20" r="16.5" fill="none" stroke="#000" stroke-width="5"/><circle cx="20" cy="20" r="5" fill="#000"/>${[0, 1, 2, 3, 4, 5].map((i) => { const a = i * Math.PI / 6; return `<path d="M${f(20 - Math.cos(a) * 15)} ${f(20 - Math.sin(a) * 15)}L${f(20 + Math.cos(a) * 15)} ${f(20 + Math.sin(a) * 15)}" stroke="#000" stroke-width="2.4"/>`; }).join('')}`);
  {
    const W = 64;
    files['hem.svg'] = svg(W, 48, `${hemLines(W)}<rect x="0" y="17" width="${W}" height="4.6" fill="${SAFFRON}"/><rect x="0" y="21.6" width="${W}" height="4.8" fill="#FBF6EE"/><rect x="0" y="26.4" width="${W}" height="4.6" fill="${GREEN}"/>
<circle cx="32" cy="24" r="7.6" fill="#FBF6EE"/>${chakra(32, 24, 6, NAVY, 1)}`, defs);
  }
  themes.india = files;
}

for (const [theme, files] of Object.entries(themes)) {
  for (const app of ['storefront', 'admin']) {
    const dir = join(root, `apps/${app}/public/festive/${theme}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [name, s] of Object.entries(files)) writeFileSync(join(dir, name), s.replace(/\n\s*/g, '\n'));
  }
  console.log(`${theme}: ${Object.keys(files).join(', ')}`);
}
