/** Tiny event bus between static Astro markup and the React shell island. */
export type UiEvent =
  | { type: 'cart:open' }
  | { type: 'search:open' }
  | { type: 'trial:open' }
  | { type: 'quick-add'; slug: string; colour?: string | null; origin?: DOMRect; imageUrl?: string | null }
  | { type: 'toast'; message: string };

export const emit = (e: UiEvent) => window.dispatchEvent(new CustomEvent('femia:ui', { detail: e }));
export const onUi = (fn: (e: UiEvent) => void) => {
  const h = (ev: Event) => fn((ev as CustomEvent<UiEvent>).detail);
  window.addEventListener('femia:ui', h);
  return () => window.removeEventListener('femia:ui', h);
};
