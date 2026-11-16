import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useState } from 'react';
import type { ProductDetail } from '@femia/contracts';
import { formatINR } from '@femia/contracts/money';
import { $trial, $trialVisit, clearTrial, removeTrial, toggleTrialSize, updateTrial, TRIAL_MAX, TRIAL_MAX_SIZES } from '../../lib/stores.ts';
import { dayParts, todayKey, trialMessage, trialSig, visitDays, visitIcs, type WindowId } from '../../lib/visit.ts';
import { signedInHint } from '../../lib/account.ts';
import { track } from '../../lib/analytics.ts';
import { json } from '../../lib/http.ts';
import type { DayHours } from '../../lib/hours.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

/** What the panel needs from the store settings. `wa` is the WhatsApp number in international digits. */
export interface TrialStore { wa: string; place: string; mapUrl: string; hours: DayHours[] | null }

/**
 * "Try at the boutique": the try-on list (with up to three sizes per piece), a visit day and time from the real
 * opening hours, and a ready-made WhatsApp message. The sent visit is remembered, so a returning shopper sees it,
 * can add it to her calendar, and sends an update only when something changed.
 */
export function TrialSheet({ open, onClose, store }: { open: boolean; onClose: () => void; store: TrialStore }) {
  const items = useStore($trial);
  const visit = useStore($trialVisit);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [winId, setWinId] = useState<WindowId | null>(null);
  const [name, setName] = useState('');

  // Slots are worked out when the panel opens, so "today" never offers a time that has passed.
  const days = useMemo(() => (open ? visitDays(store.hours) : []), [open, store.hours]);
  const day = days.find((d) => d.key === dayKey) ?? null;
  const win = day?.windows.find((w) => w.id === winId) ?? null;

  useEffect(() => {
    if (!open) return;
    if (!name) setName(signedInHint()?.name ?? '');
    // A visit in the past is done: forget it. Otherwise start from it.
    const v = $trialVisit.get();
    if (v && v.key < todayKey()) $trialVisit.set(null);
    else if (v && !dayKey) { setDayKey(v.key); setWinId(v.sig.split('|')[1] as WindowId); }
    if (dayKey && !days.some((d) => d.key === dayKey)) { setDayKey(null); setWinId(null); }
    // Pieces added from the wishlist don't know their sizes yet.
    for (const it of $trial.get().filter((i) => i.sizeOptions === null)) {
      fetch(`/api/catalog/products/${encodeURIComponent(it.slug)}`).then((r) => (r.ok ? json<ProductDetail>(r) : null))
        .then((p) => { if (p) updateTrial(it.productId, { sizeOptions: p.option1Values.map((o) => o.label), image: it.image ?? p.images[0]?.src['480'] ?? null }); })
        .catch(() => {});
    }
  }, [open]);

  const pickDay = (key: string) => {
    setDayKey(key);
    const next = days.find((d) => d.key === key);
    if (winId && !next?.windows.some((w) => w.id === winId)) setWinId(null);
  };

  const sig = day && win ? trialSig(items, day.key, win.id) : null;
  const upToDate = !!visit && visit.sig === sig;
  const href = day && win && items.length
    ? `https://wa.me/${store.wa}?text=${encodeURIComponent(trialMessage({ items, origin: location.origin, day, window: win, name, update: !!visit }))}`
    : null;
  const total = items.reduce((s, i) => s + i.price * Math.max(1, i.sizes.length), 0);
  const sizeCount = items.reduce((n, i) => n + i.sizes.length, 0);
  const status = !visit ? 'draft' : upToDate ? 'sent' : 'changed';
  const tile = day ? dayParts(day.key) : null;

  const send = () => {
    if (!day || !win || !sig) return;
    track('trial_request', { value: total, meta: { items: items.length, day: day.key, window: win.id, update: !!visit } });
    $trialVisit.set({ key: day.key, long: day.long, window: win.label, range: win.range, from: win.from, to: win.to, sig, sentAt: Date.now() });
  };

  const addToCalendar = () => {
    if (!visit) return;
    const ics = visitIcs({ key: visit.key, from: visit.from, to: visit.to, place: store.place, mapUrl: store.mapUrl, pieces: items.map((i) => i.title) });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'femia-try-on.ics' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const footer = items.length > 0 && (
    upToDate ? (
      <div className="trial__sent" role="status">
        <p><Icon name="check" size={18} /> <span>Sent on WhatsApp. The boutique will reply there to confirm.</span></p>
        <button type="button" className="line__remove" onClick={() => { clearTrial(); setDayKey(null); setWinId(null); onClose(); }}>Clear my list</button>
      </div>
    ) : href ? (
      <a className="btn btn--block" href={href} target="_blank" rel="noopener" onClick={send}>
        <Icon name="whatsapp" size={20} /> {visit ? 'Send the update on WhatsApp' : 'Send my list on WhatsApp'}
      </a>
    ) : (
      <button type="button" className="btn btn--block" disabled>Choose a day and time</button>
    )
  );

  return (
    <Sheet open={open} onClose={onClose} labelledBy="trial-title" footer={footer}
      title={<>Try at the boutique{items.length > 0 && <span className="sheet__count"> ({items.length})</span>}</>}>
      {items.length === 0 ? (
        <div className="empty">
          <span className="empty__icon"><Icon name="hanger" size={36} /></span>
          <h3>Nothing to try yet</h3>
          <p>On any piece, tap <strong>Try it at the boutique</strong>. Add up to {TRIAL_MAX}, pick a time, and send the list to us on WhatsApp.</p>
          <a className="btn" href="/shop">Browse the edit</a>
        </div>
      ) : (
        <div className="trial">
          {/* The fitting card fills in as she chooses, and becomes the confirmation once sent. */}
          <section className={`fit fit--${status}`} aria-label="Your fitting">
            <div className={`fit__date${tile ? '' : ' fit__date--empty'}`} aria-hidden="true">
              {tile ? <><span>{day!.label === 'Today' ? 'Today' : tile.dow}</span><strong>{tile.date}</strong><span>{tile.month}</span></> : <Icon name="hanger" size={26} />}
            </div>
            <div className="fit__body">
              <p className="fit__status">{status === 'sent' ? 'Requested on WhatsApp' : status === 'changed' ? 'Changed since you sent it' : 'Your fitting'}</p>
              <p className="fit__title">{day ? day.long.replace(/^(today|tomorrow), /, '') : 'Choose a day'}</p>
              <p className="fit__meta">{win ? `${win.label}${win.range ? ` · ${win.range}` : ''}` : 'and a time below'}</p>
              <p className="fit__meta">{items.length} {items.length === 1 ? 'piece' : 'pieces'}{sizeCount > 0 && ` · ${sizeCount} ${sizeCount === 1 ? 'size' : 'sizes'}`}{store.place && ` · ${store.place}`}</p>
              {visit && (
                <div className="fit__actions">
                  <button type="button" className="fit__action" onClick={addToCalendar}><Icon name="plus" size={16} /> Add to calendar</button>
                  {store.mapUrl && <a className="fit__action" href={store.mapUrl} target="_blank" rel="noopener"><Icon name="navigate" size={16} /> Directions</a>}
                </div>
              )}
            </div>
          </section>

          <h3 className="trial__h">Pieces</h3>
          <ul className="lines" role="list">
            {items.map((it) => (
              <li key={it.productId} className="line">
                <a href={`/products/${it.slug}`} className="line__img">{it.image ? <img src={it.image} alt="" width={84} height={112} loading="lazy" /> : null}</a>
                <div className="line__info">
                  <a href={`/products/${it.slug}`} className="line__title">{it.title}</a>
                  <p className="line__opt">{[it.colour, formatINR(it.price)].filter(Boolean).join(' · ')}</p>
                  {it.sizeOptions && it.sizeOptions.length > 0 && (
                    <div className="trial__sizes" role="group" aria-label={`Sizes to try for ${it.title}, up to ${TRIAL_MAX_SIZES}`}>
                      {it.sizeOptions.map((s) => (
                        <button key={s} type="button" className="trial__size" aria-pressed={it.sizes.includes(s)} onClick={() => toggleTrialSize(it.productId, s)}>{s}</button>
                      ))}
                    </div>
                  )}
                  {it.sizeOptions && it.sizeOptions.length > 0 && it.sizes.length === 0 && <p className="trial__hint">Pick sizes to try, or we'll help you find yours in store.</p>}
                  <div className="line__row"><button type="button" className="line__remove" onClick={() => removeTrial(it.productId)}>Remove</button></div>
                </div>
              </li>
            ))}
          </ul>
          {items.length >= TRIAL_MAX && <p className="trial__note">Your list is full. Remove a piece to add another.</p>}

          <fieldset className="trial__step">
            <legend className="trial__h">When will you come in?</legend>
            {days.length === 0 ? (
              <p className="trial__note">No open days in the coming week. Message us on WhatsApp and we'll find a time.</p>
            ) : (
              <div className="dates" role="group" aria-label="Day">
                {days.map((d) => {
                  const p = dayParts(d.key);
                  return (
                    <button key={d.key} type="button" className="date" aria-pressed={d.key === dayKey} aria-label={d.long} onClick={() => pickDay(d.key)}>
                      <span>{d.label === 'Today' || d.label === 'Tomorrow' ? d.label : p.dow}</span><strong>{p.date}</strong><span>{p.month}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {day && (
              <div className="chips chips--time" role="group" aria-label="Time">
                {day.windows.map((w) => (
                  <button key={w.id} type="button" className="chip chip--time" aria-pressed={w.id === winId} onClick={() => setWinId(w.id)}>
                    <span>{w.label}</span>{w.range && <small>{w.range}</small>}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <div className="field">
            <label htmlFor="trial-name">Your name <span className="muted">(optional)</span></label>
            <input id="trial-name" className="input" type="text" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
      )}
    </Sheet>
  );
}
