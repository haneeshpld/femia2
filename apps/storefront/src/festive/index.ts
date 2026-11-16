/**
 * Festive themes. The owner picks one in Admin; the server marks it on <html data-festive="christmas">.
 * Themes decorate the home page only: leaving it takes the decorations down, coming back puts them up again.
 * Each theme lives in its own folder (./<id>/) and builds on the shared kit (./kit.ts); it is only downloaded when it's on.
 * A theme's start() mounts its decorations and returns refresh() (run after every page change) and stop().
 *
 * Preview without switching it on for everyone: add ?festive=christmas to any page (remembered for this tab),
 * ?festive=off to see the site plain, and ?festive=live to go back to what shoppers see. ?festive-day=1 previews
 * the festival-day greeting (0 to stop).
 */
export interface FestiveInstance { refresh(): void; stop(): void }
export interface FestiveTheme { start(root: HTMLElement, options: Record<string, unknown>): FestiveInstance }

const THEMES: Record<string, () => Promise<{ default: FestiveTheme }>> = {
  christmas: () => import('./christmas/index.ts'),
  ramzan: () => import('./ramzan/index.ts'),
  bakrid: () => import('./bakrid/index.ts'),
  onam: () => import('./onam/index.ts'),
  vishu: () => import('./vishu/index.ts'),
  india: () => import('./india/index.ts'),
};
const PREVIEW_KEY = 'femia.festive.preview';
const NAMES: Record<string, string> = { christmas: 'Christmas', ramzan: 'Ramzan & Eid', bakrid: 'Bakrid', onam: 'Onam', vishu: 'Vishu', india: 'national days' };

let current: { id: string; inst: FestiveInstance } | null = null;
let pending: symbol | null = null;

function readPreview(): string | null {
  const q = new URLSearchParams(location.search).get('festive');
  try {
    if (q === 'live') sessionStorage.removeItem(PREVIEW_KEY);
    else if (q) sessionStorage.setItem(PREVIEW_KEY, q);
    return sessionStorage.getItem(PREVIEW_KEY);
  } catch { return q && q !== 'live' ? q : null; }
}

function previewBadge(preview: string | null) {
  let el = document.getElementById('festive-preview');
  if (!preview) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('a');
    el.id = 'festive-preview';
    el.className = 'festive-preview';
    document.getElementById('festive-root')?.appendChild(el);
  }
  el.setAttribute('href', `${location.pathname}?festive=live`);
  el.textContent = preview === 'off' ? 'Previewing without decorations · Exit' : `Previewing ${NAMES[preview] ?? preview} theme · Exit`;
}

function apply() {
  const html = document.documentElement;
  const root = document.getElementById('festive-root');
  if (!root) return;
  const live = html.dataset.festive || null;
  const preview = readPreview();
  const want = preview === 'off' ? null : preview ?? live;
  const home = location.pathname === '/';
  const id = home && want && THEMES[want] ? want : null;
  previewBadge(preview);

  if (id) html.dataset.festiveOn = id; else delete html.dataset.festiveOn;
  if (current?.id === id) { current?.inst.refresh(); return; }
  current?.inst.stop();
  current = null;
  if (!id) { pending = null; return; }

  let options: Record<string, unknown> = {};
  if (id === live) { try { options = JSON.parse(html.dataset.festiveOpts || '{}'); } catch { /* defaults */ } }
  const token = Symbol(id);
  pending = token;
  THEMES[id]!().then((m) => {
    if (pending !== token) return;
    current = { id, inst: m.default.start(root, options) };
  }).catch(() => {});
}

apply();
document.addEventListener('astro:after-swap', apply);
