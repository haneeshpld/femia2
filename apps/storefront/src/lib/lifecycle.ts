/**
 * Page lifecycle for the client router: scripts run once, but pages are swapped in place.
 * onPage(fn) runs fn on every page (initial load + each navigation); fn may return a cleanup,
 * which runs just before the next page swaps in (kill listeners, timelines, observers).
 */
type Cleanup = void | (() => void);

export function onPage(fn: () => Cleanup) {
  let cleanup: Cleanup;
  document.addEventListener('astro:page-load', () => {
    try { cleanup = fn(); } catch (e) { console.error(e); }
  });
  document.addEventListener('astro:before-swap', () => {
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
    cleanup = undefined;
  });
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
