import { ICONS, type IconName } from '../../lib/icons.ts';

export function Icon({ name, size = 24, className, filled }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}
