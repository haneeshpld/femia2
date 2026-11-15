import type { FestiveTheme } from '../index.ts';
// Inlined and kept inside the persisted festive layer: the client router replaces <head> on every navigation.
import css from './christmas.css?inline';

/**
 * Christmas, embroidered in zari: a gold-thread pine garland that follows the logo's arch, a few hanging stars,
 * gold dust (or soft snow), a "Christmas Edit" seal on the home hero, a pine-green announcement bar, a footer hem
 * stitched with fir trees and stars, and stars in place of the gold diamonds. On 25 December the seal changes to
 * "Merry Christmas". Artwork: /public/festive/christmas (regenerate with `node tools/festive/christmas.mjs`).
 */
const ART = '/festive/christmas';
type Opts = { sparkle: 'gold' | 'snow' | 'off'; garland: boolean; stars: boolean; seal: boolean; sealText: string; sealLink: string; details: boolean; christmasDay: boolean };
const DEFAULTS: Opts = { sparkle: 'gold', garland: true, stars: true, seal: true, sealText: 'The Christmas Edit', sealLink: '/shop', details: true, christmasDay: true };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ist = () => new Date(Date.now() + 5.5 * 3600e3);

/** Christmas Day in India, or forced for a preview with ?xmas-day=1. */
function isChristmasDay() {
  const q = new URLSearchParams(location.search).get('xmas-day');
  try {
    if (q === '1') sessionStorage.setItem('femia.xmasday', '1');
    if (q === '0') sessionStorage.removeItem('femia.xmasday');
    if (sessionStorage.getItem('femia.xmasday') === '1') return true;
  } catch { if (q === '1') return true; }
  return ist().toISOString().slice(5, 10) === '12-25';
}

const STARS = [{ x: 13, len: 30, s: 22 }, { x: 25, len: 54, s: 16 }, { x: 75, len: 42, s: 18 }, { x: 87, len: 24, s: 22 }];

function headerDecor(o: Opts) {
  const garland = o.garland ? `<img class="xm-arch" src="${ART}/arch-garland.svg" alt="" width="600" height="100" decoding="async">` : '';
  const stars = o.stars
    ? STARS.map((st, i) => `<span class="xm-star" style="--x:${st.x}%;--len:${st.len}px;--s:${st.s}px;--i:${i}"><img src="${ART}/star.svg" alt="" width="40" height="40" decoding="async"></span>`).join('')
    : '';
  return garland + stars;
}

function sealMarkup(o: Opts, day: boolean) {
  const year = ist().getUTCFullYear();
  const ring = day ? `25 December · With love from Femia · ${year} · ` : `${o.sealText} · ${year} · ${o.sealText} · ${year} · `;
  const label = day ? 'Merry Christmas' : o.sealText;
  const centre = day
    ? `<image href="${ART}/star.svg" x="68" y="44" width="24" height="24"/>
       <text x="80" y="88" class="xm-seal__script">Merry</text><text x="80" y="108" class="xm-seal__script">Christmas</text>`
    : `<image class="xm-seal__star" href="${ART}/star.svg" x="58" y="46" width="44" height="44"/>
       <text x="80" y="110" class="xm-seal__cta">Shop now</text>`;
  return `<a class="xm-seal${day ? ' xm-seal--day' : ''}" href="${esc(o.sealLink)}" aria-label="${esc(label)}">
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <defs>
        <radialGradient id="xm-disc" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#2A5E45"/><stop offset=".6" stop-color="#18402E"/><stop offset="1" stop-color="#0D2519"/></radialGradient>
        <path id="xm-ring" d="M80 80 m-59 0 a59 59 0 1 1 118 0 a59 59 0 1 1 -118 0"/>
      </defs>
      <circle cx="80" cy="80" r="79" fill="url(#xm-disc)"/>
      <circle cx="80" cy="80" r="74" fill="none" stroke="#C79A3E" stroke-width=".8"/>
      <circle cx="80" cy="80" r="71.5" fill="none" stroke="#C79A3E" stroke-width=".4" opacity=".7"/>
      <circle cx="80" cy="80" r="46" fill="none" stroke="#C79A3E" stroke-width=".5" opacity=".8"/>
      <g class="xm-seal__ring"><text class="xm-seal__ringtext"><textPath href="#xm-ring" textLength="368" lengthAdjust="spacing">${esc(ring.toUpperCase())}</textPath></text></g>
      ${centre}
    </svg>
  </a>`;
}

/** Gold dust with soft glints, or a quiet snowfall: one fixed canvas, pre-drawn sprites, paused when hidden. */
function sparkle(root: HTMLElement, mode: Opts['sparkle'], rich: boolean) {
  if (mode === 'off' || reduced()) return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'xm-sparkle';
  canvas.setAttribute('aria-hidden', 'true');
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const gold = mode === 'gold';

  const sprite = (r: number, stops: [number, string][]) => {
    const c = document.createElement('canvas'); const s = Math.ceil(r * 2 + 2) * dpr; c.width = c.height = s;
    const g = c.getContext('2d')!; const m = s / 2;
    const grad = g.createRadialGradient(m, m, 0, m, m, r * dpr);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad; g.beginPath(); g.arc(m, m, r * dpr, 0, Math.PI * 2); g.fill();
    return c;
  };
  const glint = (r: number) => { // a soft four-point flare
    const c = document.createElement('canvas'); const s = Math.ceil(r * 2 + 2) * dpr; c.width = c.height = s;
    const g = c.getContext('2d')!; const m = s / 2;
    for (const [w, h] of [[r * dpr, 0.9 * dpr], [0.9 * dpr, r * dpr]] as const) {
      const lg = g.createRadialGradient(m, m, 0, m, m, Math.max(w, h));
      lg.addColorStop(0, 'rgba(255,248,225,1)'); lg.addColorStop(0.4, 'rgba(235,203,130,.8)'); lg.addColorStop(1, 'rgba(199,154,62,0)');
      g.fillStyle = lg; g.fillRect(m - w, m - h, w * 2, h * 2);
    }
    const core = sprite(2.2, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,240,200,0)']]);
    g.drawImage(core, m - core.width / 2, m - core.height / 2);
    return c;
  };
  const kinds = gold
    ? [
        sprite(2.4, [[0, 'rgba(255,246,218,1)'], [0.35, 'rgba(217,174,85,.95)'], [1, 'rgba(199,154,62,0)']]), // dust
        sprite(3.6, [[0, 'rgba(255,240,200,.95)'], [0.4, 'rgba(199,154,62,.7)'], [1, 'rgba(154,110,34,0)']]),
        sprite(9, [[0, 'rgba(235,203,130,.32)'], [0.7, 'rgba(235,203,130,.12)'], [1, 'rgba(235,203,130,0)']]), // bokeh
        glint(9),
      ]
    : [
        sprite(2.2, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,.95)'], [0.9, 'rgba(160,180,200,.6)'], [1, 'rgba(160,180,200,0)']]),
        sprite(3.4, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,.9)'], [0.9, 'rgba(160,180,200,.5)'], [1, 'rgba(160,180,200,0)']]),
        sprite(8, [[0, 'rgba(255,255,255,.55)'], [0.6, 'rgba(240,245,250,.25)'], [1, 'rgba(240,245,250,0)']]),
      ];
  const weights = gold ? [0.5, 0.2, 0.15, 0.15] : [0.6, 0.28, 0.12];
  const pick = () => { let x = Math.random(); for (let i = 0; i < weights.length; i++) { if ((x -= weights[i]!) <= 0) return i; } return 0; };

  type P = { x: number; y: number; vy: number; amp: number; ph: number; k: number; tw: number; tp: number };
  let W = 0, H = 0, ps: P[] = [], raf = 0, last = 0;
  const make = (anyY: boolean): P => {
    const k = pick();
    const vy = gold ? (k === 2 ? 5 : 9 + Math.random() * 14) : (k === 2 ? 14 : 20 + Math.random() * 22);
    return { x: Math.random() * W, y: anyY ? Math.random() * H : -16, vy, amp: 8 + Math.random() * 22, ph: Math.random() * 6.3, k, tw: 0.6 + Math.random() * 1.6, tp: Math.random() * 6.3 };
  };
  const resize = () => {
    W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr;
    const base = gold ? Math.min(70, (W * H) / 22000) : Math.min(90, (W * H) / 17000);
    const n = Math.round(base * (rich ? 1.35 : 1));
    while (ps.length < n) ps.push(make(true));
    ps.length = n;
  };
  const frame = (t: number) => {
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of ps) {
      p.y += p.vy * dt; p.ph += dt * 0.6; p.tp += dt * p.tw;
      if (p.y > H + 20) Object.assign(p, make(false));
      const s = kinds[p.k]!;
      const twinkle = gold ? (p.k === 3 ? Math.max(0, Math.sin(p.tp)) ** 3 : 0.55 + 0.45 * Math.sin(p.tp)) : 1;
      if (twinkle < 0.02) continue;
      ctx.globalAlpha = twinkle;
      ctx.drawImage(s, (p.x + Math.sin(p.ph) * p.amp) * dpr - s.width / 2, p.y * dpr - s.height / 2);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  const vis = () => { cancelAnimationFrame(raf); last = 0; if (!document.hidden) raf = requestAnimationFrame(frame); };
  resize(); vis();
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', vis);
  requestAnimationFrame(() => canvas.classList.add('is-on'));
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis); canvas.remove(); };
}

const theme: FestiveTheme = {
  start(root, options) {
    const o: Opts = { ...DEFAULTS, ...(options as Partial<Opts>) };
    const day = o.christmasDay && isChristmasDay();
    const style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
    const stopSparkle = sparkle(root, o.sparkle, day);

    // Size the garland to the logo's arch (the header draws the arch from the logo's width).
    const fit = () => {
      const hdr = document.querySelector<HTMLElement>('[data-header]');
      const brand = hdr?.querySelector<HTMLElement>('[data-hdr-brand]');
      if (!hdr || !brand) return;
      const a = Math.max(70, brand.getBoundingClientRect().width / 2 + 44);
      hdr.style.setProperty('--xm-s', String(a / 120));
    };

    const refresh = () => {
      const html = document.documentElement;
      if (o.details) html.dataset.xmDetails = ''; else delete html.dataset.xmDetails;
      const hdr = document.querySelector<HTMLElement>('[data-header]');
      if (hdr && (o.garland || o.stars) && !hdr.querySelector('.xm-hdr')) {
        const d = document.createElement('div');
        d.className = 'xm-hdr'; d.setAttribute('aria-hidden', 'true'); d.innerHTML = headerDecor(o);
        hdr.appendChild(d);
        requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('is-on')));
      }
      const hero = document.querySelector<HTMLElement>('[data-hero]');
      if (o.seal && hero && !hero.querySelector('.xm-seal')) {
        const t = document.createElement('template'); t.innerHTML = sealMarkup(o, day).trim();
        hero.appendChild(t.content.firstElementChild!);
      }
      if (o.details) {
        for (const band of document.querySelectorAll<HTMLElement>('[data-footer] [data-zari]')) {
          if (band.querySelector('.xm-band')) continue;
          const b = document.createElement('div'); b.className = 'xm-band'; b.setAttribute('aria-hidden', 'true');
          band.appendChild(b);
        }
      }
      fit();
    };
    refresh();
    addEventListener('resize', fit);

    return {
      refresh,
      stop() {
        stopSparkle();
        style.remove();
        removeEventListener('resize', fit);
        document.querySelectorAll('.xm-hdr, .xm-seal, .xm-band').forEach((n) => n.remove());
        delete document.documentElement.dataset.xmDetails;
      },
    };
  },
};
export default theme;
