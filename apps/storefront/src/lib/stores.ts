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
