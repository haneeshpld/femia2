import en from './en.json' with { type: 'json' };

export type MessageKey = keyof typeof en;
export type Locale = 'en';
const catalogs: Record<Locale, Record<string, string>> = { en };

/** t('common.off', { pct: 28 }) → "28% off". Missing keys fall back to English, then to the key itself. */
export function createT(locale: Locale = 'en') {
  const dict = catalogs[locale] ?? en;
  return function t(key: MessageKey, vars?: Record<string, string | number>): string {
    let s = dict[key] ?? (en as Record<string, string>)[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
export const t = createT('en');
