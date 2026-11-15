import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api.ts';
import { ratioLabel, type MediaRef } from '../lib/image.ts';
import { PhotoUpload, SlotSize, type Slot } from './PhotoUpload.tsx';
import { Sheet, Skeleton } from './ui.tsx';

export function MediaPicker({ slot, onPick, onClose }: { slot: Slot; onPick: (m: MediaRef) => void; onClose: () => void }) {
  const q = useQuery({ queryKey: ['media', 1], queryFn: () => get<{ items: MediaRef[] }>('/admin/media?page=1') });
  return (
    <Sheet title="Choose a photo" onClose={onClose}>
      <SlotSize slot={slot} />
      <div className="photo-grid" style={{ marginTop: 'var(--sp-4)' }}>
        <PhotoUpload slot={slot} multiple={false} label="Upload new" onUploaded={(m) => { onPick(m); onClose(); }} />
        {q.isPending ? <Skeleton n={2} h={140} /> : q.data?.items.map((m) => (
          <button key={m.id} className="photo" onClick={() => { onPick(m); onClose(); }} aria-label={m.alt || 'Photo'}>
            <img src={m.src['480']} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>A photo from the library is trimmed to this shape ({ratioLabel(slot.aspect)}). Uploading a new one here lets you choose the crop.</p>
    </Sheet>
  );
}
