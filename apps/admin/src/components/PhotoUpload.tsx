import { useRef, useState } from 'react';
import { Cropper } from './Cropper.tsx';
import { Icon } from './Icon.tsx';
import { Field, Sheet, useToast } from './ui.tsx';
import { loadBitmap, ratioLabel, recommendedSize, renderCrop, uploadRendered, type Crop, type MediaRef } from '../lib/image.ts';

export interface Slot { id: string; label: string; aspect: number; minWidth: number; mask: 'rect' | 'arch' | 'circle'; recommended?: { width: number; height: number }; help?: string; hd?: boolean }
export const PRODUCT_SLOT: Slot = { id: 'product', label: 'Product photo (3:4)', aspect: 0.75, minWidth: 1200, mask: 'rect' };

/** Pick → crop to the slot → compress in the browser → upload 3 sizes. Handles several files in a row. */
export function PhotoUpload({ slot, onUploaded, defaultAlt = '', label = 'Add photos', multiple = true, compact = false }: {
  slot: Slot; onUploaded: (m: MediaRef) => void; defaultAlt?: string; label?: string; multiple?: boolean; compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [alt, setAlt] = useState(defaultAlt);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function next(files: File[]) {
    setQueue(files);
    const f = files[0];
    if (!f) { setBmp(null); return; }
    try { setBmp(await loadBitmap(f)); setAlt(defaultAlt); }
    catch (e) { toast({ text: (e as Error).message, bad: true }); next(files.slice(1)); }
  }

  async function save() {
    if (!bmp || !crop) return;
    setBusy(true);
    try {
      const r = await renderCrop(bmp, crop, slot.aspect, slot.hd);
      const m = await uploadRendered(r, alt.trim());
      onUploaded(m);
      if (crop.w < recommendedSize(slot).width * 0.6) toast({ text: 'Uploaded. This photo is quite small, so it may look soft on large screens.' });
      bmp.close();
      await next(queue.slice(1));
    } catch (e) {
      toast({ text: (e as Error).message || 'Upload failed. Check your connection and try again.', bad: true });
    } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" className={compact ? 'btn btn--quiet' : 'photo-add'} onClick={() => input.current?.click()}>
        <Icon name="camera" size={compact ? 20 : 28} /> {label}
      </button>
      <input ref={input} type="file" accept="image/*" multiple={multiple} hidden onChange={(e) => { next([...(e.target.files ?? [])]); e.target.value = ''; }} />
      {bmp && (
        <Sheet title={`Crop photo${queue.length > 1 ? ` (1 of ${queue.length})` : ''}`} onClose={() => { bmp.close(); setBmp(null); setQueue([]); }}
          footer={<>
            {queue.length > 1 && <button className="btn btn--quiet" onClick={() => next(queue.slice(1))} disabled={busy}>Skip</button>}
            <span className="spacer" />
            <button className="btn btn--lg" onClick={save} disabled={busy}>{busy ? 'Uploading…' : 'Use photo'}</button>
          </>}>
          <div className="stack">
            <SlotSize slot={slot} crop={crop} />
            <p className="muted small">Drag to position, pinch or slide to zoom.</p>
            <Cropper bitmap={bmp} aspect={slot.aspect} mask={slot.mask} onChange={setCrop} />
            <Field label="Describe the photo (for screen readers & Google)" hint="e.g. Maroon embroidered cotton kurta, front view">
              <input className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
            </Field>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** What this slot wants (pixel size, shape, where it shows), and whether the chosen crop is big enough. */
export function SlotSize({ slot, crop }: { slot: Slot; crop?: Crop | null }) {
  const rec = recommendedSize(slot);
  const small = crop && crop.w < rec.width * 0.6;
  return (
    <div className="slot-size">
      <strong>{slot.label}</strong>
      <span>Best at <b>{rec.width} × {rec.height} px</b> · {ratioLabel(slot.aspect)} · JPG, PNG, HEIC or WebP</span>
      {slot.help && <span className="muted">{slot.help}</span>}
      {crop && <span className={small ? 'slot-size__warn' : 'muted'}>This crop: {Math.round(crop.w)} × {Math.round(crop.h)} px{small ? '. A little small, so it may look soft on big screens.' : ''}</span>}
    </div>
  );
}
