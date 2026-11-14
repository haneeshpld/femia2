# Design: Femia storefront

World: **silk & zari.** A Kochi boutique at golden hour: arched windows, a maroon silk ribbon, and the gold zari embroidery found on kurta hems and dupatta borders. Couture-magazine type, warm light, fine gold thread as the only ornament.

## Type
- Display: **Bodoni Moda** (variable, optical sizes), weights 450–600, italic for the accent phrase. Tracking −0.02em at display sizes; max 6rem.
- Text & UI: **Jost** (variable). Body 1rem/1.65, 400. Buttons, nav and labels: 500, uppercase, +0.14em tracking.
- Numerals: Jost tabular for prices.

## Colour
Maroon `#7A1628` (silk), deep maroon `#4E0F18` (footer), cream `#FBF1E9` (ground), blush `#F7E1D8`, ink `#3A1F14`, zari gold `#C79A3E` with light `#EBCB82` and deep `#9A6E22`. Gold is used as thread (hairlines, dividers, inner borders, small marks), never as large fills or gradient text.

## Material
- **Zari thread:** 1px gold hairlines; buttons carry an inner gold thread 3px inside the edge.
- **Silk sheen:** a soft diagonal light that sweeps across buttons and product photos on hover.
- **Warm depth:** layered shadows tinted maroon-brown with real offset and blur. Card radius 14px.
- **Arch:** category tiles and the boutique photo sit in arched frames; the header plate dips in a shallow arch under the centred logo and flattens as you scroll.
- **Zari hem band:** a woven geometric gold-on-maroon border (crisp SVG geometry) opens the footer.

## Motion
- Focal moment: the hero. The silk ribbon unfurls (diagonal clip reveal + blur to sharp), headline lines rise, and a stitched gold thread draws under the italic accent.
- Supporting: arches open from the base; occasion photos drift inside their frames as the row scrolls; the boutique photo eases in like walking through a doorway; collection marquee follows scroll velocity.
- Cross-page: native view transitions; the product photo morphs from card to product page.
- Easing `cubic-bezier(.16,1,.3,1)`; 150–300ms for feedback; ≤ 900ms for the focal entrance. Reduced motion: no spatial movement, keep fades and state changes.
