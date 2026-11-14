/**
 * Femia design tokens: single source of truth.
 * Sampled from the approved mockups (design/reference). `npm run build -w @femia/tokens` regenerates tokens.css.
 */
export const color = {
  maroon: '#7A1628',      // primary: buttons, announcement bar, links
  maroon600: '#8E2236',   // hover
  maroon800: '#641720',   // footer
  maroon900: '#4E0F18',   // footer bottom strip
  rose: '#AE6271',        // soft accent (badges, eyebrow rules)
  gold: '#B8862F',        // crown / emblem accent
  goldLight: '#E4C27A',
  ink: '#3A1F14',         // headings
  text: '#4A3329',        // body copy
  muted: '#6E5A50',       // secondary copy (AA on cream)
  cream: '#FBF1E9',       // page background
  surface: '#FFFDFA',     // cards
  blush: '#F7E1D8',       // banded sections (boutique)
  sand: '#ECD5C7',        // image placeholders, hairlines on blush
  line: '#E9D9CF',        // dividers, input borders
  success: '#2F6B3F',
  warning: '#9A6A12',
  danger: '#B3261E',
  white: '#FFFFFF',
} as const;

export const font = {
  display: "'Cormorant Garamond Variable', 'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  body: "'DM Sans Variable', 'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

/** Fluid type scale (clamp between 360px and 1440px viewports). */
export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  md: '1.125rem',
  lg: 'clamp(1.25rem, 1.13rem + 0.5vw, 1.5rem)',
  xl: 'clamp(1.75rem, 1.5rem + 1.1vw, 2.5rem)',
  '2xl': 'clamp(2.25rem, 1.8rem + 2vw, 3.5rem)',
  '3xl': 'clamp(2.75rem, 2rem + 3.4vw, 4.75rem)',
} as const;

/** Spacing scale: the only spacings allowed in layouts (4px base). */
export const space = {
  0: '0', 1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem', 5: '1.25rem', 6: '1.5rem',
  8: '2rem', 10: '2.5rem', 12: '3rem', 16: '4rem', 20: '5rem', 24: '6rem',
} as const;

export const radius = { sm: '6px', md: '10px', lg: '16px', pill: '999px', arch: '999px 999px 0 0' } as const;

export const shadow = {
  card: '0 1px 2px rgba(58,31,20,.05), 0 6px 20px -8px rgba(58,31,20,.14)',
  raised: '0 12px 40px -12px rgba(58,31,20,.28)',
} as const;

export const layout = { maxWidth: '1280px', gutter: 'clamp(1rem, 0.6rem + 1.8vw, 2.5rem)', header: '72px', headerMobile: '60px' } as const;

export const motion = {
  fast: '160ms', base: '260ms', slow: '600ms',
  ease: 'cubic-bezier(.2,.7,.2,1)', easeOut: 'cubic-bezier(.16,1,.3,1)',
} as const;

export const breakpoints = { sm: 390, md: 768, lg: 1024, xl: 1280, xxl: 1440 } as const;

export const tokens = { color, font, fontSize, space, radius, shadow, layout, motion, breakpoints };
export type Tokens = typeof tokens;

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

export function toCssVariables(): string {
  const lines: string[] = [];
  const group = (prefix: string, obj: Record<string, string>) => {
    for (const [k, v] of Object.entries(obj)) lines.push(`  --${prefix}-${kebab(String(k))}: ${v};`);
  };
  group('c', color);
  group('font', font);
  group('fs', fontSize);
  group('sp', Object.fromEntries(Object.entries(space).map(([k, v]) => [k, v])));
  group('r', radius);
  group('shadow', shadow);
  group('layout', layout);
  group('motion', motion);
  return `/* Generated from packages/tokens/src/tokens.ts. Do not edit by hand. */\n:root {\n${lines.join('\n')}\n}\n`;
}
