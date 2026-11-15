import { z } from 'zod';
import { Id, Slug, Paise, Page } from './common.ts';

export const ProductStatus = z.enum(['draft', 'active', 'archived']);
export type ProductStatus = z.infer<typeof ProductStatus>;

/** A rendered image with its 3 web sizes. */
export const MediaRef = z.object({
  id: Id,
  alt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  /** URLs keyed by width: { "480": "/media/..", "960": "..", "1600": ".." } */
  src: z.record(z.string(), z.string()),
  placeholder: z.string().optional(),
});
export type MediaRef = z.infer<typeof MediaRef>;

export const Category = z.object({
  id: Id, slug: Slug, name: z.string(), sort: z.number().int(), image: MediaRef.nullable(),
});
export type Category = z.infer<typeof Category>;

export const CollectionKind = z.enum(['collection', 'occasion']);
export const Collection = z.object({
  id: Id, slug: Slug, name: z.string(), kind: CollectionKind, description: z.string(),
  sort: z.number().int(), image: MediaRef.nullable(),
});
export type Collection = z.infer<typeof Collection>;

/** Option values (e.g. Size: S M L, Colour: Maroon #7A1F2B). */
export const OptionValue = z.object({ value: z.string(), label: z.string(), swatch: z.string().nullable() });
export type OptionValue = z.infer<typeof OptionValue>;

export const Variant = z.object({
  id: Id,
  sku: z.string(),
  option1: z.string().nullable(),
  option2: z.string().nullable(),
  price: Paise,
  compareAtPrice: Paise.nullable(),
  available: z.number().int(),
});
export type Variant = z.infer<typeof Variant>;

export const ProductImage = MediaRef.extend({
  role: z.enum(['main', 'alt', 'detail']),
  /** option2 value (colour) this photo belongs to; null = all colours */
  option2: z.string().nullable(),
});
export type ProductImage = z.infer<typeof ProductImage>;

export const ProductCard = z.object({
  id: Id,
  slug: Slug,
  title: z.string(),
  price: Paise,
  compareAtPrice: Paise.nullable(),
  category: z.object({ slug: Slug, name: z.string() }),
  colours: z.array(OptionValue),
  /** first image per colour (in colour order), plus a hover alt image if present */
  images: z.array(ProductImage),
  soldOut: z.boolean(),
  isNew: z.boolean(),
  /** offer tags shown on the photo: the live sale first, then price-neutral tags */
  badges: z.array(z.object({ label: z.string(), style: z.string(), kind: z.enum(['sale', 'tag']) })).default([]),
  /** when the current sale ends (for a countdown), if it has an end */
  saleEndsAt: z.string().nullable().default(null),
});
export type ProductCard = z.infer<typeof ProductCard>;

export const ProductDetail = ProductCard.extend({
  description: z.string(),
  fabric: z.string(),
  care: z.string(),
  sizeChart: z.string().nullable(),
  option1Name: z.string(),
  option2Name: z.string(),
  option1Values: z.array(OptionValue),
  option2Values: z.array(OptionValue),
  variants: z.array(Variant),
  collections: z.array(z.object({ slug: Slug, name: z.string() })),
  related: z.array(ProductCard),
  /** Live bundle deals this product counts towards, e.g. "Buy 2, get 10% off". */
  deals: z.array(z.object({ label: z.string(), text: z.string(), style: z.string() })).default([]),
  seo: z.object({ title: z.string(), description: z.string() }),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

export const ProductSort = z.enum(['new', 'price-asc', 'price-desc', 'popular']);
export type ProductSort = z.infer<typeof ProductSort>;

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)));

export const ProductListQuery = z.object({
  category: Slug.optional(),
  collection: Slug.optional(),
  size: csv,
  colour: csv,
  fabric: csv,
  min: z.coerce.number().int().nonnegative().optional(),
  max: z.coerce.number().int().nonnegative().optional(),
  q: z.string().trim().max(80).optional(),
  sort: ProductSort.default('new'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});
export type ProductListQuery = z.input<typeof ProductListQuery>;

export const Facets = z.object({
  sizes: z.array(z.object({ value: z.string(), count: z.number().int() })),
  colours: z.array(z.object({ value: z.string(), label: z.string(), swatch: z.string().nullable(), count: z.number().int() })),
  fabrics: z.array(z.object({ value: z.string(), count: z.number().int() })),
  price: z.object({ min: Paise, max: Paise }),
});
export type Facets = z.infer<typeof Facets>;

export const ProductList = Page(ProductCard).extend({ facets: Facets });
export type ProductList = z.infer<typeof ProductList>;

export const StockLevels = z.record(z.string(), z.number().int());
export type StockLevels = z.infer<typeof StockLevels>;
