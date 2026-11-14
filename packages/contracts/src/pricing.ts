import type { Paise } from './common.ts';
import type { ShippingSettings } from './shipping.ts';

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
  const savings = lines.reduce((s, l) => s + (l.compareAtPrice && l.compareAtPrice > l.price ? (l.compareAtPrice - l.price) * l.qty : 0), 0);
  const free = subtotal >= shipping.freeShippingThreshold;
  const shippingFee = subtotal === 0 || free ? 0 : shipping.flatFee;
  return {
    lines,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
    subtotal,
    savings,
    shipping: shippingFee,
    total: subtotal + shippingFee,
    freeShippingThreshold: shipping.freeShippingThreshold,
    freeShippingRemaining: Math.max(0, shipping.freeShippingThreshold - subtotal),
    issues,
  };
}
