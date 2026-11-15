import { z } from 'zod';

/**
 * site.manifest.json v1: the storefront's self-description.
 * Admin generates content forms from `sections`, crops uploads to `imageSlots`, and labels variants from `variantLabels`.
 * The 1.1 drag-and-drop builder reads the same file.
 */
export const FieldType = z.enum(['text', 'textarea', 'richtext', 'url', 'image', 'boolean', 'number', 'select', 'collection', 'category', 'list']);

const BaseField = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  label: z.string(),
  help: z.string().optional(),
  required: z.boolean().default(false),
  /** Show this field only when a sibling select field has one of these values (Admin hides it otherwise). */
  when: z.object({ field: z.string(), is: z.array(z.string()).min(1) }).optional(),
});

export type ManifestField =
  | (z.infer<typeof BaseField> & { type: 'text' | 'textarea' | 'richtext' | 'url'; maxLength?: number })
  | (z.infer<typeof BaseField> & { type: 'image'; slot: string })
  | (z.infer<typeof BaseField> & { type: 'boolean' | 'number' | 'collection' | 'category' })
  | (z.infer<typeof BaseField> & { type: 'select'; options: { value: string; label: string }[] })
  | (z.infer<typeof BaseField> & { type: 'list'; itemLabel: string; min?: number; max?: number; fields: ManifestField[] });

export const ManifestFieldSchema: z.ZodType<ManifestField> = z.lazy(() =>
  z.discriminatedUnion('type', [
    BaseField.extend({ type: z.enum(['text', 'textarea', 'richtext', 'url']), maxLength: z.number().int().optional() }),
    BaseField.extend({ type: z.literal('image'), slot: z.string() }),
    BaseField.extend({ type: z.enum(['boolean', 'number', 'collection', 'category']) }),
    BaseField.extend({ type: z.literal('select'), options: z.array(z.object({ value: z.string(), label: z.string() })) }),
    BaseField.extend({
      type: z.literal('list'), itemLabel: z.string(), min: z.number().int().optional(), max: z.number().int().optional(),
      fields: z.array(ManifestFieldSchema),
    }),
  ]),
) as z.ZodType<ManifestField>;

export const ImageSlot = z.object({
  id: z.string(),
  label: z.string(),
  /** width / height, e.g. 0.75 for 3:4 */
  aspect: z.number().positive(),
  minWidth: z.number().int().default(1200),
  /** shape hint for the cropper overlay */
  mask: z.enum(['rect', 'arch', 'circle']).default('rect'),
  /** Size to ask for in Admin ("Best at 2400 × 1200 px"). Defaults to minWidth × minWidth / aspect. */
  recommended: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  /** Where and how the photo is shown, said in Admin next to the upload. */
  help: z.string().optional(),
  /** Also keep a 2400 px rendition (full-width banners on large screens). */
  hd: z.boolean().default(false),
});
export type ImageSlot = z.infer<typeof ImageSlot>;

export const ManifestSection = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  page: z.string(),
  fields: z.array(ManifestFieldSchema),
});
export type ManifestSection = z.infer<typeof ManifestSection>;

/**
 * Home page builder: section types the owner can add, hide, reorder and remove.
 * `single` = at most one; `pinned: 'first'` = must stay at the top. `defaults` seed a new section.
 */
export const ManifestBlock = z.object({
  type: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string(),
  description: z.string().default(''),
  single: z.boolean().default(false),
  pinned: z.enum(['first']).optional(),
  defaults: z.record(z.string(), z.unknown()).default({}),
  fields: z.array(ManifestFieldSchema),
});
export type ManifestBlock = z.infer<typeof ManifestBlock>;

export type { HomeSection } from './home.ts';
export { homeSections } from './home.ts';

export const SiteManifest = z.object({
  $schema: z.string().optional(),
  manifestVersion: z.literal(1),
  name: z.string(),
  locales: z.array(z.string()).min(1),
  variantLabels: z.object({ option1: z.string(), option2: z.string() }),
  imageSizes: z.array(z.number().int()).default([480, 960, 1600]),
  imageSlots: z.array(ImageSlot),
  sections: z.array(ManifestSection),
  blocks: z.array(ManifestBlock).default([]),
  flags: z.record(z.string(), z.boolean()).default({}),
});
export type SiteManifest = z.infer<typeof SiteManifest>;

/** Build a Zod validator for a content document from the manifest, so the API rejects malformed content. */
export function contentSchemaFor(manifest: SiteManifest) {
  const forField = (f: ManifestField): z.ZodType => {
    let s: z.ZodType;
    switch (f.type) {
      case 'text': case 'textarea': case 'richtext': case 'url': {
        let t = z.string();
        if (f.maxLength) t = t.max(f.maxLength);
        s = f.required ? t.min(1) : t.default('');
        break;
      }
      case 'image': s = f.required ? z.string().min(1) : z.string().nullable().default(null); break;
      case 'boolean': s = z.boolean().default(false); break;
      case 'number': s = z.number().default(0); break;
      case 'select': { const vals = f.options.map((o) => o.value) as [string, ...string[]]; s = z.enum(vals).default(vals[0]); break; }
      case 'collection': case 'category': s = f.required ? z.string().min(1) : z.string().nullable().default(null); break;
      case 'list': {
        let arr = z.array(z.object(Object.fromEntries(f.fields.map((c) => [c.id, forField(c)]))));
        if (f.min !== undefined) arr = arr.min(f.min);
        if (f.max !== undefined) arr = arr.max(f.max);
        s = arr.default([]);
        break;
      }
    }
    return s;
  };
  const shape: Record<string, z.ZodType> = Object.fromEntries(
    manifest.sections.map((sec) => [sec.id, z.object(Object.fromEntries(sec.fields.map((f) => [f.id, forField(f)])))]),
  );
  if (manifest.blocks.length) {
    const variants = manifest.blocks.map((b) => z.object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{2,40}$/),
      type: z.literal(b.type),
      enabled: z.boolean().default(true),
      data: z.object(Object.fromEntries(b.fields.map((f) => [f.id, forField(f)]))).prefault({}),
    }));
    const byType = new Map(manifest.blocks.map((b) => [b.type, b]));
    shape.home = z.object({
      sections: z.array(z.discriminatedUnion('type', variants as [typeof variants[number], ...typeof variants])).max(24),
    }).superRefine((home, ctx) => {
      const seen = new Map<string, number>();
      const ids = new Set<string>();
      home.sections.forEach((s, i) => {
        const b = byType.get(s.type)!;
        seen.set(s.type, (seen.get(s.type) ?? 0) + 1);
        if (b.single && seen.get(s.type)! > 1) ctx.addIssue({ code: 'custom', path: ['sections', i], message: `Only one "${b.label}" section is allowed` });
        if (b.pinned === 'first' && i !== 0) ctx.addIssue({ code: 'custom', path: ['sections', i], message: `"${b.label}" must stay at the top` });
        if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['sections', i, 'id'], message: 'Duplicate section id' });
        ids.add(s.id);
      });
    });
  }
  return z.object(shape);
}

