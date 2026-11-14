import { z } from 'zod';
import { Paise } from './common.ts';

export const StateCode = z.enum(['KL']);
export type StateCode = z.infer<typeof StateCode>;

/** Pincode ranges per state. Interstate shipping in 1.1 = add states here + enable in settings. */
export const STATE_PINCODES: Record<StateCode, { name: string; ranges: [number, number][]; exclude: [number, number][] }> = {
  KL: { name: 'Kerala', ranges: [[670000, 695999]], exclude: [[682551, 682559]] /* Lakshadweep */ },
};

export function stateForPincode(pincode: string): StateCode | null {
  const n = Number(pincode);
  if (!/^[1-9]\d{5}$/.test(pincode)) return null;
  for (const [code, rule] of Object.entries(STATE_PINCODES) as [StateCode, (typeof STATE_PINCODES)[StateCode]][]) {
    const inRange = rule.ranges.some(([a, b]) => n >= a && n <= b);
    const excluded = rule.exclude.some(([a, b]) => n >= a && n <= b);
    if (inRange && !excluded) return code;
  }
  return null;
}

export function canShipTo(pincode: string, shipToStates: readonly StateCode[]): boolean {
  const s = stateForPincode(pincode);
  return s !== null && shipToStates.includes(s);
}

export const ShippingSettings = z.object({
  freeShippingThreshold: Paise.default(99900),
  flatFee: Paise.default(7900),
  shipToStates: z.array(StateCode).min(1).default(['KL']),
  cod: z.object({ enabled: z.boolean().default(true), maxOrderValue: Paise.nullable().default(500000) }).prefault({}),
});
export type ShippingSettings = z.infer<typeof ShippingSettings>;
