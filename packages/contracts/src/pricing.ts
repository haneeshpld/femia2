import type { Paise } from './common.ts';
import type { ShippingSettings } from './shipping.ts';
import { cartDiscounts, type AppliedDiscount, type Offer, type ScopeItem } from './offers.ts';

/** What the server knows about a variant when quoting. Never trust client prices. */
export interface PricedVariant {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  option1: string | null;
  option2: string | null;
  optionLabel: string;
  imageUrl: string | null;
  price: Paise;
  compareAtPrice: Paise | null;
  available: number;
  purchasable: boolean;
  /** price before any automatic sale (sale price is `price`) */
  listPrice?: Paise;
  saleLabel?: string | null;
  scope?: ScopeItem;
}

export type QuoteIssue =
  | { variantId: string; code: 'unavailable' }
  | { variantId: string; code: 'sold_out' }
  | { variantId: string; code: 'reduced'; requested: number; available: number };

export interface QuoteLine extends PricedVariant { qty: number; lineTotal: Paise }

export interface Quote {
  lines: QuoteLine[];
  itemCount: number;
  subtotal: Paise;
  savings: Paise;
  shipping: Paise;
  total: Paise;
  freeShippingThreshold: Paise;
  freeShippingRemaining: Paise;
  issues: QuoteIssue[];
  /** cart-level deals (bundle, coupon) */
  discounts: AppliedDiscount[];
  discountTotal: Paise;
  /** "Add 1 more piece to get 10% off" */
  nudge: string | null;
  coupon: { code: string; applied: boolean; message: string } | null;
}

export interface QuoteOffers {
  offers: Offer[];
  /** a coupon the server has already checked for usage limits and first-order rules */
  coupon?: Offer | null;
  couponCode?: string | null;
  couponError?: string | null;
  now?: number;
}

export const MAX_QTY_PER_LINE = 10;

/**
 * Pure cart pricing, used by both /cart/quote and /orders so the two can never disagree.
 * Lines whose variant is missing/unpurchasable/sold out are dropped with an issue; quantities are clamped to stock.
 */
export function quoteCart(
  requested: { variantId: string; qty: number }[],
  variants: Map<string, PricedVariant>,
  shipping: Pick<ShippingSettings, 'freeShippingThreshold' | 'flatFee'>,
  deals?: QuoteOffers,
): Quote {
  const merged = new Map<string, number>();
  for (const r of requested) merged.set(r.variantId, (merged.get(r.variantId) ?? 0) + Math.max(0, Math.floor(r.qty)));

  const lines: QuoteLine[] = [];
  const issues: QuoteIssue[] = [];
  for (const [variantId, wanted] of merged) {
    if (wanted === 0) continue;
    const v = variants.get(variantId);
    if (!v || !v.purchasable) { issues.push({ variantId, code: 'unavailable' }); continue; }
    if (v.available <= 0) { issues.push({ variantId, code: 'sold_out' }); continue; }
    const cap = Math.min(v.available, MAX_QTY_PER_LINE);
    const qty = Math.min(wanted, cap);
    if (qty < wanted) issues.push({ variantId, code: 'reduced', requested: wanted, available: qty });
    lines.push({ ...v, qty, lineTotal: v.price * qty });
  }

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const cart = deals && lines.length
    ? cartDiscounts(lines.map((l) => ({ qty: l.qty, lineTotal: l.lineTotal, scope: l.scope ?? { productId: l.productId, categoryId: '', collectionIds: [] } })), deals.offers, deals.coupon ?? null, deals.now)
    : { applied: [], discountTotal: 0, nudge: null, couponError: null };
  const couponMsg = deals?.couponError ?? cart.couponError;
  const coupon = deals?.couponCode
    ? (couponMsg || !cart.applied.some((a) => a.kind === 'coupon')
      ? { code: deals.couponCode, applied: false, message: couponMsg ?? `${deals.couponCode} doesn't apply to the items in your bag` }
      : { code: deals.couponCode, applied: true, message: `${deals.couponCode} applied` })
    : null;
  const afterDiscounts = subtotal - cart.discountTotal;
  const savings = lines.reduce((s, l) => {
    const was = Math.max(l.compareAtPrice ?? 0, l.listPrice ?? 0);
    return s + (was > l.price ? (was - l.price) * l.qty : 0);
  }, 0) + cart.discountTotal;
  const free = afterDiscounts >= shipping.freeShippingThreshold;
  const shippingFee = subtotal === 0 || free ? 0 : shipping.flatFee;
  return {
    lines,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
    subtotal,
    savings,
    shipping: shippingFee,
    total: afterDiscounts + shippingFee,
    freeShippingThreshold: shipping.freeShippingThreshold,
    freeShippingRemaining: Math.max(0, shipping.freeShippingThreshold - afterDiscounts),
    issues,
    discounts: cart.applied,
    discountTotal: cart.discountTotal,
    nudge: cart.nudge,
    coupon,
  };
}
