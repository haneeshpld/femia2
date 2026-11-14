/**
 * Add-to-bag choreography (GSAP, loaded on demand):
 *  • flyToBag: the real product photo lifts, arcs along a curve into the bag icon and shrinks into it;
 *    the bag squashes like soft fabric and the count rolls (Header).
 *  • morphFrom: a card photo grows into the size sheet's photo instead of the sheet appearing from nowhere.
 * Reduced motion: no travel, just a quick acknowledgement on the bag.
 */
type Box = { left: number; top: number; width: number; height: number };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsapP = () => import('gsap').then((m) => m.gsap);
const boxOf = (from: Element | DOMRect | null | undefined): Box | null => {
  if (!from) return null;
  const r = from instanceof Element ? from.getBoundingClientRect() : from;
  return r.width && r.height ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
};

function ghost(box: Box, imageUrl?: string | null) {
  const g = document.createElement('div');
  Object.assign(g.style, {
    position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
    borderRadius: '14px', zIndex: '95', pointerEvents: 'none', willChange: 'transform',
    background: imageUrl ? `#ECD5C7 center / cover no-repeat url("${imageUrl}")` : 'var(--c-maroon)',
    boxShadow: '0 18px 40px -16px rgba(74, 20, 22, .55)', transformOrigin: '50% 50%',
  });
  document.body.appendChild(g);
  return g;
}

export async function bagBounce() {
  const bag = document.querySelector<HTMLElement>('[data-bag-button]');
  if (!bag) return;
  if (reduced()) { bag.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 300 }); return; }
  const gsap = await gsapP();
  gsap.timeline()
    .to(bag, { scaleX: 1.18, scaleY: 0.82, duration: 0.12, ease: 'power2.out', transformOrigin: '50% 100%' })
    .to(bag, { scaleX: 0.92, scaleY: 1.12, duration: 0.16, ease: 'power2.out' })
    .to(bag, { scaleX: 1, scaleY: 1, duration: 0.5, ease: 'back.out(2.2)' });
  const ring = document.createElement('span');
  Object.assign(ring.style, { position: 'absolute', inset: '4px', borderRadius: '50%', border: '1.5px solid #C79A3E', pointerEvents: 'none' });
  bag.appendChild(ring);
  gsap.fromTo(ring, { scale: 0.6, opacity: 0.9 }, { scale: 1.6, opacity: 0, duration: 0.7, ease: 'power2.out', onComplete: () => ring.remove() });
}

export async function flyToBag(from: Element | DOMRect | null | undefined, imageUrl?: string | null) {
  const bag = document.querySelector('[data-bag-button]');
  const a = boxOf(from);
  if (!bag || !a || reduced()) return bagBounce();
  const gsap = await gsapP();
  // Fly a 3:4 "swatch" of the photo, centred on the source, no bigger than 140px.
  const w = Math.min(140, a.width), h = (w * 4) / 3;
  const start = { left: a.left + a.width / 2 - w / 2, top: a.top + a.height / 2 - h / 2, width: w, height: h };
  const b = bag.getBoundingClientRect();
  const g = ghost(start, imageUrl);
  const sx = start.left + w / 2, sy = start.top + h / 2;
  const ex = b.left + b.width / 2, ey = b.top + b.height / 2;
  // Quadratic Bézier with the control point lifted above both ends: a thrown arc.
  const cx = sx + (ex - sx) * 0.35, cy = Math.min(sy, ey) - Math.max(120, Math.abs(ex - sx) * 0.25);
  const p = { t: 0 };
  await new Promise<void>((done) => {
    gsap.timeline({ onComplete: done })
      .to(g, { scale: 1.06, boxShadow: '0 26px 50px -18px rgba(74, 20, 22, .6)', duration: 0.18, ease: 'power2.out' })
      .to(p, {
        t: 1, duration: 0.85, ease: 'power2.inOut',
        onUpdate: () => {
          const t = p.t, u = 1 - t;
          const x = u * u * sx + 2 * u * t * cx + t * t * ex;
          const y = u * u * sy + 2 * u * t * cy + t * t * ey;
          gsap.set(g, { x: x - sx, y: y - sy, scale: 1.06 - 0.94 * t * t, rotation: -8 * Math.sin(Math.PI * t), borderRadius: `${14 + 40 * t}%` });
        },
      })
      .to(g, { opacity: 0, duration: 0.12 }, '-=0.12');
  });
  g.remove();
  return bagBounce();
}

/** Grow a card photo into a target element that may still be sliding into place (bottom sheet / dialog). */
export async function morphFrom(origin: DOMRect | undefined, imageUrl: string | null | undefined, getTarget: () => Element | null) {
  const a = boxOf(origin);
  if (!a || reduced()) return;
  const gsap = await gsapP();
  const g = ghost(a, imageUrl);
  gsap.to(g, { scale: 1.04, duration: 0.25, ease: 'power2.out' });
  // Wait for the sheet's own entrance (≈420ms) so we land where the photo actually rests.
  await new Promise((r) => setTimeout(r, 380));
  const t = getTarget();
  const b = boxOf(t);
  if (!b) { gsap.to(g, { opacity: 0, duration: 0.2, onComplete: () => g.remove() }); return; }
  if (t instanceof HTMLElement) t.style.opacity = '0';
  gsap.to(g, {
    left: b.left, top: b.top, width: b.width, height: b.height, scale: 1, borderRadius: 10, duration: 0.6, ease: 'expo.inOut',
    onComplete: () => {
      if (t instanceof HTMLElement) t.style.opacity = '';
      gsap.to(g, { opacity: 0, duration: 0.2, onComplete: () => g.remove() });
    },
  });
}
