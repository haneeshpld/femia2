import { useCallback, useEffect, useState } from 'react';
import { onUi } from '../../lib/ui-events.ts';
import { CartDrawer } from './CartDrawer.tsx';
import { QuickAdd } from './QuickAdd.tsx';
import { SearchOverlay } from './SearchOverlay.tsx';
import './shell.css';

/** One island for every overlay, hydrated on idle. Static markup talks to it through ui-events. */
export default function Shell({ freeShippingThreshold, sizeGuide }: { freeShippingThreshold: number; sizeGuide: string }) {
  const [cart, setCart] = useState(false);
  const [search, setSearch] = useState(false);
  const [quick, setQuick] = useState<{ slug: string; colour?: string | null; origin?: DOMRect; imageUrl?: string | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => onUi((e) => {
    if (e.type === 'cart:open') setCart(true);
    if (e.type === 'search:open') setSearch(true);
    if (e.type === 'quick-add') setQuick({ slug: e.slug, colour: e.colour, origin: e.origin, imageUrl: e.imageUrl });
    if (e.type === 'toast') setToast(e.message);
  }), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const closeCart = useCallback(() => setCart(false), []);
  const closeSearch = useCallback(() => setSearch(false), []);
  const closeQuick = useCallback(() => setQuick(null), []);

  return (
    <>
      <CartDrawer open={cart} onClose={closeCart} threshold={freeShippingThreshold} />
      <SearchOverlay open={search} onClose={closeSearch} />
      <QuickAdd slug={quick?.slug ?? null} colour={quick?.colour} origin={quick?.origin} imageUrl={quick?.imageUrl} onClose={closeQuick} onAdded={setToast} sizeGuide={sizeGuide} />
      <div className={`toast${toast ? ' is-on' : ''}`} role="status" aria-live="polite">
        {toast && <><span>{toast}</span><button type="button" onClick={() => { setToast(null); setCart(true); }}>View Bag</button></>}
      </div>
    </>
  );
}
