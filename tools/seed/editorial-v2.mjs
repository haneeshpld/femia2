// Development-only editorial concepts. These are not photographs of Femia stock,
// customers, or the physical boutique. IDs are versioned because media URLs are immutable.
export const editorialV2 = [
  ['med_v2_everyday', 'collections/everyday-edit.webp', 'Woman in a peach printed co-ord set in a sunlit veranda'],
  ['med_v2_festive', 'collections/festive-edit.webp', 'Woman in a maroon embroidered kurta under an arch'],
  ['med_v2_work', 'collections/work-edit.webp', 'Woman in an olive printed kurta in a bright corridor'],
  ['med_v2_boutique', 'story/boutique-mood.webp', 'Garment rail in a warm boutique-inspired setting'],
  ['med_v2_style_lavender', 'style/lavender.webp', 'Editorial portrait in a lavender embroidered kurta'],
  ['med_v2_style_mustard', 'style/mustard.webp', 'Editorial portrait in a mustard printed dress'],
  ['med_v2_style_ivory', 'style/ivory.webp', 'Editorial portrait in an ivory embroidered kurta'],
  ['med_v2_style_maroon', 'style/maroon.webp', 'Editorial portrait in a maroon embroidered kurta'],
  ['med_v2_about', 'story/about-textile.webp', 'Ivory embroidered fabric and rose ribbon in warm daylight'],
  ['med_v2_navy', 'products/navy-embroidered-kurta.webp', 'Navy embroidered cotton kurta with matching trousers'],
  ['med_v2_mustard_dress', 'products/mustard-tiered-dress.webp', 'Mustard printed tiered cotton dress'],
  ['med_v2_cream_coord', 'products/cream-block-print-coord.webp', 'Cream block-print cotton co-ord set'],
  ['med_v2_rose_dress', 'products/rose-a-line-dress.webp', 'Rose A-line embroidered rayon dress'],
];

export const editorialV2ById = new Map(editorialV2.map(([id, file, alt]) => [id, { file, alt }]));
