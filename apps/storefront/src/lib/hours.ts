/** Boutique open/closed status in IST from structured hours (Mon-first, 7 entries). */
export interface DayHours { open: string; close: string; closed?: boolean }

const fmt = (hm: string) => {
  const [h = 0, m = 0] = hm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
};

export function boutiqueStatus(hours: DayHours[] | null | undefined, now = new Date()): { open: boolean; text: string } | null {
  if (!hours || hours.length !== 7) return null;
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60_000);
  const dayIdx = (ist.getDay() + 6) % 7; // Monday = 0
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const toMin = (hm: string) => { const [h = 0, m = 0] = hm.split(':').map(Number); return h * 60 + m; };
  const today = hours[dayIdx]!;
  if (!today.closed && mins >= toMin(today.open) && mins < toMin(today.close)) return { open: true, text: `Open now · until ${fmt(today.close)}` };
  if (!today.closed && mins < toMin(today.open)) return { open: false, text: `Opens today at ${fmt(today.open)}` };
  for (let i = 1; i <= 7; i++) {
    const d = hours[(dayIdx + i) % 7]!;
    if (!d.closed) return { open: false, text: `Closed now · opens ${i === 1 ? 'tomorrow' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(dayIdx + i) % 7]} at ${fmt(d.open)}` };
  }
  return { open: false, text: 'Closed' };
}
