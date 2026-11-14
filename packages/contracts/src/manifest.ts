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

export const SiteManifest = z.object({
  $schema: z.string().optional(),
  manifestVersion: z.literal(1),
  name: z.string(),
  locales: z.array(z.string()).min(1),
  variantLabels: z.object({ option1: z.string(), option2: z.string() }),
  imageSizes: z.array(z.number().int()).default([480, 960, 1600]),
  imageSlots: z.array(ImageSlot),
  sections: z.array(ManifestSection),
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
      case 'select': s = z.enum(f.options.map((o) => o.value) as [string, ...string[]]); break;
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
  return z.object(
    Object.fromEntries(manifest.sections.map((sec) => [sec.id, z.object(Object.fromEntries(sec.fields.map((f) => [f.id, forField(f)])))])),
  );
}
