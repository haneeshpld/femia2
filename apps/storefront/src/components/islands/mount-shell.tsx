import { createRoot } from 'react-dom/client';
import Shell from './Shell.tsx';
import type { TrialStore } from './TrialSheet.tsx';

export function mount(el: HTMLElement, props: { freeShippingThreshold: number; sizeGuide: string; store: TrialStore; onReady: () => void }) {
  createRoot(el).render(<Shell {...props} />);
}
