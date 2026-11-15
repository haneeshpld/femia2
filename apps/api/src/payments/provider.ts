import type { Env } from '../env.ts';

export interface GatewayOrderArgs {
  orderId: string;
  number: string;
  amount: number; // paise
  customer: { name: string; email: string; phone: string };
  storeName: string;
  /** which payment options checkout opens on */
  payWith?: 'upi' | 'other' | null;
}

export interface WebhookResult {
  eventId: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  /** upi, card, netbanking, wallet… when the gateway says */
  instrument?: string | null;
  outcome: 'paid' | 'failed' | 'ignored' | 'refund';
  /** what the gateway says was paid (paise), checked against what we asked for */
  amount?: number | null;
  currency?: string | null;
  /** for refund events */
  refund?: { providerRefundId: string; status: RefundState };
  raw: unknown;
}
export type RefundState = 'pending' | 'processed' | 'failed';

/**
 * The gateway clearly said no (its own error, e.g. "amount too high"): nothing happened on its side. Any other
 * failure (timeout, dropped connection, a 5xx) is NOT a clear no: the gateway may have done what we asked.
 */
export class GatewayRejection extends Error {}

/**
 * One file per gateway. Adding Cashfree / PhonePe / PayU later = implement this interface and register it below.
 * Keys come from encrypted settings, so switching a gateway on needs no redeploy.
 */
export interface PaymentProvider<Keys = Record<string, string>> {
  id: 'razorpay' | 'cashfree' | 'phonepe' | 'payu';
  label: string;
  keyFields: { id: keyof Keys & string; label: string; secret: boolean }[];
  createOrder(args: GatewayOrderArgs, keys: Keys, env: Env): Promise<{ providerOrderId: string; payload: Record<string, unknown> }>;
  /** Verify the signed payload the browser receives after a successful checkout (fast path before the webhook). */
  verifyClientReturn(params: Record<string, string>, keys: Keys): Promise<{ providerOrderId: string; providerPaymentId: string; instrument?: string | null } | null>;
  verifyWebhook(req: Request, rawBody: string, keys: Keys): Promise<WebhookResult | null>;
  /**
   * Ask the gateway directly whether an order was paid (for missed webhooks and before a hold is released).
   * Payments that are only authorised are captured here, for the exact amount we expect.
   */
  checkOrder(providerOrderId: string, expectedAmount: number, keys: Keys): Promise<{ status: 'paid' | 'pending'; providerPaymentId: string | null; instrument?: string | null }>;
  /**
   * Send money back to the original payment method. `notes.refund_id` is our own id for this refund, so it can be
   * found again with findRefund. Throws GatewayRejection when the gateway clearly refused.
   */
  refund(providerPaymentId: string, amount: number, keys: Keys, notes: Record<string, string>): Promise<{ providerRefundId: string; status: RefundState }>;
  refundStatus(providerRefundId: string, keys: Keys): Promise<RefundState>;
  /**
   * Did the gateway already make the refund we call `refundId`? Asked whenever an earlier answer was lost, and
   * before every retry, so the same money is never sent back twice. Null = the gateway has no such refund.
   */
  findRefund(providerPaymentId: string, refundId: string, keys: Keys): Promise<{ providerRefundId: string; status: RefundState } | null>;
  /**
   * The checkout options for paying an existing gateway order a particular way (UPI first, or cards / netbanking),
   * so a shopper who closes the window can come back and pay the same order differently.
   */
  checkoutFor(payload: Record<string, unknown>, payWith: 'upi' | 'other' | null): Record<string, unknown>;
  /** Environment secrets that hold this provider's keys (Worker secrets win over keys saved in Admin). */
  envKeys(env: Env): Partial<Keys>;
}
