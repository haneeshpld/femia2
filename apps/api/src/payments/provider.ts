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
  outcome: 'paid' | 'failed' | 'ignored';
  raw: unknown;
}

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
}
