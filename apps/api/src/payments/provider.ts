import type { Env } from '../env.ts';

export interface GatewayOrderArgs {
  orderId: string;
  number: string;
  amount: number; // paise
  customer: { name: string; email: string; phone: string };
  storeName: string;
}

export interface WebhookResult {
  eventId: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  outcome: 'paid' | 'failed' | 'ignored' | 'refund';
  /** for refund events */
  refund?: { providerRefundId: string; status: RefundState };
  raw: unknown;
}
export type RefundState = 'pending' | 'processed' | 'failed';

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
  verifyClientReturn(params: Record<string, string>, keys: Keys): Promise<{ providerOrderId: string; providerPaymentId: string } | null>;
  verifyWebhook(req: Request, rawBody: string, keys: Keys): Promise<WebhookResult | null>;
  /**
   * Ask the gateway directly whether an order was paid (for missed webhooks and before a hold is released).
   * Payments that are only authorised are captured here, for the exact amount we expect.
   */
  checkOrder(providerOrderId: string, expectedAmount: number, keys: Keys): Promise<{ status: 'paid' | 'pending'; providerPaymentId: string | null }>;
  /** Send money back to the original payment method. */
  refund(providerPaymentId: string, amount: number, keys: Keys, notes: Record<string, string>): Promise<{ providerRefundId: string; status: RefundState }>;
  refundStatus(providerRefundId: string, keys: Keys): Promise<RefundState>;
  /** Environment secrets that hold this provider's keys (Worker secrets win over keys saved in Admin). */
  envKeys(env: Env): Partial<Keys>;
}
