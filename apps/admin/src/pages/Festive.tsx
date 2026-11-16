import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FestiveSettings, FestiveThemeId } from '@femia/contracts';
import { ApiError, get, put } from '../lib/api.ts';
import { ago, dateTime } from '../lib/format.ts';
import { useCan } from '../lib/me.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorBox, Field, Skeleton, useToast } from '../components/ui.tsx';

const STOREFRONT = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:4321';
const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = (s: string) => (s ? new Date(s).toISOString() : null);
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number, h = 0, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, m);
const shortDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

type ThemeId = FestiveThemeId;
type Opts = Record<string, unknown>;
type Status = 'on' | 'scheduled' | 'ended' | 'off';
function statusOf(f: FestiveSettings, id: string, now = Date.now()): Status {
  if (f.theme !== id) return 'off';
  if (f.startsAt && Date.parse(f.startsAt) > now) return 'scheduled';
  if (f.endsAt && Date.parse(f.endsAt) <= now) return 'ended';
  return 'on';
}

/**
 * Festival dates in India that follow the moon (approximate; the moon sighting can move them by a day).
 * Used only for the quick picks, which the owner can adjust.
 */
const LUNAR: { ramzanStarts: string; eidFitr: string; eidAdha: string; year: number }[] = [
  { year: 2027, ramzanStarts: '2027-02-08', eidFitr: '2027-03-10', eidAdha: '2027-05-17' },
  { year: 2028, ramzanStarts: '2028-01-28', eidFitr: '2028-02-27', eidAdha: '2028-05-05' },
  { year: 2029, ramzanStarts: '2029-01-16', eidFitr: '2029-02-15', eidAdha: '2029-04-24' },
];
const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); };
/** Thiruvonam (Malayalam calendar, approximate) and Vishu; check the year's calendar before relying on them. */
const ONAM = ['2027-09-12', '2028-09-01', '2029-08-22'];
const nextDate = (list: string[]) => parseYmd(list.find((d) => addDays(parseYmd(d), 3) > new Date()) ?? list[list.length - 1]!);
/** The next time this month-day comes round (still this year while it's under way). */
const nextYearly = (month: number, day: number, grace = 3) => {
  const now = new Date(), d = new Date(now.getFullYear(), month - 1, day);
  return addDays(d, grace) > now ? d : new Date(now.getFullYear() + 1, month - 1, day);
};
const nextLunar = (key: 'eidFitr' | 'eidAdha') => LUNAR.find((l) => addDays(parseYmd(l[key]), 4) > new Date()) ?? LUNAR[LUNAR.length - 1]!;

interface Drop { pin: number; len: number; w: number; art: string }
interface ThemeDef {
  name: string;
  blurb: string;
  /** announcement bar, seal disc, and the bar's text colour when the bar is light */
  colors: { bar: string; bar2: string; disc: [string, string, string]; ink?: string };
  strip: { w: number; h: number; key: string };
  drops: { list: Drop[]; key: string };
  sparkle: { value: string; label: string }[];
  particle: (v: string) => 'gold' | 'snow' | 'glow' | 'marigold' | 'konna' | 'tricolour' | null;
  switches: { key: string; label: string; hint: string }[];
  sealDefault: string;
  /** a date the owner picks (moon-led festivals), or fixed dates switched on by an option */
  greeting: 'date' | { key: string };
  presets: () => { label: string; start: Date; end: Date; day?: string }[];
}

// The same layout the website uses (apps/storefront/src/festive/<id>/index.ts), so the preview is faithful.
const THEMES: Record<ThemeId, ThemeDef> = {
  christmas: {
    name: 'Christmas',
    blurb: 'Christmas embroidered in gold thread: a pine garland with berries along the menu bar, zari stars and baubles hanging from it, gold dust or soft snow, a pine-green seal on the home page and pine-green details.',
    colors: { bar: '#1F4D3A', bar2: '#12331F', disc: ['#2A5E45', '#18402E', '#0D2519'] },
    strip: { w: 260, h: 52, key: 'garland' },
    drops: { key: 'stars', list: [
      { pin: -2, len: 34, w: 36, art: 'star.svg' }, { pin: -1, len: 62, w: 40, art: 'bauble-berry.svg' }, { pin: 1, len: 40, w: 40, art: 'bauble-pine.svg' },
      { pin: 2, len: 70, w: 30, art: 'star.svg' }, { pin: -3, len: 52, w: 28, art: 'star.svg' }, { pin: 3, len: 26, w: 38, art: 'bauble-berry.svg' },
    ] },
    sparkle: [{ value: 'gold', label: 'Gold dust' }, { value: 'snow', label: 'Soft snow' }, { value: 'off', label: 'None' }],
    particle: (v) => (v === 'gold' ? 'gold' : v === 'snow' ? 'snow' : null),
    switches: [
      { key: 'garland', label: 'Pine garland', hint: 'Gold-thread pine with berries and pearls, along the bottom of the menu bar.' },
      { key: 'stars', label: 'Stars and baubles', hint: 'Zari stars and pine and berry baubles on fine threads (computers and tablets).' },
      { key: 'seal', label: 'Seal on the home page', hint: 'A turning pine-green seal on the main photo that opens your collection.' },
      { key: 'details', label: 'Festive details', hint: 'Pine-green announcement bar, fir trees stitched along the footer, stars for the gold diamonds.' },
      { key: 'christmasDay', label: 'Christmas Day greeting', hint: 'On 25 December the seal says “Merry Christmas” and the sparkle is a little richer.' },
    ],
    sealDefault: 'The Christmas Edit',
    greeting: { key: 'christmasDay' },
    presets: () => {
      const y = new Date().getMonth() === 0 && new Date().getDate() < 2 ? new Date().getFullYear() - 1 : new Date().getFullYear();
      return [
        { label: '1 – 31 Dec', start: new Date(y, 11, 1), end: new Date(y, 11, 31, 23, 59) },
        { label: '15 Dec – 1 Jan', start: new Date(y, 11, 15), end: new Date(y + 1, 0, 1, 23, 59) },
        { label: '20 – 26 Dec', start: new Date(y, 11, 20), end: new Date(y, 11, 26, 23, 59) },
      ];
    },
  },
  ramzan: {
    name: 'Ramzan & Eid',
    blurb: 'A lantern night for Ramzan and Eid al-Fitr: a strand of warm lights along the menu bar, brass lanterns and crescents at both edges, lantern light drifting up the page, a night-blue seal and a mehndi border along the footer.',
    colors: { bar: '#262B57', bar2: '#1A1D40', disc: ['#343A72', '#222653', '#14163A'] },
    strip: { w: 200, h: 44, key: 'lights' },
    drops: { key: 'lanterns', list: [
      { pin: -3, len: 26, w: 54, art: 'lantern.svg' }, { pin: 3, len: 44, w: 50, art: 'lantern.svg' }, { pin: -2, len: 64, w: 40, art: 'crescent.svg' },
      { pin: 2, len: 20, w: 42, art: 'crescent.svg' }, { pin: -4, len: 70, w: 20, art: 'star.svg' }, { pin: 4, len: 40, w: 22, art: 'star.svg' },
      { pin: -1, len: 30, w: 18, art: 'star.svg' }, { pin: 1, len: 52, w: 16, art: 'star.svg' },
    ] },
    sparkle: [{ value: 'glow', label: 'Lantern light' }, { value: 'off', label: 'None' }],
    particle: (v) => (v === 'glow' ? 'glow' : null),
    switches: [
      { key: 'lights', label: 'String of lights', hint: 'Warm lights on a gold thread along the bottom of the menu bar, with small stars and a crescent.' },
      { key: 'lanterns', label: 'Lanterns and crescents', hint: 'Brass lanterns with a soft glow and gold crescents on fine threads (computers and tablets).' },
      { key: 'seal', label: 'Seal on the home page', hint: 'A turning night-blue seal with a crescent on the main photo that opens your collection.' },
      { key: 'details', label: 'Festive details', hint: 'Night-blue announcement bar, a mehndi vine along the footer, crescents for the gold diamonds.' },
    ],
    sealDefault: 'The Festive Edit',
    greeting: 'date',
    presets: () => {
      const l = nextLunar('eidFitr'), eid = parseYmd(l.eidFitr), starts = parseYmd(l.ramzanStarts);
      return [
        { label: `Ramzan to Eid (${shortDate(starts)} – ${shortDate(addDays(eid, 3))})`, start: addDays(starts, -1), end: addDays(eid, 3, 23, 59), day: l.eidFitr },
        { label: `Eid week (${shortDate(addDays(eid, -3))} – ${shortDate(addDays(eid, 3))})`, start: addDays(eid, -3), end: addDays(eid, 3, 23, 59), day: l.eidFitr },
      ];
    },
  },
  bakrid: {
    name: 'Bakrid',
    blurb: 'A dressed doorway for Bakrid: a scalloped teal-and-gold toran along the menu bar, eight-point star medallions and gold tassels hanging from it, a little gold dust, a teal seal and a jaali border along the footer.',
    colors: { bar: '#175058', bar2: '#0C3A40', disc: ['#1F6670', '#124850', '#082C31'] },
    strip: { w: 80, h: 57, key: 'toran' },
    drops: { key: 'medallions', list: [
      { pin: -8, len: 28, w: 50, art: 'medallion.svg' }, { pin: 8, len: 46, w: 46, art: 'medallion.svg' }, { pin: -6, len: 14, w: 20, art: 'tassel.svg' },
      { pin: 6, len: 22, w: 20, art: 'tassel.svg' }, { pin: -4, len: 54, w: 34, art: 'medallion.svg' }, { pin: 4, len: 10, w: 34, art: 'medallion.svg' },
      { pin: -10, len: 12, w: 18, art: 'tassel.svg' }, { pin: 10, len: 24, w: 18, art: 'tassel.svg' },
    ] },
    sparkle: [{ value: 'gold', label: 'Gold dust' }, { value: 'off', label: 'None' }],
    particle: (v) => (v === 'gold' ? 'gold' : null),
    switches: [
      { key: 'toran', label: 'Toran', hint: 'A scalloped teal-and-gold doorway hanging along the bottom of the menu bar.' },
      { key: 'medallions', label: 'Medallions and tassels', hint: 'Eight-point star medallions and gold tassels on fine threads (computers and tablets).' },
      { key: 'seal', label: 'Seal on the home page', hint: 'A turning teal seal with a star medallion on the main photo that opens your collection.' },
      { key: 'details', label: 'Festive details', hint: 'Teal announcement bar, a jaali border along the footer, eight-point stars for the gold diamonds.' },
    ],
    sealDefault: 'The Celebration Edit',
    greeting: 'date',
    presets: () => {
      const l = nextLunar('eidAdha'), eid = parseYmd(l.eidAdha);
      return [
        { label: `Bakrid week (${shortDate(addDays(eid, -4))} – ${shortDate(addDays(eid, 3))})`, start: addDays(eid, -4), end: addDays(eid, 3, 23, 59), day: l.eidAdha },
        { label: `Three days (${shortDate(addDays(eid, -1))} – ${shortDate(addDays(eid, 1))})`, start: addDays(eid, -1), end: addDays(eid, 1, 23, 59), day: l.eidAdha },
      ];
    },
  },
  onam: {
    name: 'Onam',
    blurb: 'A Kerala doorway at harvest: a thoranam of mango leaves and marigolds along the menu bar, pookalam medallions and marigold strings hanging from it, falling marigold and chethi petals, a kasavu-cream announcement bar and the gold kasavu border along the footer.',
    colors: { bar: '#F7EDD3', bar2: '#EEDDB4', disc: ['#C9502C', '#9E3418', '#63190A'], ink: '#3B2A18' },
    strip: { w: 96, h: 52, key: 'thoranam' },
    drops: { key: 'flowers', list: [
      { pin: -6, len: 30, w: 52, art: 'pookalam.svg' }, { pin: 6, len: 48, w: 48, art: 'pookalam.svg' }, { pin: -5, len: 14, w: 20, art: 'marigolds.svg' },
      { pin: 5, len: 8, w: 20, art: 'marigolds.svg' }, { pin: -3, len: 56, w: 36, art: 'pookalam.svg' }, { pin: 3, len: 18, w: 36, art: 'pookalam.svg' },
      { pin: -7, len: 6, w: 18, art: 'marigolds.svg' }, { pin: 7, len: 20, w: 18, art: 'marigolds.svg' },
    ] },
    sparkle: [{ value: 'petals', label: 'Flower petals' }, { value: 'off', label: 'None' }],
    particle: (v) => (v === 'petals' ? 'marigold' : null),
    switches: [
      { key: 'thoranam', label: 'Thoranam', hint: 'Mango leaves and marigolds strung along the bottom of the menu bar.' },
      { key: 'flowers', label: 'Pookalam and marigolds', hint: 'Pookalam medallions and strings of marigolds on fine threads (computers and tablets).' },
      { key: 'seal', label: 'Seal on the home page', hint: 'A turning chethi-red seal with a pookalam on the main photo that opens your collection.' },
      { key: 'details', label: 'Festive details', hint: 'Kasavu-cream announcement bar, the gold kasavu border along the footer, flowers for the gold diamonds.' },
    ],
    sealDefault: 'The Harvest Edit',
    greeting: 'date',
    presets: () => {
      const d = nextDate(ONAM), day = ymd(d);
      return [
        { label: `Atham to Thiruvonam (${shortDate(addDays(d, -10))} – ${shortDate(addDays(d, 1))})`, start: addDays(d, -10), end: addDays(d, 1, 23, 59), day },
        { label: `Onam week (${shortDate(addDays(d, -4))} – ${shortDate(addDays(d, 2))})`, start: addDays(d, -4), end: addDays(d, 2, 23, 59), day },
      ];
    },
  },
  vishu: {
    name: 'Vishu',
    blurb: 'Under the kanikonna: a leafy konna branch along the menu bar with golden-shower clusters hanging from it, falling yellow petals, a leaf-green seal and announcement bar, and konna flowers along the footer.',
    colors: { bar: '#335F26', bar2: '#22461A', disc: ['#44803A', '#2C5E24', '#183C12'] },
    strip: { w: 150, h: 46, key: 'branch' },
    drops: { key: 'blossoms', list: [
      { pin: -4, len: 4, w: 40, art: 'konna.svg' }, { pin: 4, len: 10, w: 38, art: 'konna.svg' }, { pin: -3, len: 2, w: 32, art: 'konna-short.svg' },
      { pin: 3, len: 6, w: 34, art: 'konna-short.svg' }, { pin: -2, len: 8, w: 28, art: 'konna-short.svg' }, { pin: 2, len: 0, w: 34, art: 'konna.svg' },
    ] },
    sparkle: [{ value: 'petals', label: 'Konna petals' }, { value: 'off', label: 'None' }],
    particle: (v) => (v === 'petals' ? 'konna' : null),
    switches: [
      { key: 'branch', label: 'Konna branch', hint: 'A leafy branch with blossom sprays along the bottom of the menu bar.' },
      { key: 'blossoms', label: 'Hanging blossoms', hint: 'Golden-shower flower clusters hanging from the branch (computers and tablets).' },
      { key: 'seal', label: 'Seal on the home page', hint: 'A turning leaf-green seal with a konna flower on the main photo that opens your collection.' },
      { key: 'details', label: 'Festive details', hint: 'Leaf-green announcement bar, konna flowers along the footer, flowers for the gold diamonds.' },
    ],
    sealDefault: 'The Golden Edit',
    greeting: 'date',
    presets: () => {
      const d = nextYearly(4, 14), day = ymd(d);
      return [
        { label: `Vishu week (${shortDate(addDays(d, -5))} – ${shortDate(addDays(d, 1))})`, start: addDays(d, -5), end: addDays(d, 1, 23, 59), day },
        { label: `Three days (${shortDate(addDays(d, -1))} – ${shortDate(addDays(d, 1))})`, start: addDays(d, -1), end: addDays(d, 1, 23, 59), day },
      ];
    },
  },
  india: {
    name: 'National days',
    blurb: 'For Republic Day and Independence Day: tricolour pennant bunting along the menu bar, kites and tricolour rosettes hanging from it, falling saffron, white and green petals, a navy seal with the chakra and a tricolour border along the footer.',
    colors: { bar: '#22337A', bar2: '#16235A', disc: ['#2B3D8A', '#1C2A6A', '#101A4A'] },
    strip: { w: 144, h: 40, key: 'bunting' },
    drops: { key: 'kites', list: [
      { pin: -4, len: 36, w: 56, art: 'kite.svg' }, { pin: 4, len: 56, w: 52, art: 'kite.svg' }, { pin: -3, len: 18, w: 34, art: 'rosette.svg' },
      { pin: 3, len: 30, w: 34, art: 'rosette.svg' }, { pin: -2, len: 60, w: 28, art: 'rosette.svg' }, { pin: 2, len: 12, w: 40, art: 'kite.svg' },
    ] },
    sparkle: [{ value: 'petals', label: 'Tricolour petals' }, { value: 'off', label: 'None' }],
    particle: (v) => (v === 'petals' ? 'tricolour' : null),
    switches: [
      { key: 'bunting', label: 'Tricolour bunting', hint: 'Saffron, white and green pennants strung along the bottom of the menu bar.' },
      { key: 'kites', label: 'Kites and rosettes', hint: 'Tricolour kites and rosettes with the chakra on fine threads (computers and tablets).' },
      { key: 'seal', label: 'Seal on the home page', hint: 'A turning navy seal with the chakra on the main photo that opens your collection.' },
      { key: 'details', label: 'Festive details', hint: 'Navy announcement bar with a tricolour edge, a tricolour border along the footer, the chakra for the gold diamonds.' },
      { key: 'dayGreeting', label: 'Greeting on the day', hint: 'On 26 January and 15 August the seal says “Happy Republic Day” or “Happy Independence Day”.' },
    ],
    sealDefault: 'Celebrating India',
    greeting: { key: 'dayGreeting' },
    presets: () => {
      const r = nextYearly(1, 26, 1), i = nextYearly(8, 15, 1);
      return [
        { label: `Republic Day (${shortDate(addDays(r, -2))} – ${shortDate(addDays(r, 1))})`, start: addDays(r, -2), end: addDays(r, 1, 23, 59) },
        { label: `Independence Day (${shortDate(addDays(i, -2))} – ${shortDate(addDays(i, 1))})`, start: addDays(i, -2), end: addDays(i, 1, 23, 59) },
      ];
    },
  },
};
const ORDER: ThemeId[] = ['christmas', 'ramzan', 'bakrid', 'onam', 'vishu', 'india'];

/** Scales a fixed-size stage (drawn at the website's real sizes) to fit its box. */
function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.5);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setK(e!.contentRect.width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, k };
}

const STAGE_W = 1440, STAGE_H = 470;
/** A miniature of the website's top and foot, decorated exactly as shoppers will see it. */
function Scene({ id, o, mini = false }: { id: ThemeId; o: Opts; mini?: boolean }) {
  const t = THEMES[id];
  const { ref, k } = useFit(STAGE_W);
  const art = (n: string) => `/festive/${id}/${n}`;
  const particle = t.particle(String(o.sparkle));
  const half = STAGE_W / 2 - 24;
  const drops = o[t.drops.key] ? t.drops.list.filter((d) => Math.abs(d.pin * t.strip.w) + d.w / 2 < half) : [];
  return (
    <div ref={ref} className={`fx-scene${mini ? ' fx-scene--mini' : ''}`} style={{ height: STAGE_H * k }} aria-hidden="true">
      <div className="fx-stage" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${k})`, ['--bar' as string]: t.colors.bar, ['--bar2' as string]: t.colors.bar2, ['--bar-ink' as string]: t.colors.ink ?? '#F6EEE4' } as CSSProperties}>
        <div className={`fx-stage__bar${o.details ? ' is-festive' : ''}`}><i />Free shipping above ₹999<i /></div>
        <div className="fx-stage__hdr">
          <span className="fx-stage__logo">femia</span>
          <span className="fx-stage__nav">{['Home', 'Shop', 'Collections', 'About'].map((n, i) => (
            <span key={n} className={i === 0 ? 'on' : ''}>{n}{i === 0 && <i className={o.details ? 'is-festive' : ''} style={o.details ? { ['--mark' as string]: `url(${art('mark.svg')})` } : undefined} />}</span>
          ))}</span>
          <span className="fx-stage__icons"><b /><b /><b /></span>
        </div>
        <div className="fx-stage__hero">
          <span className="fx-stage__line" style={{ width: 380 }} /><span className="fx-stage__line fx-stage__line--accent" style={{ width: 300 }} />
          <span className="fx-stage__line fx-stage__line--body" style={{ width: 330 }} /><span className="fx-stage__btn" />
          <div className="fx-stage__photo"><span /></div>
          <div className="fx-stage__slices"><span /><span /><span /></div>
          {Boolean(o.seal) && (
            <span className="fx-stage__seal" style={{ background: `radial-gradient(circle at 40% 35%, ${t.colors.disc[0]}, ${t.colors.disc[1]} 60%, ${t.colors.disc[2]})` }}>
              <img src={art('seal.svg')} alt="" /><span>{String(o.sealText || t.sealDefault)}</span>
            </span>
          )}
        </div>
        {Boolean(o[t.strip.key]) && <div className="fx-stage__strip" style={{ backgroundImage: `url(${art('strip.svg')})`, backgroundSize: `${t.strip.w}px ${t.strip.h}px`, height: t.strip.h }} />}
        {drops.map((d, i) => (
          <span key={i} className="fx-stage__drop" style={{ left: STAGE_W / 2 + d.pin * t.strip.w, width: d.w, marginLeft: -d.w / 2, ['--len' as string]: `${d.len}px`, animationDelay: `${-i * 1.3}s` } as CSSProperties}>
            <img src={art(d.art)} alt="" />
          </span>
        ))}
        {particle && !mini && Array.from({ length: 26 }, (_, i) => (
          <i key={i} className={`fx-dust fx-dust--${particle}`} style={{ left: `${(i * 41) % 100}%`, animationDelay: `${-(i * 0.9) % 9}s`, animationDuration: `${9 + (i % 5) * 1.6}s`, width: 4 + (i % 3) * 2, height: 4 + (i % 3) * 2 }} />
        ))}
        <div className="fx-stage__foot">{Boolean(o.details) && <span style={{ backgroundImage: `url(${art('hem.svg')})` }} />}</div>
      </div>
    </div>
  );
}

/** Festive themes: seasonal decorations for the website, switched on now or between dates. */
export default function Festive() {
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan()('settings.write');
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: { festive: FestiveSettings } }>('/admin/settings') });
  const saved = q.data?.settings.festive;
  const [f, setF] = useState<FestiveSettings | null>(null);
  const [sel, setSel] = useState<ThemeId>('christmas');
  const [scheduled, setScheduled] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    if (saved && !f) { setF(saved); setScheduled(!!(saved.startsAt || saved.endsAt)); if (saved.theme) setSel(saved.theme); }
  }, [saved, f]);

  const save = useMutation({
    mutationFn: (next: FestiveSettings) => put<FestiveSettings>('/admin/settings/festive', next),
    onSuccess: (r, next) => {
      qc.setQueryData(['settings'], (old: { settings: Record<string, unknown> } | undefined) => (old ? { ...old, settings: { ...old.settings, festive: r } } : old));
      setF(r); setErr({});
      const name = r.theme ? THEMES[r.theme].name : '';
      const st = r.theme ? statusOf(r, r.theme) : 'off';
      toast({ text: next.theme === null ? 'Festive theme switched off' : st === 'scheduled' ? `${name} will start ${ago(r.startsAt)}` : st === 'on' ? `${name} is on the home page. It shows within a minute.` : 'Saved' });
    },
    onError: (e) => { if (e instanceof ApiError) setErr(e.fields); toast({ text: (e as Error).message, bad: true }); },
  });

  if (q.isPending || (!f && !q.error)) return <Skeleton n={2} h={220} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const cur = f!;
  const t = THEMES[sel];
  const opts = cur.themes[sel] as Opts;
  const setOpt = (k: string, v: unknown) => setF({ ...cur, themes: { ...cur.themes, [sel]: { ...opts, [k]: v } } });
  const withWhen = (x: FestiveSettings): FestiveSettings => (scheduled ? x : { ...x, startsAt: null, endsAt: null });
  const dirty = JSON.stringify(withWhen(cur)) !== JSON.stringify(saved);
  const body = (theme: FestiveSettings['theme']): FestiveSettings => withWhen({ ...cur, theme });
  const st = statusOf(saved!, sel);
  const live = saved!.theme && saved!.theme !== sel && statusOf(saved!, saved!.theme) !== 'ended' ? THEMES[saved!.theme] : null;
  const preset = (p: { start: Date; end: Date; day?: string }) => {
    setScheduled(true);
    const next = { ...cur, startsAt: p.start.toISOString(), endsAt: p.end.toISOString() };
    if (p.day && t.greeting === 'date') next.themes = { ...cur.themes, [sel]: { ...opts, greetingDay: p.day } };
    setF(next);
  };
  const preview = (day: boolean) => `${STOREFRONT}/?festive=${sel}&festive-day=${day ? 1 : 0}`;
  const startsLater = scheduled && cur.startsAt && Date.parse(cur.startsAt) > Date.now();
  const e = (k: string) => err[`themes.${sel}.${k}`];

  return (
    <>
      <div className="page-head">
        <div><h1>Festive themes</h1><p className="muted">Decorate the home page for a festival. One theme at a time; the rest of the website stays as it is.</p></div>
      </div>

      <div className="fx-picker" role="radiogroup" aria-label="Festival">
        {ORDER.map((id) => {
          const s = statusOf(saved!, id);
          return (
            <button key={id} type="button" role="radio" aria-checked={sel === id} className={`fx-pick${sel === id ? ' is-sel' : ''}`} onClick={() => setSel(id)}>
              <Scene id={id} o={cur.themes[id] as Opts} mini />
              <span className="fx-pick__row">
                <span className="fx-pick__name">{THEMES[id].name}</span>
                <span className={`fx-status fx-status--${s}`}>{s === 'on' ? 'On the website' : s === 'scheduled' ? `Starts ${ago(saved!.startsAt)}` : s === 'ended' ? 'Ended' : 'Off'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <section className={`fx-card${st === 'on' ? ' is-live' : ''}`} aria-labelledby="fx-name">
        <Scene id={sel} o={opts} />

        <div className="fx-card__body">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="fx-name" className="fx-card__name">{t.name}</h2>
            <span className={`fx-status fx-status--${st}`}>{st === 'on' ? 'On the website' : st === 'scheduled' ? `Starts ${ago(saved!.startsAt)}` : st === 'ended' ? 'Ended' : 'Off'}</span>
          </div>
          <p className="muted fx-card__blurb">{t.blurb} Shows on the home page only, and goes quiet as shoppers scroll.</p>
          {st === 'on' && saved!.endsAt && <p className="small"><Icon name="clock" size={16} /> Switches off by itself {ago(saved!.endsAt)} ({dateTime(saved!.endsAt)})</p>}
          {st === 'scheduled' && <p className="small"><Icon name="clock" size={16} /> {dateTime(saved!.startsAt)} to {saved!.endsAt ? dateTime(saved!.endsAt) : 'until you switch it off'}</p>}
          {live && canWrite && <p className="small fx-note">{live.name} is {statusOf(saved!, saved!.theme!) === 'scheduled' ? 'scheduled' : 'on the website'} now. Switching {t.name} on replaces it.</p>}

          <div className="row fx-actions">
            {canWrite && (st === 'off' || st === 'ended'
              ? <button className="btn" onClick={() => save.mutate(body(sel))} disabled={save.isPending}><Icon name="sparkle" /> {startsLater ? `Schedule ${t.name}` : `Switch on ${t.name}`}</button>
              : <button className="btn btn--quiet" onClick={() => save.mutate(body(null))} disabled={save.isPending}>Switch off</button>)}
            <a className="btn btn--quiet" href={preview(false)} target="_blank" rel="noopener"><Icon name="eye" /> Preview on website</a>
            {(t.greeting === 'date' ? Boolean(opts.greetingDay) : Boolean(opts[t.greeting.key])) && (
              <a className="btn btn--ghost" href={preview(true)} target="_blank" rel="noopener">Preview the festival day</a>
            )}
          </div>

          <fieldset className="fx-group" disabled={!canWrite}>
            <legend>Sparkle</legend>
            <div className="seg" role="radiogroup" aria-label="Sparkle">
              {t.sparkle.map((s) => (
                <button key={s.value} type="button" role="radio" aria-checked={opts.sparkle === s.value} className={opts.sparkle === s.value ? 'on' : ''} onClick={() => setOpt('sparkle', s.value)}>{s.label}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="fx-group" disabled={!canWrite}>
            <legend>What shoppers see</legend>
            <div className="fx-opts">
              {t.switches.map((r) => (
                <label key={r.key} className="fx-opt">
                  <span className="hs-switch"><input type="checkbox" checked={Boolean(opts[r.key])} onChange={(ev) => setOpt(r.key, ev.target.checked)} /><span aria-hidden="true" /></span>
                  <span><strong>{r.label}</strong><span className="muted small">{r.hint}</span></span>
                </label>
              ))}
            </div>
            {Boolean(opts.seal) && (
              <div className="grid2">
                <Field label="Seal words" hint="Goes around the seal." error={e('sealText')}>
                  <input className="input" value={String(opts.sealText ?? '')} maxLength={32} onChange={(ev) => setOpt('sealText', ev.target.value)} placeholder={t.sealDefault} />
                </Field>
                <Field label="Seal opens" hint="A page on your website, like /shop or /collections/festive-edit." error={e('sealLink')}>
                  <input className="input" value={String(opts.sealLink ?? '')} onChange={(ev) => setOpt('sealLink', ev.target.value)} placeholder="/shop" />
                </Field>
              </div>
            )}
          </fieldset>

          {t.greeting === 'date' && (
            <fieldset className="fx-group" disabled={!canWrite}>
              <legend>Festival day greeting</legend>
              <p className="muted small fx-group__lead">On the day you pick, the seal shows your greeting and the sparkle is a little richer. The date moves each year, so set it once it's announced.</p>
              <div className="grid2">
                <Field label="Day" hint={opts.greetingDay ? 'Clear the date to show no greeting.' : 'No greeting until you pick a day.'} error={e('greetingDay')}>
                  <span className="row fx-date">
                    <input className="input" type="date" value={String(opts.greetingDay ?? '')} onChange={(ev) => setOpt('greetingDay', ev.target.value || null)} />
                    {Boolean(opts.greetingDay) && <button type="button" className="btn btn--ghost" onClick={() => setOpt('greetingDay', null)}>Clear</button>}
                  </span>
                </Field>
                <Field label="Greeting" hint="Shown in the middle of the seal." error={e('greetingText')}>
                  <input className="input" value={String(opts.greetingText ?? '')} maxLength={24} onChange={(ev) => setOpt('greetingText', ev.target.value)} placeholder="Eid Mubarak" />
                </Field>
              </div>
            </fieldset>
          )}

          <fieldset className="fx-group" disabled={!canWrite}>
            <legend>When</legend>
            <div className="seg" role="radiogroup" aria-label="When">
              <button type="button" role="radio" aria-checked={!scheduled} className={!scheduled ? 'on' : ''} onClick={() => setScheduled(false)}>Until I switch it off</button>
              <button type="button" role="radio" aria-checked={scheduled} className={scheduled ? 'on' : ''} onClick={() => setScheduled(true)}>Between dates</button>
            </div>
            {scheduled && (
              <>
                <div className="grid2">
                  <Field label="Starts" hint="Empty starts it straight away." error={err.startsAt}><input className="input" type="datetime-local" value={toLocal(cur.startsAt)} onChange={(ev) => setF({ ...cur, startsAt: fromLocal(ev.target.value) })} /></Field>
                  <Field label="Ends" hint="It switches off by itself." error={err.endsAt}><input className="input" type="datetime-local" value={toLocal(cur.endsAt)} onChange={(ev) => setF({ ...cur, endsAt: fromLocal(ev.target.value) })} /></Field>
                </div>
                <div className="row">
                  <span className="muted small">Quick pick</span>
                  {t.presets().map((p) => (
                    <button key={p.label} type="button" className="add-chip add-chip--compact" onClick={() => preset(p)}>{p.label}</button>
                  ))}
                </div>
                {t.greeting === 'date' && <p className="muted small">Quick picks use the expected dates and also set the greeting day. These festivals follow the moon or the Malayalam calendar, so check the date for the year and adjust.</p>}
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
    </>
  );
}
