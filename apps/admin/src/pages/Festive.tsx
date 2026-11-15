import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChristmasOptions, FestiveSettings } from '@femia/contracts';
import { ApiError, get, put } from '../lib/api.ts';
import { ago, dateTime } from '../lib/format.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorBox, Field, Skeleton, useToast } from '../components/ui.tsx';

const STOREFRONT = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:4321';
const ART = '/festive/christmas';
const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = (s: string) => (s ? new Date(s).toISOString() : null);

type Status = 'on' | 'scheduled' | 'ended' | 'off';
function statusOf(f: FestiveSettings, id: string, now = Date.now()): Status {
  if (f.theme !== id) return 'off';
  if (f.startsAt && Date.parse(f.startsAt) > now) return 'scheduled';
  if (f.endsAt && Date.parse(f.endsAt) <= now) return 'ended';
  return 'on';
}
const OPTION_ROWS: { key: 'garland' | 'stars' | 'seal' | 'details' | 'christmasDay'; label: string; hint: string }[] = [
  { key: 'garland', label: 'Zari garland', hint: 'Gold-thread pine with maroon berries and pearls, following the arch under your logo.' },
  { key: 'stars', label: 'Hanging stars', hint: 'Four gold stars on fine threads from the header (computers only).' },
  { key: 'seal', label: 'Christmas seal', hint: 'A turning pine-green seal on the home page photo that links to your collection.' },
  { key: 'details', label: 'Festive details', hint: 'Pine-green announcement bar, a footer border stitched with fir trees, stars for the gold diamonds.' },
  { key: 'christmasDay', label: 'Christmas Day greeting', hint: 'On 25 December the seal says “Merry Christmas” and the sparkle is a little richer.' },
];

/** Festive themes: seasonal decorations for the website, switched on now or between dates. */
export default function Festive() {
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan()('settings.write');
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: { festive: FestiveSettings } }>('/admin/settings') });
  const saved = q.data?.settings.festive;
  const [f, setF] = useState<FestiveSettings | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => { if (saved && !f) { setF(saved); setScheduled(!!(saved.startsAt || saved.endsAt)); } }, [saved, f]);

  const save = useMutation({
    mutationFn: (next: FestiveSettings) => put<FestiveSettings>('/admin/settings/festive', next),
    onSuccess: (r, next) => {
      qc.setQueryData(['settings'], (old: { settings: Record<string, unknown> } | undefined) => (old ? { ...old, settings: { ...old.settings, festive: r } } : old));
      setF(r); setErr({});
      const st = statusOf(r, 'christmas');
      toast({ text: next.theme === null ? 'Christmas theme switched off' : st === 'scheduled' ? `Christmas will start ${ago(r.startsAt)}` : st === 'on' ? 'Christmas is on the website. It shows within a minute.' : 'Saved' });
    },
    onError: (e) => { if (e instanceof ApiError) setErr(e.fields); toast({ text: (e as Error).message, bad: true }); },
  });

  if (q.isPending || (!f && !q.error)) return <Skeleton n={2} h={220} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const cur = f!;
  const opts = cur.themes.christmas;
  const setOpt = <K extends keyof ChristmasOptions>(k: K, v: ChristmasOptions[K]) => setF({ ...cur, themes: { ...cur.themes, christmas: { ...opts, [k]: v } } });
  const dirty = JSON.stringify({ ...cur, ...(scheduled ? {} : { startsAt: null, endsAt: null }) }) !== JSON.stringify(saved);
  const body = (theme: FestiveSettings['theme']): FestiveSettings => ({ ...cur, theme, ...(scheduled ? {} : { startsAt: null, endsAt: null }) });
  const st = statusOf(saved!, 'christmas');
  const year = new Date().getFullYear();
  const preset = (s: Date, e: Date) => { setScheduled(true); setF({ ...cur, startsAt: s.toISOString(), endsAt: e.toISOString() }); };

  return (
    <>
      <div className="page-head">
        <div><h1>Festive themes</h1><p className="muted">Decorate the website for a festival. One theme at a time; your products and pages stay the same.</p></div>
      </div>

      <section className={`fx-card${st === 'on' ? ' is-live' : ''}`} aria-labelledby="fx-xmas">
        <div className="fx-scene" aria-hidden="true">
          <div className={`fx-scene__announce${opts.details ? ' is-festive' : ''}`}>Free shipping above ₹999</div>
          <div className="fx-scene__bar"><span className="fx-scene__logo">femia</span></div>
          {opts.garland && <img className="fx-scene__arch" src={`${ART}/arch-garland.svg`} alt="" />}
          {opts.stars && [12, 26, 74, 88].map((x, i) => (
            <span key={x} className="fx-scene__star" style={{ left: `${x}%`, ['--len' as string]: `${[22, 40, 32, 18][i]}px` }}><img src={`${ART}/star.svg`} alt="" /></span>
          ))}
          {opts.sparkle !== 'off' && Array.from({ length: 22 }, (_, i) => (
            <i key={i} className={`fx-dust${opts.sparkle === 'snow' ? ' fx-dust--snow' : ''}`} style={{ left: `${(i * 41) % 100}%`, animationDelay: `${-(i * 0.9) % 9}s`, animationDuration: `${8 + (i % 5) * 1.5}s`, width: 2 + (i % 3) * 1.5, height: 2 + (i % 3) * 1.5 }} />
          ))}
          {opts.seal && (
            <div className="fx-scene__seal"><span>{opts.sealText || 'The Christmas Edit'}</span><img src={`${ART}/star.svg`} alt="" /></div>
          )}
          <div className={`fx-scene__foot${opts.details ? ' is-festive' : ''}`} />
        </div>

        <div className="fx-card__body">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="fx-xmas" className="fx-card__name">Christmas</h2>
            <span className={`fx-status fx-status--${st}`}>{st === 'on' ? 'On the website' : st === 'scheduled' ? `Starts ${ago(saved!.startsAt)}` : st === 'ended' ? 'Ended' : 'Off'}</span>
          </div>
          <p className="muted">Christmas embroidered in gold thread: a zari garland under your logo, gold sparkle, a “Christmas Edit” seal on the home page, and pine-green festive details. Quiet while shoppers browse.</p>
          {st === 'on' && saved!.endsAt && <p className="small"><Icon name="clock" size={16} /> Switches off by itself {ago(saved!.endsAt)} ({dateTime(saved!.endsAt)})</p>}
          {st === 'scheduled' && <p className="small"><Icon name="clock" size={16} /> {dateTime(saved!.startsAt)} to {saved!.endsAt ? dateTime(saved!.endsAt) : 'until you switch it off'}</p>}

          <div className="row fx-actions">
            {canWrite && (st === 'off' || st === 'ended'
              ? <button className="btn" onClick={() => save.mutate(body('christmas'))} disabled={save.isPending}><Icon name="sparkle" /> {scheduled && cur.startsAt && Date.parse(cur.startsAt) > Date.now() ? 'Schedule Christmas' : 'Switch on'}</button>
              : <button className="btn btn--quiet" onClick={() => save.mutate(body(null))} disabled={save.isPending}>Switch off</button>)}
            <a className="btn btn--quiet" href={`${STOREFRONT}/?festive=christmas&xmas-day=0`} target="_blank" rel="noopener"><Icon name="eye" /> Preview on website</a>
            {opts.christmasDay && <a className="btn btn--ghost" href={`${STOREFRONT}/?festive=christmas&xmas-day=1`} target="_blank" rel="noopener">See Christmas Day</a>}
          </div>

          <fieldset className="fx-group" disabled={!canWrite}>
            <legend>Sparkle</legend>
            <div className="seg" role="radiogroup" aria-label="Sparkle">
              {([['gold', 'Gold dust'], ['snow', 'Soft snow'], ['off', 'None']] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={opts.sparkle === v} className={opts.sparkle === v ? 'on' : ''} onClick={() => setOpt('sparkle', v)}>{l}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="fx-group" disabled={!canWrite}>
            <legend>What shoppers see</legend>
            <div className="fx-opts">
              {OPTION_ROWS.map((r) => (
                <label key={r.key} className="fx-opt">
                  <span className="hs-switch"><input type="checkbox" checked={opts[r.key]} onChange={(e) => setOpt(r.key, e.target.checked)} /><span aria-hidden="true" /></span>
                  <span><strong>{r.label}</strong><span className="muted small">{r.hint}</span></span>
                </label>
              ))}
            </div>
            {opts.seal && (
              <div className="grid2">
                <Field label="Seal words" hint="Goes around the seal." error={err['themes.christmas.sealText']}>
                  <input className="input" value={opts.sealText} maxLength={32} onChange={(e) => setOpt('sealText', e.target.value)} placeholder="The Christmas Edit" />
                </Field>
                <Field label="Seal opens" hint="A page on your website, like /shop or /collections/festive." error={err['themes.christmas.sealLink']}>
                  <input className="input" value={opts.sealLink} onChange={(e) => setOpt('sealLink', e.target.value)} placeholder="/shop" />
                </Field>
              </div>
            )}
          </fieldset>

          <fieldset className="fx-group" disabled={!canWrite}>
            <legend>When</legend>
            <div className="seg" role="radiogroup" aria-label="When">
              <button type="button" role="radio" aria-checked={!scheduled} className={!scheduled ? 'on' : ''} onClick={() => setScheduled(false)}>Until I switch it off</button>
              <button type="button" role="radio" aria-checked={scheduled} className={scheduled ? 'on' : ''} onClick={() => setScheduled(true)}>Between dates</button>
            </div>
            {scheduled && (
              <>
                <div className="grid2">
                  <Field label="Starts" hint="Empty starts it straight away." error={err.startsAt}><input className="input" type="datetime-local" value={toLocal(cur.startsAt)} onChange={(e) => setF({ ...cur, startsAt: fromLocal(e.target.value) })} /></Field>
                  <Field label="Ends" hint="It switches off by itself." error={err.endsAt}><input className="input" type="datetime-local" value={toLocal(cur.endsAt)} onChange={(e) => setF({ ...cur, endsAt: fromLocal(e.target.value) })} /></Field>
                </div>
                <div className="row">
                  <span className="muted small">Quick pick</span>
                  <button type="button" className="add-chip add-chip--compact" onClick={() => preset(new Date(year, 11, 1), new Date(year, 11, 31, 23, 59))}>1 – 31 Dec</button>
                  <button type="button" className="add-chip add-chip--compact" onClick={() => preset(new Date(year, 11, 15), new Date(year + 1, 0, 1, 23, 59))}>15 Dec – 1 Jan</button>
                  <button type="button" className="add-chip add-chip--compact" onClick={() => preset(new Date(year, 11, 20), new Date(year, 11, 26, 23, 59))}>20 – 26 Dec</button>
                </div>
              </>
            )}
          </fieldset>

          {canWrite && (
            <div className="row fx-save">
              <span className="muted small">{dirty ? 'You have unsaved changes.' : 'Changes show on the website within about a minute.'}</span>
              <span className="spacer" />
              {dirty && <button className="btn btn--quiet" onClick={() => { setF(saved!); setScheduled(!!(saved!.startsAt || saved!.endsAt)); }}>Undo</button>}
              <button className="btn" onClick={() => save.mutate(body(saved!.theme))} disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
            </div>
          )}
          {!canWrite && <p className="muted small">Only the owner can change festive themes.</p>}
        </div>
      </section>
      <p className="muted small" style={{ marginTop: "var(--sp-4)" }}>More festivals can be added as themes later; they'll appear here.</p>
    </>
  );
}
