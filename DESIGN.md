# Design: Femia storefront

World: **ivory & caramel.** A sunlit boutique: ivory walls, white cards, caramel-gold accents and the fine gold thread of zari embroidery. Couture-magazine type, soft daylight, quiet luxury. Chosen by the owner on 16 Nov 2026, replacing the earlier maroon "silk & zari" look.

## Type
- Display: **Cormorant Garamond** (variable), weights 500–600, italic 500 for the accent phrase. A soft, refined Garamond: elegant without Bodoni's hard hairlines. Tracking −0.015em; hero max 6rem, page headings max 4rem. Serif is for headings only (≥ ~1.25rem); never for product names, cart lines or other small text.
- Text & UI: **DM Sans** (variable). Body 1rem/1.6, 400. Product names: DM Sans 500, 1rem. Buttons, nav, category names and small labels: 500, uppercase, +0.08–0.12em tracking. Text links and form labels: sentence case.
- Hover and selection never change the typeface, style or size: only colour, underline or a soft highlight.
- Numerals: DM Sans tabular for prices.

## Colour
Defined in `apps/storefront/src/styles/global.css` as `--c-accent*` plus overrides of the shared tokens (Admin keeps the tokens' maroon).
Ivory ground `#FBF8F3`, white surfaces `#FFFFFF`, soft band `#F5EEE5`, footer `#F6F0E7`, line `#E9E0D4`, ink `#2F2721`, text `#4B4239`, muted `#6E6459`. Accent caramel `#8A6236` (links, italic accents, active states; 5.1:1 on ivory); buttons a caramel gradient `#93693A → #7A5730` with ivory text. Zari gold `#C8A574` (light `#E6CFA4`, deep `#94703F`) is thread only: hairlines, inner borders, ornaments, never large fills or gradient text. Shadows are warm brown.

## Material
- **Zari thread:** 1px gold hairlines; buttons carry an inner gold thread 3px inside the edge.
- **Warm depth:** layered shadows tinted warm brown with real offset and blur. Card radius 14px; white cards on the ivory ground.
- **The rail (hero):** the boutique's rail of new pieces. A brass rod (zari gradient) runs from the middle of the hero off the right edge of the screen; the owner's photo hangs first, open, and the four newest in-stock pieces hang beside it as narrow slices with their names running up the side like garment tags. Each hangs from a small ring and hook. Pointing at or tabbing to a piece slides it open (name and price appear) while the others close up and the rings slide along the rod. Headline, intro, buttons, tagline and live open/closed line sit on the left, vertically centred. Phones: headline, then the rail as a swipeable strip (photo card first), then the buttons, intro and status.
- **Section heads:** centred display heading over a small zari ornament (two short threads meeting at a lozenge); any link or control sits at the right (below on phones). No small labels above headings.
- **Header:** flat white bar with a hairline; logo left, uppercase menu centred (Home, Shop, Collections, About, Visit Us) with a caramel underline on the current page; slims slightly on scroll.
- **Categories:** square photo cards, name in small capitals on a soft band below.
- **Product rows and Styled by You:** on wide screens the heading becomes an intro column on the left; "View all" links are outlined pills.
- **Boutique:** rounded photo on a soft ivory band; address and hours in a row.
- **Promo banner ("the hem"):** the photo runs to one edge of the screen and ends in a straight seam with a dashed zari stitch just inside it. The heading is laid across the seam: ivory (italic in zari gold) over the photo, ink (italic in caramel) on the wall. On phones the photo is full width, the hem runs along its foot and the first heading line sits half on it. "Text position" in Admin picks the side the message sits on.
- **Trust strip:** one rounded band with white, gold-ringed icons.
- **Footer:** light (`#F6F0E7`): logo, italic tagline, live open status and round social icons; Shop / Help / About; newsletter with a pill field and round caramel arrow.

## Motion
- Focal moment: the hero. The garments drop onto the rail one after another (clip from the top, photos settling from a slight zoom) while the headline lines rise and the rest fades in. Afterwards only the visitor moves it: hovering a piece slides it open along the rail.
- Supporting: a gold zari thread, led by a needle, stitches down the homepage as you scroll; category photos open from the base; occasion photos drift inside their frames as the row scrolls; the boutique photo eases in like walking through a doorway; the promo banner's heading slides across the hem as it scrolls in, its letters turning from ivory to ink as they cross (CSS scroll-driven, plays back on scroll up; unsupported browsers show the finished state).
- Calm by default: no looping or attention-seeking motion (no marquees, card shine sweeps, magnetic buttons or pulsing dots). The announcement bar shows one message at a time with a soft fade.
- Cross-page: native view transitions; the product photo morphs from card to product page.
- Easing `cubic-bezier(.16,1,.3,1)`; 150–300ms for feedback; ≤ 900ms for the focal entrance. Reduced motion: no spatial movement, keep fades and state changes.
