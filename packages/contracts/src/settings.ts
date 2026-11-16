import { z } from 'zod';
import { Email, Phone } from './common.ts';
import { ShippingSettings } from './shipping.ts';

export const DayHours = z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/), closed: z.boolean().default(false) });

export const StoreSettings = z.object({
  name: z.string().min(1).default('Femia'),
  tagline: z.string().default('Elegant Ethnicwear for Every Occasion'),
  email: Email.or(z.literal('')).default(''),
  phone: z.string().default(''),
  whatsapp: z.string().default(''),
  address: z.object({
    line1: z.string().default(''), line2: z.string().default(''), city: z.string().default(''),
    state: z.string().default('Kerala'), pincode: z.string().default(''),
  }).prefault({}),
  mapUrl: z.string().default(''),
  geo: z.object({ lat: z.number(), lng: z.number() }).nullable().default(null),
  hoursSummary: z.string().default(''),
  hours: z.array(DayHours).length(7).nullable().default(null),
  socials: z.object({
    instagram: z.string().default(''), facebook: z.string().default(''), youtube: z.string().default(''),
    /** WhatsApp group / community invite (chat.whatsapp.com/…), separate from the order number in `whatsapp` */
    whatsappGroup: z.string().default(''),
  }).prefault({}),
});
export type StoreSettings = z.infer<typeof StoreSettings>;

export const PaymentSettings = z.object({
  upi: z.object({ enabled: z.boolean().default(true), vpa: z.string().default(''), payeeName: z.string().default(''), holdHours: z.number().int().min(1).max(72).default(12) }).prefault({}),
  gateway: z.object({ enabled: z.boolean().default(false), provider: z.enum(['razorpay', 'cashfree', 'phonepe', 'payu']).default('razorpay'), testMode: z.boolean().default(true) }).prefault({}),
  whatsapp: z.object({ enabled: z.boolean().default(true) }).prefault({}),
});
export type PaymentSettings = z.infer<typeof PaymentSettings>;

export const NotificationSettings = z.object({
  telegramChatId: z.string().default(''),
  lowStockThreshold: z.number().int().min(0).default(2),
  dailySummary: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

/** Lists the product wizard offers (owner can extend them from Admin → Catalog setup or inline). */
export const DEFAULT_COLOURS: { label: string; hex: string }[] = [
  { label: 'Maroon', hex: '#7A1F2B' }, { label: 'Red', hex: '#B3261E' }, { label: 'Pink', hex: '#E58FA6' }, { label: 'Rose', hex: '#D98A86' },
  { label: 'Peach', hex: '#F3D9C4' }, { label: 'Mustard', hex: '#D9A21B' }, { label: 'Yellow', hex: '#EFCB4A' }, { label: 'Olive', hex: '#6E6B33' },
  { label: 'Green', hex: '#2F6B3F' }, { label: 'Teal', hex: '#1F6E6B' }, { label: 'Blue', hex: '#2F5DA8' }, { label: 'Navy', hex: '#1F2A4D' },
  { label: 'Lavender', hex: '#B9A0D8' }, { label: 'Purple', hex: '#5E3A87' }, { label: 'Cream', hex: '#F2E2CC' }, { label: 'White', hex: '#FAFAF7' },
  { label: 'Beige', hex: '#D9C3A5' }, { label: 'Brown', hex: '#6B4330' }, { label: 'Grey', hex: '#8B8B8B' }, { label: 'Black', hex: '#1C1C1C' },
];
export const CatalogPresets = z.object({
  colours: z.array(z.object({ label: z.string().trim().min(1).max(30), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7A1628') })).max(80).default(DEFAULT_COLOURS),
  sizes: z.array(z.string().trim().min(1).max(20)).max(40).default(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free Size']),
  fabrics: z.array(z.string().trim().min(1).max(40)).max(60).default(['Cotton', 'Rayon', 'Georgette', 'Silk', 'Linen', 'Chiffon', 'Crepe', 'Muslin', 'Chanderi', 'Organza']),
});
export type CatalogPresets = z.infer<typeof CatalogPresets>;

/**
 * Festive themes: seasonal decorations the owner switches on from Admin. One theme at a time, optionally scheduled.
 * Each theme keeps its own options so switching between them never loses choices. New festivals add a key here
 * and a folder in the storefront (src/festive/<id>).
 */
export const FESTIVE_THEMES = ['christmas', 'ramzan', 'bakrid', 'onam', 'vishu', 'india'] as const;
export const FestiveThemeId = z.enum(FESTIVE_THEMES);
export type FestiveThemeId = z.infer<typeof FestiveThemeId>;
export const ChristmasOptions = z.object({
  /** gold dust and glints, or soft snow */
  sparkle: z.enum(['gold', 'snow', 'off']).default('gold'),
  /** an embroidered gold pine garland with berries along the header */
  garland: z.boolean().default(true),
  /** zari stars and pine and berry baubles hanging from the header on gold threads */
  stars: z.boolean().default(true),
  /** the circular "Christmas Edit" seal on the home page hero */
  seal: z.boolean().default(true),
  sealText: z.string().trim().max(32).default('The Christmas Edit'),
  sealLink: z.string().trim().max(200).regex(/^\//, 'Use a page on your website, like /shop').default('/shop'),
  /** pine-green announcement bar, the embroidered footer band and stars in place of the gold diamonds */
  details: z.boolean().default(true),
  /** on 25 December the seal says Merry Christmas and the sparkle is a little richer */
  christmasDay: z.boolean().default(true),
});
export type ChristmasOptions = z.infer<typeof ChristmasOptions>;
const sealText = (d: string) => z.string().trim().max(32).default(d);
const sealLink = z.string().trim().max(200).regex(/^\//, 'Use a page on your website, like /shop').default('/shop');
/** Optional greeting on the festival day itself (dates follow the moon, so the owner sets the day). */
const greetingDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date').nullable().default(null);
/** Ramzan and Eid al-Fitr (id ramzan): brass lanterns and crescents, a strand of warm lights, mehndi details. */
export const RamzanOptions = z.object({
  /** warm motes of lantern light drifting up the page */
  sparkle: z.enum(['glow', 'off']).default('glow'),
  /** a strand of warm lights along the header, with small stars and a crescent */
  lights: z.boolean().default(true),
  /** lanterns and crescents hanging from the header (computers and tablets) */
  lanterns: z.boolean().default(true),
  seal: z.boolean().default(true),
  sealText: sealText('The Festive Edit'),
  sealLink,
  /** night-blue announcement bar, a mehndi border on the footer, crescents for the gold diamonds */
  details: z.boolean().default(true),
  /** on this day the seal shows the greeting */
  greetingDay,
  greetingText: z.string().trim().max(24).default('Eid Mubarak'),
});
export type RamzanOptions = z.infer<typeof RamzanOptions>;
/** Bakrid: a teal-and-gold toran along the header, eight-point star medallions and tassels, jaali details. */
export const BakridOptions = z.object({
  /** a little gold dust drifting down */
  sparkle: z.enum(['gold', 'off']).default('gold'),
  /** the scalloped toran (doorway hanging) along the header */
  toran: z.boolean().default(true),
  /** star medallions and tassels hanging from the header (computers and tablets) */
  medallions: z.boolean().default(true),
  seal: z.boolean().default(true),
  sealText: sealText('The Celebration Edit'),
  sealLink,
  /** teal announcement bar, a jaali border on the footer, eight-point stars for the gold diamonds */
  details: z.boolean().default(true),
  greetingDay,
  greetingText: z.string().trim().max(24).default('Eid Mubarak'),
});
export type BakridOptions = z.infer<typeof BakridOptions>;
/** Onam: a mango-leaf and marigold thoranam, pookalam medallions and marigold strings, falling petals, kasavu details. */
export const OnamOptions = z.object({
  /** marigold and chethi petals drifting down */
  sparkle: z.enum(['petals', 'off']).default('petals'),
  /** mango leaves and marigolds strung along the header */
  thoranam: z.boolean().default(true),
  /** pookalam medallions and marigold strings hanging from the header (computers and tablets) */
  flowers: z.boolean().default(true),
  seal: z.boolean().default(true),
  sealText: sealText('The Harvest Edit'),
  sealLink,
  /** kasavu-cream announcement bar, a kasavu gold border on the footer, small flowers for the gold diamonds */
  details: z.boolean().default(true),
  greetingDay,
  greetingText: z.string().trim().max(24).default('Happy Onam'),
});
export type OnamOptions = z.infer<typeof OnamOptions>;
/** Vishu: a konna branch along the header, golden-shower clusters hanging from it, falling yellow petals. */
export const VishuOptions = z.object({
  sparkle: z.enum(['petals', 'off']).default('petals'),
  /** a leafy konna branch with blossom sprays along the header */
  branch: z.boolean().default(true),
  /** golden-shower flower clusters hanging from the header (computers and tablets) */
  blossoms: z.boolean().default(true),
  seal: z.boolean().default(true),
  sealText: sealText('The Golden Edit'),
  sealLink,
  /** leaf-green announcement bar, konna flowers along the footer, flowers for the gold diamonds */
  details: z.boolean().default(true),
  greetingDay,
  greetingText: z.string().trim().max(24).default('Happy Vishu'),
});
export type VishuOptions = z.infer<typeof VishuOptions>;
/** India's national days: tricolour bunting, kites and rosettes, falling tricolour petals, the chakra. */
export const IndiaOptions = z.object({
  /** saffron, white and green petals drifting down */
  sparkle: z.enum(['petals', 'off']).default('petals'),
  /** tricolour pennants strung along the header */
  bunting: z.boolean().default(true),
  /** tricolour kites and rosettes hanging from the header (computers and tablets) */
  kites: z.boolean().default(true),
  seal: z.boolean().default(true),
  sealText: sealText('Celebrating India'),
  sealLink,
  /** navy announcement bar with a tricolour edge, a tricolour border on the footer, the chakra for the gold diamonds */
  details: z.boolean().default(true),
  /** on 26 January and 15 August the seal wishes shoppers a happy Republic Day or Independence Day */
  dayGreeting: z.boolean().default(true),
});
export type IndiaOptions = z.infer<typeof IndiaOptions>;
const when = z.string().datetime({ offset: true }).nullable().default(null);
export const FestiveSettings = z.object({
  theme: FestiveThemeId.nullable().default(null),
  startsAt: when,
  endsAt: when,
  themes: z.object({
    christmas: ChristmasOptions.prefault({}), ramzan: RamzanOptions.prefault({}), bakrid: BakridOptions.prefault({}),
    onam: OnamOptions.prefault({}), vishu: VishuOptions.prefault({}), india: IndiaOptions.prefault({}),
  }).prefault({}),
}).refine((f) => !f.startsAt || !f.endsAt || Date.parse(f.endsAt) > Date.parse(f.startsAt), { message: 'The end must be after the start', path: ['endsAt'] });
export type FestiveSettings = z.infer<typeof FestiveSettings>;
/** Which theme the website shows right now (schedule applied). */
export function activeFestive(f: FestiveSettings, now = Date.now()): { theme: FestiveThemeId; options: Record<string, unknown> } | null {
  if (!f.theme) return null;
  if (f.startsAt && Date.parse(f.startsAt) > now) return null;
  if (f.endsAt && Date.parse(f.endsAt) <= now) return null;
  return { theme: f.theme, options: f.themes[f.theme] };
}

export const Settings = z.object({
  store: StoreSettings.prefault({}),
  shipping: ShippingSettings.prefault({}),
  payments: PaymentSettings.prefault({}),
  notifications: NotificationSettings.prefault({}),
  catalog: CatalogPresets.prefault({}),
  festive: FestiveSettings.prefault({}),
});
export type Settings = z.infer<typeof Settings>;

/** Safe subset for the storefront (no chat ids, no keys). */
export const PublicSettings = z.object({
  store: StoreSettings,
  shipping: ShippingSettings,
  payments: z.object({
    upi: z.boolean(), upiVpa: z.string(), upiPayee: z.string(), gateway: z.boolean(), gatewayProvider: z.string(), cod: z.boolean(), codMax: z.number().nullable(), whatsapp: z.boolean(),
  }),
  festive: z.object({ theme: FestiveThemeId, options: z.record(z.string(), z.unknown()) }).nullable().default(null),
});
export type PublicSettings = z.infer<typeof PublicSettings>;

export const NewsletterRequest = z.object({ email: Email, source: z.string().max(40).default('footer') });
export const PincodeCheckRequest = z.object({ pincode: z.string().trim() });
export const PincodeCheckResult = z.object({ ok: z.boolean(), state: z.string().nullable(), message: z.string() });
export { Phone };
