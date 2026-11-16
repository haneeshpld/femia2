/**
 * The shared parts of every festive theme. A theme decorates the shop the way a boutique dresses its doorway:
 *   - the hanging: a repeating strip along the header's lower edge, with ornaments on zari threads hanging from its
 *     pins (wide screens). It is the one bold element; it stitches in once on arrival and goes quiet when scrolling.
 *   - the seal: a small turning keepsake on the home page's lead photo, linking to the collection.
 *   - the sparkle: gold dust, snow or lantern light on one fixed canvas, paused when the tab is hidden.
 *   - the details: the announcement bar in the festival's colour, an embroidered hem along the top of the footer,
 *     and the festival's motif in place of the small gold diamonds.
 * A theme supplies its artwork (public/festive/<id>, drawn by tools/festive/art.mjs) and colours (its own CSS).
 */
import css from './kit.css?inline';
import type { FestiveInstance } from './index.ts';

export interface Drop {
  /** which pin of the strip it hangs from, counted from the middle of the screen (…, -2, -1, 1, 2, …) */
  pin: number;
  /** thread length and ornament width, px */
  len: number; w: number;
  art: string;
  /** shown from tablets (md) or computers only (lg) */
  from?: 'md' | 'lg';
  glow?: boolean;
}
export type Sparkle = 'gold' | 'snow' | 'glow' | 'dust' | 'marigold' | 'konna' | 'tricolour' | 'off';
export interface Spec {
  id: string;
  /** the strip's tile: width and height at full size, px (phones draw it at 70%) */
  strip: { w: number; h: number } | null;
  drops: Drop[];
  sparkle: Sparkle;
  /** sparkle a little richer (the festival day) */
  rich?: boolean;
  seal: { text: string; link: string; greeting: string | null } | null;
  details: boolean;
  /** extra theme CSS (colours) */
  css: string;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Today's date in India, YYYY-MM-DD. */
export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

/**
 * Is it the festival day? Preview with ?festive-day=1 (or 0 to stop), remembered for this tab.
 * `match` is a date (YYYY-MM-DD) or a month-day (MM-DD) in India.
 */
export function isFestivalDay(match: string | null) {
  const q = new URLSearchParams(location.search);
  const v = q.get('festive-day') ?? q.get('xmas-day');
  try {
    if (v === '1') sessionStorage.setItem('femia.festiveday', '1');
    if (v === '0') sessionStorage.removeItem('femia.festiveday');
    if (sessionStorage.getItem('femia.festiveday') === '1') return true;
  } catch { if (v === '1') return true; }
  if (!match) return false;
  const today = todayIST();
  return match.length === 5 ? today.slice(5) === match : today === match;
}

function hangingMarkup(s: Spec) {
  const art = (n: string) => `/festive/${s.id}/${n}`;
  const strip = s.strip ? `<div class="fx-strip" style="--tile:${s.strip.w}px;--th:${s.strip.h}px;background-image:url(${art('strip.svg')})"></div>` : '';
  const tile = s.strip?.w ?? 120;
  const drops = s.drops.map((d, i) => `<span class="fx-drop${d.from ? ` fx-drop--${d.from}` : ''}${d.glow ? ' fx-drop--glow' : ''}" data-x="${d.pin * tile}" data-w="${d.w}"
      style="--pin:${d.pin};--tile:${tile}px;--len:${d.len}px;--w:${d.w}px;--i:${i}"><img src="${art(d.art)}" alt="" width="${d.w}" decoding="async"></span>`).join('');
  return strip + drops;
}

function sealMarkup(s: Spec, seal: NonNullable<Spec['seal']>) {
  const year = new Date().getFullYear();
  const day = !!seal.greeting;
  const words = day ? `With love from Femia • ${year} • ` : `${seal.text} • ${year} • `;
  const ring = (words + words).replace(/ $/, '');
  const label = day ? seal.greeting! : seal.text;
  // the greeting in one or two balanced lines, sized to fit inside the inner ring (about 88px wide)
  const gw = (seal.greeting ?? '').split(/\s+/).filter(Boolean);
  let lines = [gw.join(' ')];
  if (lines[0]!.length > 11 && gw.length > 1) {
    let best = 1;
    for (let i = 1; i < gw.length; i++) {
      const w = (j: number) => Math.max(gw.slice(0, j).join(' ').length, gw.slice(j).join(' ').length);
      if (w(i) < w(best)) best = i;
    }
    lines = [gw.slice(0, best).join(' '), gw.slice(best).join(' ')];
  }
  const size = Math.min(18, 88 / (Math.max(...lines.map((l) => l.length)) * 0.44));
  const centre = day
    ? `<image href="/festive/${s.id}/seal.svg" x="66" y="${lines.length > 1 ? 36 : 44}" width="28" height="28"/>
       ${lines.map((l, i) => `<text x="80" y="${(lines.length > 1 ? 86 : 96) + i * size * 1.1}" class="fx-seal__script" style="font-size:${size.toFixed(1)}px">${esc(l)}</text>`).join('')}`
    : `<image class="fx-seal__motif" href="/festive/${s.id}/seal.svg" x="57" y="40" width="46" height="46"/>
       <text x="80" y="110" class="fx-seal__cta">Shop the edit</text>`;
  return `<a class="fx-seal${day ? ' fx-seal--day' : ''}" href="${esc(seal.link)}" aria-label="${esc(label)}">
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <defs>
        <radialGradient id="fx-disc" cx=".4" cy=".35" r=".75"><stop offset="0" class="fx-disc-1"/><stop offset=".6" class="fx-disc-2"/><stop offset="1" class="fx-disc-3"/></radialGradient>
        <path id="fx-ring" d="M80 80 m-60 0 a60 60 0 1 1 120 0 a60 60 0 1 1 -120 0"/>
      </defs>
      <circle cx="80" cy="80" r="79" fill="url(#fx-disc)"/>
      <circle cx="80" cy="80" r="74" fill="none" stroke="#C79A3E" stroke-width=".8"/>
      <circle cx="80" cy="80" r="71.5" fill="none" stroke="#C79A3E" stroke-width=".4" opacity=".7"/>
      <circle cx="80" cy="80" r="47" fill="none" stroke="#C79A3E" stroke-width=".5" opacity=".8"/>
      <g class="fx-seal__ring"><text class="fx-seal__ringtext"><textPath href="#fx-ring" textLength="374" lengthAdjust="spacing">${esc(ring)}</textPath></text></g>
      ${centre}
    </svg>
  </a>`;
}

/** Gold dust, snow, rising lantern light or a light gold dust: one fixed canvas with pre-drawn sprites. */
function sparkle(root: HTMLElement, mode: Sparkle, rich: boolean) {
  if (mode === 'off' || reduced()) return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-sparkle';
  canvas.setAttribute('aria-hidden', 'true');
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, devicePixelRatio || 1);

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
  /** A petal: a soft oval with a lighter middle, tumbled as it falls (see `spin`). */
  const petal = (w: number, h: number, a: string, b: string) => {
    const c = document.createElement('canvas'); c.width = Math.ceil(w * 2 * dpr); c.height = Math.ceil(h * 2 * dpr);
    const g = c.getContext('2d')!; const m = { x: c.width / 2, y: c.height / 2 };
    const grad = g.createRadialGradient(m.x, m.y - h * dpr * 0.2, 0, m.x, m.y, h * dpr);
    grad.addColorStop(0, a); grad.addColorStop(1, b);
    g.fillStyle = grad; g.beginPath(); g.ellipse(m.x, m.y, w * dpr * 0.9, h * dpr * 0.9, 0, 0, Math.PI * 2); g.fill();
    return c;
  };
  const petals = (cols: [string, string][]) => ({
    kinds: cols.flatMap(([a, b]) => [petal(3.2, 5.2, a, b), petal(2.4, 4, a, b)]),
    weights: cols.flatMap(() => [0.55 / cols.length, 0.45 / cols.length]),
    speed: () => 22 + Math.random() * 20, density: 30000, twinkle: 'none' as const, spin: true,
  });
  const presets: Record<Exclude<Sparkle, 'off'>, { kinds: HTMLCanvasElement[]; weights: number[]; speed: (k: number) => number; density: number; twinkle: 'gold' | 'flicker' | 'none'; spin?: boolean }> = {
    marigold: petals([['#FFD36A', '#E8891A'], ['#FFB347', '#D9661A'], ['#E85A3C', '#A92A1A'], ['#FFF4D8', '#F1D9A0']]),
    konna: petals([['#FFF2A0', '#F2C21A'], ['#FFE45C', '#D9A40C'], ['#FFF6C4', '#E9C842']]),
    tricolour: petals([['#FFB866', '#E8781E'], ['#FFFFFF', '#E9E4DA'], ['#3DB866', '#138A3C']]),
    gold: {
      kinds: [
        sprite(2.4, [[0, 'rgba(255,246,218,1)'], [0.35, 'rgba(217,174,85,.95)'], [1, 'rgba(199,154,62,0)']]),
        sprite(3.6, [[0, 'rgba(255,240,200,.95)'], [0.4, 'rgba(199,154,62,.7)'], [1, 'rgba(154,110,34,0)']]),
        sprite(9, [[0, 'rgba(235,203,130,.32)'], [0.7, 'rgba(235,203,130,.12)'], [1, 'rgba(235,203,130,0)']]),
        glint(9),
      ],
      weights: [0.5, 0.2, 0.15, 0.15], speed: (k) => (k === 2 ? 5 : 9 + Math.random() * 14), density: 22000, twinkle: 'gold',
    },
    dust: { // a lighter gold dust: no bokeh, fewer motes
      kinds: [
        sprite(2.2, [[0, 'rgba(255,246,218,1)'], [0.35, 'rgba(217,174,85,.95)'], [1, 'rgba(199,154,62,0)']]),
        sprite(3.2, [[0, 'rgba(255,240,200,.95)'], [0.4, 'rgba(199,154,62,.7)'], [1, 'rgba(154,110,34,0)']]),
        glint(8),
      ],
      weights: [0.6, 0.25, 0.15], speed: () => 7 + Math.random() * 10, density: 34000, twinkle: 'gold',
    },
    snow: {
      kinds: [
        sprite(2.2, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,.95)'], [0.9, 'rgba(160,180,200,.6)'], [1, 'rgba(160,180,200,0)']]),
        sprite(3.4, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,.9)'], [0.9, 'rgba(160,180,200,.5)'], [1, 'rgba(160,180,200,0)']]),
        sprite(8, [[0, 'rgba(255,255,255,.55)'], [0.6, 'rgba(240,245,250,.25)'], [1, 'rgba(240,245,250,0)']]),
      ],
      weights: [0.6, 0.28, 0.12], speed: (k) => (k === 2 ? 14 : 20 + Math.random() * 22), density: 17000, twinkle: 'none',
    },
    glow: { // warm motes of lantern light, drifting up
      kinds: [
        sprite(2.2, [[0, 'rgba(255,244,214,1)'], [0.4, 'rgba(245,190,95,.9)'], [1, 'rgba(233,160,60,0)']]),
        sprite(3.4, [[0, 'rgba(255,236,190,.95)'], [0.45, 'rgba(240,170,80,.6)'], [1, 'rgba(200,120,40,0)']]),
        sprite(10, [[0, 'rgba(255,214,140,.28)'], [0.6, 'rgba(255,200,120,.1)'], [1, 'rgba(255,200,120,0)']]),
      ],
      weights: [0.55, 0.3, 0.15], speed: (k) => -(k === 2 ? 4 : 6 + Math.random() * 9), density: 30000, twinkle: 'flicker',
    },
  };
  const P = presets[mode];
  const pick = () => { let x = Math.random(); for (let i = 0; i < P.weights.length; i++) { if ((x -= P.weights[i]!) <= 0) return i; } return 0; };

  type Mote = { x: number; y: number; vy: number; amp: number; ph: number; k: number; tw: number; tp: number; rot: number; vr: number };
  let W = 0, H = 0, ps: Mote[] = [], raf = 0, last = 0;
  const make = (anyY: boolean): Mote => {
    const k = pick(), vy = P.speed(k);
    return { x: Math.random() * W, y: anyY ? Math.random() * H : vy < 0 ? H + 16 : -16, vy, amp: 8 + Math.random() * 22, ph: Math.random() * 6.3, k, tw: 0.6 + Math.random() * 1.6, tp: Math.random() * 6.3, rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 2.4 };
  };
  const resize = () => {
    W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr;
    const n = Math.round(Math.min(80, (W * H) / P.density) * (rich ? 1.35 : 1));
    while (ps.length < n) ps.push(make(true));
    ps.length = n;
  };
  const glintKind = mode === 'gold' ? 3 : mode === 'dust' ? 2 : -1;
  const frame = (t: number) => {
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of ps) {
      p.y += p.vy * dt; p.ph += dt * 0.6; p.tp += dt * p.tw;
      if (p.vy > 0 ? p.y > H + 20 : p.y < -20) Object.assign(p, make(false));
      const s = P.kinds[p.k]!;
      const a = P.twinkle === 'gold' ? (p.k === glintKind ? Math.max(0, Math.sin(p.tp)) ** 3 : 0.55 + 0.45 * Math.sin(p.tp))
        : P.twinkle === 'flicker' ? (0.5 + 0.5 * Math.sin(p.tp)) * Math.min(1, (H - p.y) / (H * 0.25) + 0.15) * Math.min(1, p.y / (H * 0.35))
        : 1;
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      const px = (p.x + Math.sin(p.ph) * p.amp) * dpr, py = p.y * dpr;
      if (P.spin) { // turn and flutter: the petal shows its face, then its edge
        p.rot += p.vr * dt;
        ctx.setTransform(1, 0, 0, 1, px, py); ctx.rotate(p.rot); ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(p.tp)));
        ctx.drawImage(s, -s.width / 2, -s.height / 2);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        continue;
      }
      ctx.drawImage(s, px - s.width / 2, py - s.height / 2);
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

/** Mount a theme. refresh() runs after every page change (the header, footer and bar persist; the page doesn't). */
export function mount(root: HTMLElement, s: Spec): FestiveInstance {
  const style = document.createElement('style');
  style.textContent = css + s.css;
  root.appendChild(style);
  const stopSparkle = sparkle(root, s.sparkle, !!s.rich);
  const hasHanging = !!s.strip || s.drops.length > 0;
  /** Only hang what fits: an ornament that would be cut by the screen's edge is left off. */
  const place = () => {
    const W = document.documentElement.clientWidth;
    document.querySelectorAll<HTMLElement>('.fx-drop').forEach((d) => {
      const x = W / 2 + Number(d.dataset.x), w = Number(d.dataset.w);
      d.classList.toggle('is-out', x - w / 2 < 12 || x + w / 2 > W - 12);
    });
  };

  const refresh = () => {
    const html = document.documentElement;
    if (s.details) html.dataset.fxDetails = ''; else delete html.dataset.fxDetails;

    const hdr = document.querySelector<HTMLElement>('[data-header]');
    if (hdr && hasHanging && !hdr.querySelector('.fx-hdr')) {
      const d = document.createElement('div');
      d.className = 'fx-hdr'; d.setAttribute('aria-hidden', 'true'); d.innerHTML = hangingMarkup(s);
      hdr.appendChild(d);
      place();
      // two frames: let the browser paint the start state so the arrival animates
      requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('is-on')));
    }

    const hero = document.querySelector<HTMLElement>('[data-hero]');
    if (s.seal && hero && !hero.querySelector('.fx-seal')) {
      const t = document.createElement('template'); t.innerHTML = sealMarkup(s, s.seal).trim();
      // on the lead photo of the rail, so it scrolls with it on phones; otherwise the hero's corner
      (hero.querySelector('.rail__item--lead') ?? hero).appendChild(t.content.firstElementChild!);
    }

    if (s.details) {
      const ft = document.querySelector<HTMLElement>('[data-footer]');
      if (ft && !ft.querySelector('.fx-hem')) {
        const b = document.createElement('div'); b.className = 'fx-hem'; b.setAttribute('aria-hidden', 'true');
        b.style.backgroundImage = `url(/festive/${s.id}/hem.svg)`;
        ft.insertBefore(b, ft.firstChild);
      }
    }
  };
  refresh();
  addEventListener('resize', place);

  return {
    refresh,
    stop() {
      stopSparkle();
      removeEventListener('resize', place);
      style.remove();
      document.querySelectorAll('.fx-hdr, .fx-seal, .fx-hem').forEach((n) => n.remove());
      delete document.documentElement.dataset.fxDetails;
    },
  };
}
