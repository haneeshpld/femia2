import { useCallback, useEffect, useState } from 'react';
import { onUi } from '../../lib/ui-events.ts';
import { CartDrawer } from './CartDrawer.tsx';
import { QuickAdd } from './QuickAdd.tsx';
import { SearchOverlay } from './SearchOverlay.tsx';
import { TrialSheet, type TrialStore } from './TrialSheet.tsx';
import { TRY_ON_ENABLED } from '../../lib/features.ts';
import { Icon } from './Icon.tsx';

/** One island for every overlay, hydrated on idle. Static markup talks to it through ui-events. */
export default function Shell({ freeShippingThreshold, sizeGuide, store, onReady }: { freeShippingThreshold: number; sizeGuide: string; store: TrialStore; onReady?: () => void }) {
  const [cart, setCart] = useState(false);
  const [search, setSearch] = useState(false);
  const [trial, setTrial] = useState(false);
  const [quick, setQuick] = useState<{ slug: string; colour?: string | null; origin?: DOMRect; imageUrl?: string | null } | null>(null);
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    const off = onUi((e) => {
      if (e.type === 'cart:open') setCart(true);
      if (e.type === 'search:open') setSearch(true);
      if (e.type === 'trial:open') { setCart(false); setTrial(true); }
      if (e.type === 'quick-add') setQuick({ slug: e.slug, colour: e.colour, origin: e.origin, imageUrl: e.imageUrl });
      if (e.type === 'toast') setToast({ title: e.message, detail: '' });
    });
    // Moving to another page (the bag's Checkout button, a product link, a search result…) closes every overlay,
    // which also hands scrolling back to the new page.
    const closeAll = () => { setCart(false); setSearch(false); setTrial(false); setQuick(null); setToast(null); };
    document.addEventListener('astro:before-preparation', closeAll);
    onReady?.(); // listening now: the loader replays anything queued before React arrived
    return () => { off(); document.removeEventListener('astro:before-preparation', closeAll); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const closeCart = useCallback(() => setCart(false), []);
  const closeSearch = useCallback(() => setSearch(false), []);
  const closeQuick = useCallback(() => setQuick(null), []);
  const closeTrial = useCallback(() => setTrial(false), []);

  return (
    <>
      <CartDrawer open={cart} onClose={closeCart} threshold={freeShippingThreshold} />
      <SearchOverlay open={search} onClose={closeSearch} />
      {TRY_ON_ENABLED && store.wa && <TrialSheet open={trial} onClose={closeTrial} store={store} />}
      <QuickAdd slug={quick?.slug ?? null} colour={quick?.colour} origin={quick?.origin} imageUrl={quick?.imageUrl} onClose={closeQuick}
        onAdded={(item) => setToast({ title: 'Added to your bag', detail: item })} sizeGuide={sizeGuide} />
      <div className={`toast${toast ? ' is-on' : ''}`} role="status" aria-live="polite">
        {toast && (
          <>
            <span className="toast__seal" aria-hidden="true"><Icon name="check" size={18} /></span>
            <span className="toast__text"><strong>{toast.title}</strong>{toast.detail && <span>{toast.detail}</span>}</span>
            <button type="button" onClick={() => { setToast(null); setCart(true); }}>View bag</button>
          </>
        )}
      </div>
    </>
  );
}
