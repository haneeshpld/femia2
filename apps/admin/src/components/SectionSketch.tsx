import type { ReactElement } from 'react';

/**
 * A tiny drawing of each home page section, so the owner recognises it at a glance in the section list
 * and when adding one. Drawn in the shop's colours: blush page, rosewood, sand photos, a gold thread.
 */
const INK = '#5A3A35', ROSE = '#8E4A43', SAND = '#E2C7BC', PHOTO = '#CFA99B', GOLD = '#C8A574', LINE = '#D9C3BB';

export function SectionSketch({ type }: { type: string }) {
  return (
    <svg className="sketch" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
      <rect width="64" height="40" rx="4" fill="#FBF3EF" />
      {SKETCH[type] ?? <><rect x="10" y="12" width="44" height="3" rx="1.5" fill={INK} /><rect x="14" y="19" width="36" height="2" rx="1" fill={LINE} /><rect x="18" y="24" width="28" height="2" rx="1" fill={LINE} /></>}
    </svg>
  );
}

const SKETCH: Record<string, ReactElement> = {
  hero: <>
    <rect x="5" y="11" width="20" height="3.2" rx="1.6" fill={INK} /><rect x="5" y="16.5" width="15" height="3.2" rx="1.6" fill={ROSE} />
    <rect x="5" y="23" width="18" height="1.6" rx=".8" fill={LINE} /><rect x="5" y="28" width="10" height="4" rx="2" fill={ROSE} />
    <rect x="29" y="6" width="15" height="28" rx="1.5" fill={PHOTO} /><rect x="46" y="6" width="4.5" height="28" rx="1" fill="#B97F7A" />
    <rect x="52" y="6" width="4.5" height="28" rx="1" fill={SAND} /><rect x="58" y="6" width="6" height="28" rx="1" fill="#A9B07D" />
  </>,
  categories: <>
    <rect x="22" y="5" width="20" height="2.4" rx="1.2" fill={INK} />
    <path d="M3 13Q32 25 61 13" stroke={GOLD} strokeWidth=".8" fill="none" />
    {[[10, 16], [24, 20], [40, 20], [54, 16]].map(([x, y]) => <g key={x}><rect x={x! - 5} y={y} width="10" height="14" rx="1" fill="#fff" stroke={LINE} strokeWidth=".5" /><rect x={x! - 3.6} y={y! + 3} width="7.2" height="8" rx=".6" fill={PHOTO} /><circle cx={x} cy={y! + 1.5} r=".8" fill={GOLD} /></g>)}
  </>,
  products: <>
    <rect x="5" y="6" width="18" height="2.6" rx="1.3" fill={INK} /><rect x="48" y="6.4" width="11" height="1.8" rx=".9" fill={ROSE} />
    {[5, 19, 33, 47].map((x) => <g key={x}><rect x={x} y="12" width="12" height="16" rx="1" fill={PHOTO} /><rect x={x} y="30" width="9" height="1.6" rx=".8" fill={INK} /><rect x={x} y="33" width="6" height="1.6" rx=".8" fill={LINE} /></g>)}
  </>,
  occasions: <>
    <rect x="20" y="5" width="24" height="2.6" rx="1.3" fill={INK} />
    {[5, 24, 43].map((x) => <g key={x}><rect x={x} y="11" width="16" height="22" rx="1.2" fill={PHOTO} /><rect x={x + 2} y="28" width="10" height="2" rx="1" fill="#fff" /></g>)}
  </>,
  boutique: <>
    <path d="M6 34V16a11 11 0 0 1 22 0v18Z" fill={PHOTO} />
    <rect x="34" y="11" width="22" height="3" rx="1.5" fill={INK} /><rect x="34" y="17" width="24" height="1.6" rx=".8" fill={LINE} /><rect x="34" y="20.5" width="20" height="1.6" rx=".8" fill={LINE} />
    <rect x="34" y="27" width="11" height="4" rx="2" fill={ROSE} /><rect x="47" y="28" width="9" height="2" rx="1" fill={GOLD} />
  </>,
  instagram: <>
    <rect x="24" y="17" width="16" height="2.6" rx="1.3" fill={INK} /><rect x="27" y="22" width="10" height="1.6" rx=".8" fill={ROSE} />
    {[[4, 5], [12, 20], [44, 6], [52, 21]].map(([x, y]) => <g key={`${x}-${y}`}><rect x={x} y={y} width="10" height="13" rx=".6" fill="#fff" stroke={LINE} strokeWidth=".5" /><rect x={x! + 1} y={y! + 1} width="8" height="9" fill={PHOTO} /></g>)}
  </>,
  banner: <>
    <rect x="26" y="5" width="38" height="30" fill={PHOTO} /><path d="M26 5V35" stroke={GOLD} strokeWidth=".6" strokeDasharray="1.4 1" />
    <rect x="5" y="12" width="17" height="3" rx="1.5" fill={INK} /><rect x="5" y="18" width="14" height="1.6" rx=".8" fill={LINE} /><rect x="5" y="25" width="10" height="4" rx="2" fill={ROSE} />
  </>,
  story: <>
    <rect x="30" y="6" width="4" height="4" transform="rotate(45 32 8)" fill={GOLD} />
    <rect x="16" y="14" width="32" height="3" rx="1.5" fill={INK} /><rect x="12" y="21" width="40" height="1.6" rx=".8" fill={LINE} /><rect x="16" y="24.5" width="32" height="1.6" rx=".8" fill={LINE} />
    <rect x="26" y="30" width="12" height="1.8" rx=".9" fill={ROSE} />
  </>,
};
