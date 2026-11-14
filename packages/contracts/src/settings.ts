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
  socials: z.object({ instagram: z.string().default(''), facebook: z.string().default(''), youtube: z.string().default('') }).prefault({}),
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

export const Settings = z.object({
  store: StoreSettings.prefault({}),
  shipping: ShippingSettings.prefault({}),
  payments: PaymentSettings.prefault({}),
  notifications: NotificationSettings.prefault({}),
});
export type Settings = z.infer<typeof Settings>;

/** Safe subset for the storefront (no chat ids, no keys). */
export const PublicSettings = z.object({
  store: StoreSettings,
  shipping: ShippingSettings,
  payments: z.object({
    upi: z.boolean(), upiVpa: z.string(), upiPayee: z.string(), gateway: z.boolean(), gatewayProvider: z.string(), cod: z.boolean(), codMax: z.number().nullable(), whatsapp: z.boolean(),
  }),
});
export type PublicSettings = z.infer<typeof PublicSettings>;

export const NewsletterRequest = z.object({ email: Email, source: z.string().max(40).default('footer') });
export const PincodeCheckRequest = z.object({ pincode: z.string().trim() });
export const PincodeCheckResult = z.object({ ok: z.boolean(), state: z.string().nullable(), message: z.string() });
export { Phone };
