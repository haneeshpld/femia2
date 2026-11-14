/**
 * Storefront motion: silk & zari.
 * Libraries (GSAP, ScrollTrigger, SplitText, Lenis) load once, at idle. Each page's animations are built in a
 * GSAP context when the page is shown and reverted when the client router swaps it out.
 * Content is visible by default; GSAP only animates elements still below the fold, so a slow or failed
 * script never hides anything. Everything respects prefers-reduced-motion.
 */
import { onPage, reducedMotion } from '../lib/lifecycle.ts';

const finePointer = matchMedia('(pointer: fine)').matches;
type Gsap = typeof import('gsap').gsap;
type ST = typeof import('gsap/ScrollTrigger').ScrollTrigger;
type Lenis = import('lenis').default;
declare global { interface Window { __lenis?: Lenis } }

// 1. Light-weight fade-ups for supporting copy (IntersectionObserver, no library), per page.
onPage(() => {
  const reduced = reducedMotion();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  document.querySelectorAll<HTMLElement>('[data-reveal-group]').forEach((g) => {
    [...g.children].forEach((child, i) => { const el = child as HTMLElement; el.dataset.reveal = ''; el.style.setProperty('--delay', `${Math.min(i, 6) * 80}ms`); });
  });
  document.querySelectorAll('[data-reveal]').forEach((el) => (reduced ? el.classList.add('is-in') : io.observe(el)));
  return () => io.disconnect();
});

// 2. Libraries, loaded once at idle.
let libs: Promise<{ gsap: Gsap; ScrollTrigger: ST; SplitText: typeof import('gsap/SplitText').SplitText }> | undefined;
const loadLibs = () => (libs ??= (async () => {
  const [{ gsap }, { ScrollTrigger }, { SplitText }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('gsap/SplitText')]);
  gsap.registerPlugin(ScrollTrigger, SplitText);
  if (finePointer && innerWidth >= 1024) {
    const { default: Lenis } = await import('lenis');
    // Snappy catch-up and a full-length wheel step so scrolling never feels slower than native.
    const lenis = new Lenis({ lerp: 0.16, wheelMultiplier: 1.15, touchMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    window.__lenis = lenis;
    document.documentElement.classList.add('lenis', 'lenis-smooth');
  }
  return { gsap, ScrollTrigger, SplitText };
})());
const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1200 }) : setTimeout(cb, 200));

// 3. Per-page choreography.
onPage(() => {
  if (reducedMotion()) return;
  let cancelled = false;
  let revert: (() => void) | undefined;

  idle(async () => {
    const { gsap, ScrollTrigger, SplitText } = await loadLibs();
    if (cancelled) return;
    // Keep smooth scroll in step with the router's scroll restore.
    window.__lenis?.resize();
    window.__lenis?.scrollTo(scrollY, { immediate: true, force: true });
    await document.fonts?.ready;
    if (cancelled) return;

    const below = (el: Element) => el.getBoundingClientRect().top > innerHeight * 0.92;
    const ease = 'expo.out';
    const offs: (() => void)[] = [];
    const ctx = gsap.context(() => {
      // Headings: lines rise out of a mask, like thread pulled through cloth.
      gsap.utils.toArray<HTMLElement>('main [data-split]').forEach((h) => {
        if (!below(h)) return;
        const split = SplitText.create(h, { type: 'lines', mask: 'lines' });
        gsap.from(split.lines, {
          yPercent: 110, duration: 1.1, ease, stagger: 0.09,
          scrollTrigger: { trigger: h, start: 'top 88%', once: true },
          onComplete: () => split.revert(),
        });
      });

      // Category arches open upward from their base.
      gsap.utils.toArray<HTMLElement>('[data-arches]').forEach((list) => {
        const tiles = gsap.utils.toArray<HTMLElement>('[data-arch-tile]', list).filter(below);
        if (!tiles.length) return;
        gsap.timeline({ scrollTrigger: { trigger: list, start: 'top 85%', once: true } })
          .from(tiles, { clipPath: 'inset(100% 0% 0% 0% round 999px 999px 0px 0px)', duration: 1.3, ease: 'power4.out', stagger: 0.09 })
          .from(tiles.map((t) => t.querySelector('img')), { scale: 1.3, duration: 1.6, ease, stagger: 0.09 }, 0)
          .from(tiles.map((t) => t.parentElement?.querySelector('.cat__name')), { autoAlpha: 0, y: 14, duration: 0.8, ease, stagger: 0.09 }, 0.35);
      });

      // Boutique: the arch widens and the room settles, like stepping through the doorway.
      gsap.utils.toArray<HTMLElement>('[data-doorway]').forEach((door) => {
        const img = door.querySelector('[data-doorway-img]');
        gsap.timeline({ scrollTrigger: { trigger: door, start: 'top 95%', end: 'center 55%', scrub: 0.8 } })
          .fromTo(door, { clipPath: 'inset(0% 16% 0% 16% round 999px 999px 0px 0px)' }, { clipPath: 'inset(0% 0% 0% 0% round 999px 999px 0px 0px)', ease: 'none' }, 0)
          .fromTo(img, { scale: 1.32 }, { scale: 1, ease: 'none' }, 0);
      });

      // Styled by you: prints dropped onto the table.
      gsap.utils.toArray<HTMLElement>('[data-polaroids]').forEach((row) => {
        const prints = gsap.utils.toArray<HTMLElement>(':scope > li', row);
        if (!prints.length || !below(row)) return;
        gsap.from(prints, {
          y: 70, rotation: () => gsap.utils.random(-7, 7), autoAlpha: 0, duration: 1.2, ease: 'back.out(1.2)', stagger: 0.08,
          scrollTrigger: { trigger: row, start: 'top 88%', once: true }, clearProps: 'opacity,visibility,y',
        });
      });

      // Parallax layers (hero ribbon, banners).
      gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
        const amount = Number(el.dataset.parallax || 8);
        gsap.fromTo(el, { yPercent: -amount / 2 }, {
          yPercent: amount / 2, ease: 'none',
          scrollTrigger: { trigger: el.closest('section') ?? el, start: 'top top', end: 'bottom top', scrub: true },
        });
      });

      // Footer (persisted, but its scroll range depends on this page's height).
      const footer = document.querySelector('[data-footer]');
      const weave = footer?.querySelector('[data-zari] pattern');
      if (footer && weave) {
        gsap.fromTo(weave, { attr: { patternTransform: 'translate(0 0)' } }, {
          attr: { patternTransform: 'translate(192 0)' }, ease: 'none',
          scrollTrigger: { trigger: footer, start: 'top bottom', end: 'bottom bottom', scrub: true },
        });
      }
      const track = document.querySelector<HTMLElement>('[data-marquee-track]');
      if (track) {
        track.classList.add('is-gsap');
        const loop = gsap.to(track, { xPercent: -50, duration: 42, ease: 'none', repeat: -1, paused: true });
        ScrollTrigger.create({
          trigger: '[data-marquee]', start: 'top bottom', end: 'bottom top',
          onToggle: (self) => (self.isActive ? loop.play() : loop.pause()),
          onUpdate: (self) => {
            const v = Math.min(4, 1 + Math.abs(self.getVelocity()) / 600);
            gsap.to(loop, { timeScale: self.direction < 0 ? -v : v, duration: 0.3, overwrite: true });
            gsap.to(loop, { timeScale: self.direction < 0 ? -1 : 1, duration: 1.2, delay: 0.3 });
          },
        });
        offs.push(() => track.classList.remove('is-gsap'));
      }

      // Magnetic primary buttons (desktop only).
      if (finePointer) {
        document.querySelectorAll<HTMLElement>('main [data-magnetic]').forEach((btn) => {
          const x = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3.out' });
          const y = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3.out' });
          const move = (e: PointerEvent) => {
            const r = btn.getBoundingClientRect();
            x((e.clientX - r.left - r.width / 2) * 0.22);
            y((e.clientY - r.top - r.height / 2) * 0.32);
          };
          const leave = () => { x(0); y(0); };
          btn.addEventListener('pointermove', move);
          btn.addEventListener('pointerleave', leave);
          offs.push(() => { btn.removeEventListener('pointermove', move); btn.removeEventListener('pointerleave', leave); });
        });
      }
    });
    ScrollTrigger.refresh();
    revert = () => { offs.forEach((f) => f()); ctx.revert(); };
  });

  return () => { cancelled = true; revert?.(); };
});
