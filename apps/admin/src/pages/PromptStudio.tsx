import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { get, put } from '../lib/api.ts';
import type { MediaRef } from '../lib/image.ts';
import { loadBitmap } from '../lib/image.ts';
import { Icon } from '../components/Icon.tsx';
import { PhotoUpload, type Slot } from '../components/PhotoUpload.tsx';
import { Field, useToast } from '../components/ui.tsx';

/** Femia brand profile, pre-filled by us (editor arrives with Prompt Studio full in 1.2). */
const BRAND = {
  palette: 'warm cream and blush backgrounds (#FBF1E9, #F7E1D8) with deep maroon (#7A1628) and muted antique-gold accents',
  model: 'a South Indian woman in her late twenties with warm medium-brown skin, dark hair in a low bun or soft loose waves, small gold jhumka earrings, natural makeup and a genuine, soft smile',
  lighting: 'soft golden-hour sunlight through tall arched windows, gentle shadows of leaves on a plaster wall',
  camera: 'shot like an editorial fashion photograph on a 50mm lens, shallow depth of field, true-to-life colour, high detail in the fabric weave and embroidery',
  avoid: 'no text, no logos, no watermarks, no extra people, no distorted hands, no changes to the garment design',
};

type SlotKey = 'product-main' | 'product-alt' | 'product-detail' | 'hero' | 'category' | 'occasion' | 'boutique' | 'instagram';
const SLOTS: Record<SlotKey, { label: string; manifestSlot: string; needsProduct: boolean; subject: string; ratio: string }> = {
  'product-main': { label: 'Product · main photo', manifestSlot: 'product', needsProduct: true, subject: 'a clean full-length catalogue photo of the model wearing the garment, garment fully visible and centred', ratio: '3:4 portrait' },
  'product-alt': { label: 'Product · alternate angle', manifestSlot: 'product', needsProduct: true, subject: 'the model wearing the garment from a three-quarter or back angle so the cut and drape are clear', ratio: '3:4 portrait' },
  'product-detail': { label: 'Product · detail close-up', manifestSlot: 'product', needsProduct: true, subject: 'a close-up of the garment detail (neckline, embroidery or print), fabric texture sharp and in focus', ratio: '3:4 portrait' },
  hero: { label: 'Homepage hero', manifestSlot: 'hero', needsProduct: false, subject: 'a dreamy still-life: a long sheer maroon silk ribbon with gold floral embroidery drifting through the air past an arched window, plenty of empty cream space on the left for headline text', ratio: '9:10' },
  category: { label: 'Category tile (arch)', manifestSlot: 'arch', needsProduct: true, subject: 'the model from the knees up wearing the garment, framed so it reads well inside an arched window shape', ratio: '10:13 portrait' },
  occasion: { label: 'Occasion card', manifestSlot: 'occasion', needsProduct: true, subject: 'a lifestyle moment of the model wearing the garment, with space at the bottom-left for a title', ratio: '6:5 landscape' },
  boutique: { label: 'Visit our boutique', manifestSlot: 'boutique', needsProduct: false, subject: 'an inviting interior of a small boutique with arched doorways, wooden rails of colourful kurtas, rattan pendant lights and a round table with lilies', ratio: '7:5 landscape' },
  instagram: { label: 'Instagram post', manifestSlot: 'social', needsProduct: true, subject: 'a candid, natural-looking moment of the model wearing the garment outdoors in a garden or courtyard', ratio: '1:1 square' },
};
const POSES = ['Standing relaxed, hands at sides', 'Hand on hip, slight turn', 'Walking towards camera', 'Looking over shoulder', 'Seated on a cane chair', 'Adjusting dupatta'];
const FRAMING = ['Full length', 'Knees up', 'Waist up', 'Close-up of detail'];
const SETTINGS = ['Cream studio wall with arched window light', 'Kerala courtyard with plants', 'Boutique interior', 'Garden with soft greenery', 'Plain blush backdrop'];
const MOODS = ['Calm & elegant', 'Joyful & festive', 'Confident workday', 'Soft & romantic'];

export default function PromptStudio() {
  const toast = useToast();
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => get<{ imageSlots: Slot[] }>('/admin/manifest'), staleTime: Infinity });
  const products = useQuery({ queryKey: ['products', '', ''], queryFn: () => get<{ items: { id: string; title: string; category: string; thumb: string | null }[] }>('/admin/products?pageSize=100') });
  const [slot, setSlot] = useState<SlotKey>('product-main');
  const [productId, setProductId] = useState('');
  const [colour, setColour] = useState('');
  const [pose, setPose] = useState(POSES[0]!);
  const [framing, setFraming] = useState(FRAMING[0]!);
  const [setting, setSetting] = useState(SETTINGS[0]!);
  const [mood, setMood] = useState(MOODS[0]!);
  const [ref, setRef] = useState(true);
  const [tool, setTool] = useState<'chatgpt' | 'gemini'>('chatgpt');
  const [check, setCheck] = useState<{ ok: boolean; msg: string } | null>(null);
  const [uploaded, setUploaded] = useState<MediaRef | null>(null);

  const product = useQuery({ queryKey: ['product', productId], queryFn: () => get(`/admin/products/${productId}`), enabled: !!productId });
  const def = SLOTS[slot];
  const mslot = manifest.data?.imageSlots.find((s) => s.id === def.manifestSlot);
  const p = product.data;
  const colourLabel = p?.option2Values.find((o: { value: string }) => o.value === colour)?.label ?? p?.option2Values[0]?.label;

  const prompt = useMemo(() => {
    const garment = p ? `a ${colourLabel ? colourLabel.toLowerCase() + ' ' : ''}${p.fabric ? p.fabric.toLowerCase() + ' ' : ''}${p.title.toLowerCase()}${p.description ? ` (${p.description.split('.')[0]})` : ''}` : 'the garment';
    const parts = [
      `Create a photorealistic image for the Femia boutique website: ${def.subject.replace('the garment', garment)}.`,
      def.needsProduct ? `Model: ${BRAND.model}. Pose: ${pose.toLowerCase()}. Framing: ${framing.toLowerCase()}.` : '',
      `Setting: ${setting.toLowerCase()}. Mood: ${mood.toLowerCase()}.`,
      `Lighting: ${BRAND.lighting}. Colour palette: ${BRAND.palette}.`,
      `Style: ${BRAND.camera}.`,
      def.needsProduct && ref ? 'I have attached a photo of the real garment. Use it as an exact reference: keep its colour, print, embroidery placement, neckline, sleeve length and fabric exactly as shown. Do not invent or change any design details.' : '',
      `Aspect ratio ${def.ratio}${mslot ? `, at least ${mslot.minWidth}px wide` : ''}. ${BRAND.avoid}.`,
    ].filter(Boolean);
    return tool === 'gemini' ? `Generate an image. ${parts.join(' ')}` : parts.join('\n\n');
  }, [p, colourLabel, def, pose, framing, setting, mood, ref, tool, mslot]);

  const copy = async () => { try { await navigator.clipboard.writeText(prompt); toast({ text: `Copied. Paste it into ${tool === 'chatgpt' ? 'ChatGPT' : 'Gemini'}.` }); } catch { toast({ text: 'Copy failed: select the text and copy it manually.', bad: true }); } };

  /** Auto-check the generated file before cropping: ratio and resolution against the slot. */
  async function inspect(file: File) {
    if (!mslot) return;
    try {
      const b = await loadBitmap(file);
      const r = b.width / b.height;
      const off = Math.abs(r - mslot.aspect) / mslot.aspect;
      const small = b.width < mslot.minWidth * 0.75;
      setCheck({ ok: off < 0.04 && !small, msg: `${b.width}×${b.height}px. ${off < 0.04 ? 'Ratio matches.' : 'Ratio differs, so you will crop it next.'} ${small ? `Smaller than the recommended ${mslot.minWidth}px: ask for a larger image if you can.` : 'Size is good.'}` });
      b.close();
    } catch { setCheck({ ok: false, msg: "Couldn't read that file." }); }
  }

  const attach = useMutation({
    mutationFn: async (m: MediaRef) => {
      if (def.manifestSlot === 'product' && p) {
        const role = slot === 'product-main' ? 'main' : slot === 'product-alt' ? 'alt' : 'detail';
        const images = [...p.images.map((i: any) => ({ mediaId: i.mediaId, role: i.role, option2: i.option2 })), { mediaId: m.id, role, option2: colour || p.option2Values[0]?.value || null }];
        await put(`/admin/products/${p.id}`, { ...p, images, variants: p.variants.map((v: any) => ({ id: v.id, option1: v.option1, option2: v.option2, sku: v.sku, price: v.price, onHand: 0, lowStockThreshold: v.lowStockThreshold, active: v.active })) });
        return `Added to ${p.title}`;
      }
      const draft = await get<{ data: Record<string, any> }>('/admin/content/draft');
      const d = structuredClone(draft.data);
      if (slot === 'hero') d.hero = { ...d.hero, image: m.id };
      else if (slot === 'boutique') d.boutique = { ...d.boutique, image: m.id };
      else if (slot === 'instagram') d.styled = { ...d.styled, images: [...(d.styled?.images ?? []), { image: m.id, link: '' }] };
      else if (slot === 'category' && p) d.categories = { ...d.categories, items: (d.categories?.items ?? []).map((i: any) => (i.category === p.categoryId ? { ...i, image: m.id } : i)) };
      else return 'Uploaded to Photos. Choose it from the Homepage editor.';
      await put('/admin/content/draft', { data: d, note: `Prompt Studio: ${def.label}` });
      return 'Added to the homepage draft. Preview and publish it from Homepage.';
    },
    onSuccess: (msg) => toast({ text: msg }),
    onError: (e) => toast({ text: (e as Error).message, bad: true }),
  });

  return (
    <>
      <div className="page-head"><div><h1>Prompt Studio</h1><p className="muted">Make on-brand styled photos with ChatGPT or Gemini, then bring them straight into the store.</p></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <Field label="1 · What is this photo for?">
            <select className="select" value={slot} onChange={(e) => { setSlot(e.target.value as SlotKey); setUploaded(null); setCheck(null); }}>
              {Object.entries(SLOTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          {def.needsProduct && (
            <div className="grid2">
              <Field label="2 · Product">
                <select className="select" value={productId} onChange={(e) => { setProductId(e.target.value); setColour(''); }}>
                  <option value="">Choose…</option>
                  {products.data?.items.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </select>
              </Field>
              {p?.option2Values.length > 0 && <Field label="Colour"><select className="select" value={colour} onChange={(e) => setColour(e.target.value)}>{p.option2Values.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>}
            </div>
          )}
          <div className="grid2">
            {def.needsProduct && <Field label="Pose"><select className="select" value={pose} onChange={(e) => setPose(e.target.value)}>{POSES.map((x) => <option key={x}>{x}</option>)}</select></Field>}
            {def.needsProduct && <Field label="Framing"><select className="select" value={framing} onChange={(e) => setFraming(e.target.value)}>{FRAMING.map((x) => <option key={x}>{x}</option>)}</select></Field>}
            <Field label="Setting"><select className="select" value={setting} onChange={(e) => setSetting(e.target.value)}>{SETTINGS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Mood"><select className="select" value={mood} onChange={(e) => setMood(e.target.value)}>{MOODS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          {def.needsProduct && <label className="check"><input type="checkbox" checked={ref} onChange={(e) => setRef(e.target.checked)} /> I'll attach a real photo of the garment (recommended: keeps the design accurate)</label>}
        </div>

        <div className="stack">
          <div className="card stack">
            <div className="row"><h2 style={{ flex: 1 }}>3 · Your prompt</h2><div className="seg"><button className={tool === 'chatgpt' ? 'on' : ''} onClick={() => setTool('chatgpt')}>ChatGPT</button><button className={tool === 'gemini' ? 'on' : ''} onClick={() => setTool('gemini')}>Gemini</button></div></div>
            <textarea className="textarea" readOnly rows={12} value={prompt} style={{ fontSize: 14 }} onFocus={(e) => e.target.select()} />
            <button className="btn btn--lg" onClick={copy} disabled={def.needsProduct && !p}><Icon name="copy" /> Copy prompt</button>
            {def.needsProduct && !p && <p className="muted small">Choose a product first.</p>}
            {def.needsProduct && ref && p?.images[0] && <p className="small">Attach this reference: <a href={p.images[0].media.src['1600']} target="_blank" rel="noopener" download>download the current product photo</a>, or use your own phone photo of the garment.</p>}
          </div>
          <div className="card stack">
            <h2>4 · Bring the result back</h2>
            <p className="muted small">Save the image from {tool === 'chatgpt' ? 'ChatGPT' : 'Gemini'} to your phone, then upload it here. We check the size, you crop it to the slot, and it's attached.</p>
            <label className="btn btn--quiet" style={{ cursor: 'pointer' }}><Icon name="search" /> Check a file first
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void inspect(f); e.target.value = ''; }} /></label>
            {check && <div className={`notice ${check.ok ? 'notice--ok' : ''}`}><Icon name={check.ok ? 'check' : 'info'} /> {check.msg}</div>}
            {mslot && <PhotoUpload slot={mslot} multiple={false} compact label="Upload & crop" defaultAlt={p ? `${colourLabel ?? ''} ${p.title}`.trim() : def.label} onUploaded={(m) => { setUploaded(m); attach.mutate(m); }} />}
            {uploaded && <div className="row"><img src={uploaded.src['480']} alt="" style={{ width: 96, borderRadius: 8 }} /><span className="small">Saved to Photos. {def.manifestSlot === 'product' ? <Link to={`/products/${productId}`}>Open product</Link> : <Link to="/content">Open Homepage editor</Link>}</span></div>}
          </div>
        </div>
      </div>
    </>
  );
}
