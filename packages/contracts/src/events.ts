import { z } from 'zod';

export const AnalyticsEventName = z.enum(['page_view', 'view_item', 'add_to_bag', 'begin_checkout', 'purchase', 'search', 'newsletter_signup', 'trial_request']);
export const AnalyticsEvent = z.object({
  name: AnalyticsEventName,
  sessionId: z.string().min(8).max(64),
  path: z.string().max(200).optional(),
  productId: z.string().max(64).optional(),
  variantId: z.string().max(64).optional(),
  value: z.number().int().nonnegative().optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEvent>;
export const AnalyticsBatch = z.object({ events: z.array(AnalyticsEvent).min(1).max(20) });
