import { atom, computed, type WritableAtom } from 'nanostores';

/** localStorage-backed atom. Storage can be unavailable (private mode), so every access is guarded. */
function persistent<T>(key: string, initial: T): WritableAtom<T> {
  const read = (): T => {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : initial; } catch { return initial; }
  };
  const store = atom<T>(typeof window === 'undefined' ? initial : read());
  if (typeof window !== 'undefined') {
    store.listen((v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } });
    window.addEventListener('storage', (e) => { if (e.key === key) store.set(read()); });
  }
  return store;
}

export interface CartLine {
  variantId: string;
  qty: number;
  productId: string;
  slug: string;
  title: string;
  optionLabel: string;
  price: number;
  compareAtPrice: number | null;
  image: string | null;
}

export interface WishItem { productId: string; slug: string; title: string; price: number; image: string | null; addedAt: number }

export const $cart = persistent<CartLine[]>('femia.cart.v1', []);
export const $wishlist = persistent<WishItem[]>('femia.wishlist.v1', []);
export const $cartCount = computed($cart, (lines) => lines.reduce((n, l) => n + l.qty, 0));

export function addToCart(line: Omit<CartLine, 'qty'>, qty = 1) {
  const lines = $cart.get();
  const i = lines.findIndex((l) => l.variantId === line.variantId);
  if (i >= 0) $cart.set(lines.map((l, j) => (j === i ? { ...l, ...line, qty: Math.min(10, l.qty + qty) } : l)));
  else $cart.set([...lines, { ...line, qty }]);
}
export const setQty = (variantId: string, qty: number) =>
  $cart.set(qty <= 0 ? $cart.get().filter((l) => l.variantId !== variantId) : $cart.get().map((l) => (l.variantId === variantId ? { ...l, qty: Math.min(10, qty) } : l)));
export const removeLine = (variantId: string) => setQty(variantId, 0);
export const clearCart = () => $cart.set([]);

export const isWished = (productId: string) => $wishlist.get().some((w) => w.productId === productId);
export function toggleWish(item: Omit<WishItem, 'addedAt'>) {
  const list = $wishlist.get();
  $wishlist.set(list.some((w) => w.productId === item.productId) ? list.filter((w) => w.productId !== item.productId) : [{ ...item, addedAt: Date.now() }, ...list]);
}

/**
 * Pieces a shopper wants to try on at the boutique: one entry per product, with up to TRIAL_MAX_SIZES sizes to try.
 * `sizeOptions` holds the product's size labels; null means not known yet (added from the wishlist) and is filled in later.
 */
export interface TrialItem {
  productId: string; slug: string; title: string; price: number; image: string | null;
  colour: string | null; sizes: string[]; sizeOptions: string[] | null; addedAt: number;
}
export const TRIAL_MAX = 6;
export const TRIAL_MAX_SIZES = 3;
export const $trial = persistent<TrialItem[]>('femia.trial.v2', []);
export const inTrial = (productId: string) => $trial.get().some((i) => i.productId === productId);
const mergeSizes = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(-TRIAL_MAX_SIZES);
/** Adds a piece, or updates it (new colour, extra size). Returns false when the list is already full. */
export function addTrial(item: Omit<TrialItem, 'addedAt'>): boolean {
  const list = $trial.get();
  const i = list.findIndex((x) => x.productId === item.productId);
  if (i >= 0) {
    $trial.set(list.map((x, j) => (j === i ? { ...x, ...item, sizes: mergeSizes(x.sizes, item.sizes), sizeOptions: item.sizeOptions ?? x.sizeOptions } : x)));
    return true;
  }
  if (list.length >= TRIAL_MAX) return false;
  $trial.set([...list, { ...item, addedAt: Date.now() }]);
  return true;
}
export const updateTrial = (productId: string, patch: Partial<Omit<TrialItem, 'productId'>>) =>
  $trial.set($trial.get().map((x) => (x.productId === productId ? { ...x, ...patch } : x)));
export function toggleTrialSize(productId: string, size: string) {
  const it = $trial.get().find((x) => x.productId === productId);
  if (!it) return;
  updateTrial(productId, { sizes: it.sizes.includes(size) ? it.sizes.filter((s) => s !== size) : mergeSizes(it.sizes, [size]) });
}
export const removeTrial = (productId: string) => $trial.set($trial.get().filter((x) => x.productId !== productId));

/** The visit the shopper last sent on WhatsApp, and a fingerprint of what was in that message. */
export interface TrialVisit { key: string; long: string; window: string; range: string | null; from: number; to: number; sig: string; sentAt: number }
export const $trialVisit = persistent<TrialVisit | null>('femia.trial.visit.v1', null);
export const clearTrial = () => { $trial.set([]); $trialVisit.set(null); };
