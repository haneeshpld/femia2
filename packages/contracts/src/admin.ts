import { z } from 'zod';
import { Id, Paise, Slug } from './common.ts';
import { OrderStatus, PaymentMethod, OrderChannel } from './orders.ts';
import { ProductStatus } from './catalog.ts';

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7A1628');

/** Payload of the 5-step product wizard (Photos → Details → Sizes & Colours → Price → Preview & Publish). */
export const ProductInput = z.object({
  title: z.string().trim().min(2, 'Give the product a name').max(80),
  slug: Slug.optional(),
  description: z.string().trim().max(2000).default(''),
  categoryId: Id,
  fabric: z.string().trim().max(60).default(''),
  care: z.string().trim().max(500).default(''),
  sizeChart: z.string().max(2000).nullable().default(null),
  price: Paise.refine((p) => p > 0, 'Enter a price'),
  compareAtPrice: Paise.nullable().default(null),
  option1Values: z.array(z.object({ value: z.string().trim().min(1).max(20), label: z.string().trim().max(30).optional() })).max(20).default([]),
  option2Values: z.array(z.object({ value: z.string().trim().min(1).max(30), label: z.string().trim().min(1).max(30), swatch: Hex.nullable().default(null) })).max(12).default([]),
  variants: z.array(z.object({
    id: Id.optional(),
    option1: z.string().nullable(),
    option2: z.string().nullable(),
    sku: z.string().trim().max(40).optional(),
    price: Paise.nullable().default(null),
    /** Opening stock: only used when the variant is created. Later changes go through stock adjustments. */
    onHand: z.number().int().min(0).max(9999).default(0),
    lowStockThreshold: z.number().int().min(0).nullable().default(null),
    active: z.boolean().default(true),
  })).min(1, 'Add at least one size or colour').max(120),
  images: z.array(z.object({ mediaId: Id, role: z.enum(['main', 'alt', 'detail']), option2: z.string().nullable() })).max(40).default([]),
  collectionIds: z.array(Id).max(20).default([]),
  seoTitle: z.string().max(70).default(''),
  seoDescription: z.string().max(160).default(''),
}).superRefine((p, ctx) => {
  if (p.compareAtPrice !== null && p.compareAtPrice <= p.price) ctx.addIssue({ code: 'custom', path: ['compareAtPrice'], message: 'MRP must be higher than the selling price' });
  const keys = new Set<string>();
  p.variants.forEach((v, i) => {
    const k = `${v.option1}|${v.option2}`;
    if (keys.has(k)) ctx.addIssue({ code: 'custom', path: ['variants', i], message: 'Duplicate size and colour' });
    keys.add(k);
  });
});
export type ProductInput = z.input<typeof ProductInput>;

export const ProductStatusInput = z.object({ status: ProductStatus });

export const AdminProductListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: ProductStatus.optional(),
  category: Id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const OrderTransitionInput = z.object({
  to: OrderStatus,
  note: z.string().trim().max(500).optional(),
  courier: z.string().trim().max(60).optional(),
  trackingNumber: z.string().trim().max(60).optional(),
  trackingUrl: z.url().optional().or(z.literal('').transform(() => undefined)),
  reason: z.string().trim().max(200).optional(),
});

export const AdminOrderListQuery = z.object({
  status: z.union([OrderStatus, z.literal('active'), z.literal('all')]).default('active'),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const ManualOrderInput = z.object({
  channel: OrderChannel.exclude(['web']),
  paymentMethod: PaymentMethod.exclude(['gateway']),
  paid: z.boolean().default(false),
  note: z.string().max(500).default(''),
});

export const OrderNoteInput = z.object({ note: z.string().trim().min(1).max(500) });

export const ContentDraftInput = z.object({ data: z.record(z.string(), z.unknown()), note: z.string().max(140).default('') });

export const MediaPatch = z.object({ alt: z.string().trim().max(200) });

export const GatewayKeysInput = z.object({ provider: z.enum(['razorpay', 'cashfree', 'phonepe', 'payu']), keys: z.record(z.string(), z.string().trim().min(1)) });

export const UserInput = z.object({ email: z.email().toLowerCase(), name: z.string().trim().max(60).default(''), roleId: z.string(), active: z.boolean().default(true) });
