import { useEffect, useRef, useState } from 'react';
import { coverCrop, type Crop } from '../lib/image.ts';

/**
 * Drag to move, pinch / slider to zoom. The frame is the slot's exact shape (rect, arch or circle),
 * so what the owner sees is what the storefront shows.
 */
export function Cropper({ bitmap, aspect, mask = 'rect', onChange }: { bitmap: ImageBitmap; aspect: number; mask?: 'rect' | 'arch' | 'circle'; onChange: (c: Crop) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const W = 720, H = Math.round(W / aspect); // internal resolution (CSS scales it)
  const base = Math.max(W / bitmap.width, H / bitmap.height); // scale at which the photo just covers the frame
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState(() => { const c = coverCrop(bitmap.width, bitmap.height, aspect); return { x: -c.x * base, y: -c.y * base }; });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);

  const clamp = (o: { x: number; y: number }, z: number) => {
    const s = base * z;
    return { x: Math.min(0, Math.max(W - bitmap.width * s, o.x)), y: Math.min(0, Math.max(H - bitmap.height * s, o.y)) };
  };

  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!;
    const s = base * zoom;
    ctx.fillStyle = '#1b1210'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(bitmap, off.x, off.y, bitmap.width * s, bitmap.height * s);
    // shade outside the slot shape
    ctx.save();
    ctx.fillStyle = 'rgba(20, 10, 8, .55)';
    ctx.beginPath(); ctx.rect(0, 0, W, H);
    if (mask === 'arch') { ctx.moveTo(0, H); ctx.lineTo(0, W / 2); ctx.arc(W / 2, W / 2, W / 2, Math.PI, 0); ctx.lineTo(W, H); ctx.closePath(); }
    else if (mask === 'circle') { ctx.moveTo(W, H / 2); ctx.arc(W / 2, H / 2, Math.min(W, H) / 2, 0, Math.PI * 2); }
    ctx.fill('evenodd');
    ctx.restore();
    // rule of thirds
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) { ctx.beginPath(); ctx.moveTo(W * f, 0); ctx.lineTo(W * f, H); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); ctx.stroke(); }
    onChange({ x: -off.x / s, y: -off.y / s, w: W / s, h: H / s });
  }, [off, zoom, bitmap]);

  const toCanvas = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const setZoomAt = (z: number, at = { x: W / 2, y: H / 2 }) => {
    const nz = Math.min(4, Math.max(1, z));
    const k = nz / zoom;
    setOff((o) => clamp({ x: at.x - (at.x - o.x) * k, y: at.y - (at.y - o.y) * k }, nz));
    setZoom(nz);
  };

  return (
    <div className="stack">
      <div className="crop">
        <canvas
          ref={canvas} width={W} height={H}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, toCanvas(e)); }}
          onPointerMove={(e) => {
            const prev = pointers.current.get(e.pointerId);
            if (!prev) return;
            const p = toCanvas(e);
            pointers.current.set(e.pointerId, p);
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
              if (!pinch.current) pinch.current = { d, z: zoom };
              else setZoomAt(pinch.current.z * (d / pinch.current.d), { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
              return;
            }
            setOff((o) => clamp({ x: o.x + p.x - prev.x, y: o.y + p.y - prev.y }, zoom));
          }}
          onPointerUp={(e) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; }}
          onPointerCancel={(e) => { pointers.current.delete(e.pointerId); pinch.current = null; }}
          onWheel={(e) => setZoomAt(zoom * (e.deltaY < 0 ? 1.08 : 0.93))}
          aria-label="Drag to position the photo"
        />
      </div>
      <label className="field"><span>Zoom</span>
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAt(Number(e.target.value))} style={{ accentColor: 'var(--c-maroon)' }} />
      </label>
    </div>
  );
}
