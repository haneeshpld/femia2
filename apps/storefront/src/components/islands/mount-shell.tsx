import { createRoot } from 'react-dom/client';
import Shell from './Shell.tsx';

export function mount(el: HTMLElement, props: { freeShippingThreshold: number; sizeGuide: string; onReady: () => void }) {
  createRoot(el).render(<Shell {...props} />);
}
