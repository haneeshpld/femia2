import { z } from 'zod';
import { Id } from './common.ts';

export const StockReason = z.enum(['restock', 'sale', 'return', 'adjustment', 'damage', 'hold', 'release', 'cancel']);
export type StockReason = z.infer<typeof StockReason>;
/** Reasons a person can pick in Admin; the rest are written by the system. */
export const MANUAL_STOCK_REASONS = ['restock', 'return', 'adjustment', 'damage'] as const;

export const StockAdjustInput = z.object({
  variantId: Id,
  delta: z.number().int().refine((n) => n !== 0, 'Change must not be zero').refine((n) => Math.abs(n) <= 9999),
  reason: z.enum(MANUAL_STOCK_REASONS),
  note: z.string().trim().max(200).default(''),
});
export type StockAdjustInput = z.input<typeof StockAdjustInput>;
