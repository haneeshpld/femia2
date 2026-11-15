import { activeFestive, Settings, type PublicSettings } from '@femia/contracts';
import { all } from '../lib/db.ts';

type SettingsKey = keyof Settings;

export async function getSettings(db: D1Database): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const raw: Record<string, unknown> = {};
  for (const r of rows) raw[r.key] = JSON.parse(r.value);
  return Settings.parse(raw);
}

export function putSettingStatement(db: D1Database, key: SettingsKey, value: unknown, actor: string) {
  return db
    .prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(key, JSON.stringify(value), actor, new Date().toISOString());
}

export function toPublicSettings(s: Settings): PublicSettings {
  return {
    store: s.store,
    shipping: s.shipping,
    payments: {
      // UPI is offered through Razorpay (Google Pay, PhonePe, Paytm…), so it follows online payments.
      upi: s.payments.gateway.enabled,
      upiVpa: '',
      upiPayee: s.payments.upi.payeeName || s.store.name,
      gateway: s.payments.gateway.enabled,
      gatewayProvider: s.payments.gateway.provider,
      cod: s.shipping.cod.enabled,
      codMax: s.shipping.cod.maxOrderValue,
      whatsapp: s.payments.whatsapp.enabled && !!s.store.whatsapp,
    },
    festive: activeFestive(s.festive),
  };
}
