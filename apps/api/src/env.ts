import type { Permission } from '@femia/contracts';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  PUBLIC_SITE_URL: string;
  ADMIN_URL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  EMAIL_FROM: string;
  GATEWAY_HOLD_MINUTES: string;
  SECRETS_KEY?: string;
  RESEND_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DEV_ADMIN_EMAIL?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  permissions: Set<Permission>;
}

export type AppEnv = { Bindings: Env; Variables: { user: AdminUser } };
