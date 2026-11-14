/**
 * Motion layer. Cheap things run immediately (IntersectionObserver reveals);
 * GSAP + ScrollTrigger + Lenis load on idle, only when the visitor allows motion.
 */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 1. Fade-up reveals (also staggers children marked data-reveal-group)
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
document.querySelectorAll<HTMLElement>('[data-reveal-group]').forEach((g) => {
  [...g.children].forEach((child, i) => { const el = child as HTMLElement; el.dataset.reveal = ''; el.style.setProperty('--delay', `${Math.min(i, 6) * 80}ms`); });
});
document.querySelectorAll('[data-reveal]').forEach((el) => (reduced ? el.classList.add('is-in') : io.observe(el)));

// 2. Parallax + smooth scroll, deferred
if (!reduced) {
  const start = async () => {
    const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
    gsap.registerPlugin(ScrollTrigger);

    if (matchMedia('(pointer: fine) and (min-width: 1024px)').matches) {
      const { default: Lenis } = await import('lenis');
      const lenis = new Lenis({ lerp: 0.12, wheelMultiplier: 0.9 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      (window as unknown as { __lenis: unknown }).__lenis = lenis;
    }

    gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
      const amount = Number(el.dataset.parallax || 8);
      gsap.fromTo(el, { yPercent: -amount / 2 }, {
        yPercent: amount / 2, ease: 'none',
        scrollTrigger: { trigger: el.parentElement ?? el, start: 'top bottom', end: 'bottom top', scrub: true },
      });
    });
  };
  ('requestIdleCallback' in window ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 300))(() => void start());
}
