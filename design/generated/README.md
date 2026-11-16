# Generated storefront imagery

These are **development concepts**, generated with the built-in image generation tool. They are not photographs of Femia's actual stock. Replace product-specific imagery with verified photographs before launch.

## Prompt set

Shared direction: photorealistic editorial fashion photography for a contemporary Indian ethnic-wear boutique in Kerala; South Indian model, realistic fabric and anatomy, sunlit champagne plaster, soft rose shadows, warm natural light, refined and restrained styling. Portrait framing; no text, logos, watermarks, sarees, extra people, or graphic overlays.

Hero lead: full-length woman in an ivory cotton kurta and relaxed trousers with subtle tonal embroidery, standing in a sunlit boutique with a pale arch, leaf shadows and a brass rail. The whole figure remains visible in a 4:5 card.

Hero products: four separate 3:4 full-length portraits on a quiet plaster studio background, each showing the garment clearly: (1) deep maroon straight-cut cotton kurta with tonal yoke and cuff embroidery; (2) peach floral cotton shirt-style co-ord with matching straight pants; (3) olive printed A-line rayon kurta with gathered yoke and cream trousers; (4) pale lavender embroidered georgette kurta with gathered waist and matching trousers.

Category cards: five separate 3:4 editorial portraits: (1) wine-maroon embroidered kurta, neckline and long tunic silhouette clear; (2) peach floral matching top and trousers shown together; (3) mustard tiered midi dress, visibly one piece; (4) short lavender embroidered top ending at the hips, framed to emphasize the top; (5) cream wide-leg block-print palazzo trousers with a plain rosewood top, framed to emphasize the trousers.

Additional editorial concepts are in `editorial-v2/`: three collection cards, a boutique-inspired mood image, four style portraits, a textile image for About, and four product portraits. The style portraits are presented as inspiration, not as customer submissions. The boutique image is a mood concept, not a photograph of the physical shop.

Source WebP files are in `hero/`, `categories/`, and `editorial-v2/`. `tools/seed/build-seed.mjs` makes 480, 960 and 1600 pixel serving variants in the local seed media directory. To apply the additional images to an existing local development database, run `node tools/seed/apply-editorial-v2-local.mjs`.
