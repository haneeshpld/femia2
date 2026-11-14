export { formatINR, percentOff } from '@femia/contracts/money';

export const rupeesToPaise = (s: string | number) => Math.round(Number(String(s).replace(/[^\d.]/g, '')) * 100) || 0;
export const paiseToRupees = (p: number | null | undefined) => (p == null ? '' : String(p / 100));

const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
export function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'just now';
}
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '';

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment', new: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};
export const METHOD_LABEL: Record<string, string> = { upi: 'UPI', gateway: 'Online', cod: 'COD', whatsapp: 'WhatsApp' };
