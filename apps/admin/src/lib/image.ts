import { api } from './api.ts';

export const SIZES = [480, 960, 1600] as const;
export interface Crop { x: number; y: number; w: number; h: number }
export interface MediaRef { id: string; alt: string; width: number; height: number; src: Record<string, string>; placeholder?: string }

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error("This file isn't a photo we can read. Try a JPG, PNG, HEIC from the camera roll or WebP."); }
}

let canvasWebp: boolean | undefined;
async function supportsCanvasWebp() {
  if (canvasWebp !== undefined) return canvasWebp;
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.8));
  return (canvasWebp = b?.type === 'image/webp');
}

async function encodeWebp(canvas: HTMLCanvasElement, quality = 0.82): Promise<Blob> {
  if (await supportsCanvasWebp()) {
    const b = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
    if (b) return b;
  }
  // Safari can't encode WebP from canvas: use the WASM encoder (loaded only when needed).
  const { encode } = await import('@jsquash/webp');
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  const buf = await encode(data, { quality: Math.round(quality * 100) });
  return new Blob([buf], { type: 'image/webp' });
}

/** Render the crop at 480/960/1600 px wide. Returns blobs + a dominant-colour placeholder. */
export async function renderCrop(bmp: ImageBitmap, crop: Crop, aspect: number) {
  const out: Record<number, Blob> = {};
  for (const w of SIZES) {
    const h = Math.round(w / aspect);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { alpha: false })!;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ECD5C7'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
    out[w] = await encodeWebp(c, w === 1600 ? 0.8 : 0.82);
  }
  const p = document.createElement('canvas'); p.width = p.height = 1;
  const pctx = p.getContext('2d')!; pctx.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, 1, 1);
  const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
  const placeholder = '#' + [r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('');
  return { blobs: out, width: 1600, height: Math.round(1600 / aspect), placeholder };
}

export async function uploadRendered(r: Awaited<ReturnType<typeof renderCrop>>, alt: string): Promise<MediaRef> {
  const fd = new FormData();
  for (const w of SIZES) fd.append(`w${w}`, new File([r.blobs[w]!], `${w}.webp`, { type: 'image/webp' }));
  fd.append('width', String(r.width)); fd.append('height', String(r.height));
  fd.append('alt', alt); fd.append('placeholder', r.placeholder);
  return api<MediaRef>('/admin/media', { method: 'POST', body: fd });
}

/** Largest centred crop of the given aspect. */
export function coverCrop(w: number, h: number, aspect: number): Crop {
  return w / h > aspect ? { x: (w - h * aspect) / 2, y: 0, w: h * aspect, h } : { x: 0, y: (h - w / aspect) / 2, w, h: w / aspect };
}
