import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import type { MediaRef } from '../lib/image.ts';
import { PhotoUpload, type Slot } from './PhotoUpload.tsx';
import { Sheet, Skeleton } from './ui.tsx';

export function MediaPicker({ slot, onPick, onClose }: { slot: Slot; onPick: (m: MediaRef) => void; onClose: () => void }) {
  const q = useQuery({ queryKey: ['media', 1], queryFn: () => get<{ items: MediaRef[] }>('/admin/media?page=1') });
  return (
    <Sheet title="Choose a photo" onClose={onClose}>
      <div className="photo-grid">
        <PhotoUpload slot={slot} multiple={false} label="Upload new" onUploaded={(m) => { onPick(m); onClose(); }} />
        {q.isPending ? <Skeleton n={2} h={140} /> : q.data?.items.map((m) => (
          <button key={m.id} className="photo" onClick={() => { onPick(m); onClose(); }} aria-label={m.alt || 'Photo'}>
            <img src={m.src['480']} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>Photos are shown in the shape of this slot on the website: {slot.label}.</p>
    </Sheet>
  );
}
