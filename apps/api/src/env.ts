import type { Permission } from '@femia/contracts';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  PUBLIC_SITE_URL: string;
  ADMIN_URL: string;
  /** This API's own public address (Razorpay webhooks are sent here). */
  API_URL?: string;
  EMAIL_FROM: string;
  GATEWAY_HOLD_MINUTES: string;
  SECRETS_KEY?: string;
  RESEND_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DEV_ADMIN_EMAIL?: string;
  /** The first person to sign up with this email becomes the owner without approval. */
  OWNER_EMAIL?: string;
  /** Temporary fixed sign-in code until Resend is set up (admin only outside development). */
  FIXED_OTP_CODE?: string;
  /** Tests only: lets requests act as the dev owner (or X-Dev-User) without a session. Never set in a deployment. */
  DEV_AUTH_BYPASS?: string;
  /** Razorpay keys as Worker secrets (take priority over keys saved in Admin → Settings). */
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  /** Workers Rate Limiting binding (wrangler.jsonc "ratelimits"): 60 requests a minute per key. */
  EDGE_LIMIT?: RateLimit;
}

export interface Customer { id: string; email: string; name: string; phone: string }

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  permissions: Set<Permission>;
}

export type AppEnv = { Bindings: Env; Variables: { user: AdminUser; sessionId: string | null; customer: Customer } };
