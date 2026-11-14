// Builds DEV-ONLY seed data from the approved mockups:
//  • brand assets (clean wordmark without the glow halo, emblem, favicons) → apps/storefront/public/brand
//  • placeholder photos cropped from the mockups → .seed/media/<id>/<w>.webp
//  • apps/api/seed/dev.sql (catalogue, settings, content v1, manifest, users)
// Real product photos and copy replace all of this before launch (Release 1.0 rule: no placeholders at launch).
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const REF = join(ROOT, 'design/reference');
const BRAND = join(ROOT, 'apps/storefront/public/brand');
const MEDIA_OUT = join(ROOT, '.seed/media');
const SQL_OUT = join(ROOT, 'apps/api/seed/dev.sql');
const SIZES = [480, 960, 1600];

mkdirSync(BRAND, { recursive: true });
rmSync(MEDIA_OUT, { recursive: true, force: true });
mkdirSync(MEDIA_OUT, { recursive: true });
mkdirSync(join(ROOT, 'apps/api/seed'), { recursive: true });

// ───────────────────────── brand assets ─────────────────────────
async function brand() {
  // Wordmark: keep the dark letterforms, drop the yellow/orange glow, recolour.
  const src = sharp(join(REF, 'logo-wordmark.png')).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const mk = (rgb) => {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const a = Math.max(0, Math.min(1, (150 - lum) / 110)) * (data[i + 3] / 255);
      out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = Math.round(a * 255);
    }
    return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } });
  };
  for (const [name, rgb] of [['wordmark', [0x64, 0x17, 0x20]], ['wordmark-light', [0xfb, 0xf1, 0xe9]]]) {
    const trimmed = await mk(rgb).png().toBuffer().then((b) => sharp(b).trim({ threshold: 1 }).toBuffer());
    await sharp(trimmed).resize({ height: 144 }).webp({ quality: 92, alphaQuality: 100 }).toFile(join(BRAND, `${name}.webp`));
    await sharp(trimmed).resize({ height: 144 }).png({ compressionLevel: 9 }).toFile(join(BRAND, `${name}.png`));
  }
  const emblem = await sharp(join(REF, 'logo-emblem.png')).trim({ threshold: 1 }).toBuffer();
  await sharp(emblem).resize(160, 160, { fit: 'contain', background: '#0000' }).webp({ quality: 92 }).toFile(join(BRAND, 'emblem.webp'));
  await sharp(emblem).resize(160, 160, { fit: 'contain', background: '#0000' }).png().toFile(join(BRAND, 'emblem.png'));
  // Icons: emblem on cream for app/touch icons, transparent for favicon.
  await sharp(emblem).resize(32, 32, { fit: 'contain', background: '#0000' }).png().toFile(join(ROOT, 'apps/storefront/public/favicon-32.png'));
  for (const [file, size, pad] of [['apple-touch-icon.png', 180, 18], ['icon-192.png', 192, 20], ['icon-512.png', 512, 56], ['icon-maskable-512.png', 512, 110]]) {
    const inner = await sharp(emblem).resize(size - pad * 2, size - pad * 2, { fit: 'contain', background: '#0000' }).toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: '#FBF1E9' } })
      .composite([{ input: inner, left: pad, top: pad }]).png().toFile(join(ROOT, 'apps/storefront/public', file));
  }
}

// ───────────────────────── placeholder photos ─────────────────────────
const blurCache = new Map();
async function blurred(file) {
  if (!blurCache.has(file)) blurCache.set(file, await sharp(join(REF, file)).blur(14).toBuffer());
  return blurCache.get(file);
}

let mediaSeq = 0;
const mediaRows = [];
/** Crop a region, patch over any UI icon (wishlist heart) with blurred background, export 3 WebP sizes. */
async function crop(file, rect, alt, patches = []) {
  const id = `med_seed${String(++mediaSeq).padStart(2, '0')}`;
  let img = sharp(join(REF, file));
  if (patches.length) {
    const blur = await blurred(file);
    const comps = await Promise.all(patches.map(async ([cx, cy, r]) => {
      const box = { left: cx - r, top: cy - r, width: r * 2, height: r * 2 };
      const mask = Buffer.from(`<svg width="${r * 2}" height="${r * 2}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`);
      const patch = await sharp(blur).extract(box).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      return { input: patch, left: box.left, top: box.top };
    }));
    img = sharp(await img.composite(comps).png().toBuffer());
  }
  const base = await img.extract({ left: rect[0], top: rect[1], width: rect[2], height: rect[3] }).png().toBuffer();
  const dir = join(MEDIA_OUT, id);
  mkdirSync(dir, { recursive: true });
  for (const w of SIZES) {
    await sharp(base).resize({ width: w, kernel: 'lanczos3' }).sharpen({ sigma: 0.6 }).webp({ quality: 78 }).toFile(join(dir, `${w}.webp`));
  }
  const { dominant } = await sharp(base).stats();
  const hex = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');
  const h = Math.round((rect[3] / rect[2]) * 1600);
  mediaRows.push({ id, key_base: `seed/${id}`, width: 1600, height: h, alt, placeholder: hex });
  return id;
}

// Shop grid cards (shop.png): image area 222px tall; 3:4 crop centred, heart icon patched.
const SH_X = [162, 396, 629, 863];
const shop = (row, col, alt) => {
  const y = row === 0 ? 482 : 871;
  return crop('shop.png', [SH_X[col] - 81, y, 162, 216], alt, [[SH_X[col] + 82, y + 20, 17]]);
};
const TILE_X = [65, 249, 430, 610, 791];
const tile = (i, alt) => crop('home-top.png', [TILE_X[i], 712, 166, 216], alt);

// ───────────────────────── SQL helpers ─────────────────────────
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`;
const insert = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`;

async function main() {
  await brand();
  const sql = ['-- DEV SEED: generated by tools/seed/build-seed.mjs. Placeholder content cropped from mockups. Do not load in production.', 'PRAGMA foreign_keys = ON;'];

  // Categories with arch tile photos
  const cats = [
    ['cat_kurtas', 'kurtas', 'Kurtas', await tile(0, 'Maroon embroidered kurta')],
    ['cat_coords', 'co-ord-sets', 'Co-ord Sets', await tile(1, 'Peach floral co-ord set')],
    ['cat_dresses', 'dresses', 'Dresses', await tile(2, 'Mustard tiered dress')],
    ['cat_tops', 'tops', 'Tops', await tile(3, 'Lavender embroidered top')],
    ['cat_bottoms', 'bottoms', 'Bottoms', await tile(4, 'Cream block-print palazzo')],
  ];

  // Occasion + boutique + social + hero + banner images
  const occ = [
    await crop('home-bottom.png', [108, 180, 234, 195], 'Woman in a cream floral kurta in warm light'),
    await crop('home-bottom.png', [458, 180, 234, 195], 'Woman in a maroon festive kurta with jasmine in her hair'),
    await crop('home-bottom.png', [767, 180, 212, 177], 'Woman in an olive kurta at work'),
  ];
  const boutique = await crop('home-bottom.png', [82, 513, 363, 260], 'Inside the Femia boutique on MG Road, Kochi');
  const social = [];
  for (const [x, alt] of [[81, 'Customer in a lavender kurta'], [295, 'Customer in a mustard kurta'], [506, 'Customer in a cream chikankari kurta'], [720, 'Customer in a maroon embroidered kurta']]) {
    social.push(await crop('home-bottom.png', [x, 862, 196, 205], alt));
  }
  const hero = await crop('home-top.png', [560, 112, 464, 516], 'A sheer maroon silk ribbon with gold floral embroidery drifting past an arched window');
  const banner = await crop('shop.png', [520, 112, 504, 236], 'Maroon silk ribbon with gold embroidery');

  cats.forEach(([id, slug, name, img], i) => sql.push(insert('categories', { id, slug, name, sort: i, image_id: img })));

  const colls = [
    ['col_everyday', 'everyday-edit', 'Everyday Edit', 'occasion', 'Easy cottons and soft prints for every day.', occ[0]],
    ['col_festive', 'festive-edit', 'Festive Edit', 'occasion', 'Rich colours and fine embroidery for celebrations.', occ[1]],
    ['col_work', 'work-edit', 'Work Edit', 'occasion', 'Polished, comfortable pieces for the workday.', occ[2]],
    ['col_cotton', 'cotton-comfort', 'Cotton Comfort', 'collection', 'Breathable cottons made for Kerala weather.', null],
    ['col_embroidery', 'signature-embroidery', 'Signature Embroidery', 'collection', 'Hand-finished embroidery on our favourite silhouettes.', null],
  ];
  colls.forEach(([id, slug, name, kind, description, image_id], i) => sql.push(insert('collections', { id, slug, name, kind, description, sort: i, image_id })));

  const C = {
    maroon: ['maroon', 'Maroon', '#7A1F2B'], navy: ['navy', 'Navy', '#1F2A4D'], cream: ['cream', 'Cream', '#F2E2CC'], olive: ['olive', 'Olive', '#6E6B33'],
    peach: ['peach', 'Peach', '#F3D9C4'], rose: ['rose', 'Rose', '#D98A86'], lavender: ['lavender', 'Lavender', '#B9A0D8'], mustard: ['mustard', 'Mustard', '#D9A21B'],
  };
  const SIZES_STD = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const SIZES_SET = ['S', 'M', 'L', 'XL'];
  const CARE = 'Gentle hand wash in cold water. Wash dark colours separately. Dry in shade. Warm iron on the reverse.';

  const products = [
    { slug: 'embroidered-kurta', title: 'Embroidered Kurta', cat: 'cat_kurtas', price: 129900, mrp: 179900, fabric: 'Cotton', colours: ['maroon', 'navy', 'cream'], sizes: SIZES_STD,
      desc: 'A straight-cut cotton kurta with tonal thread embroidery on the yoke and sleeves. Breathable for long Kerala days, polished enough for evenings out.',
      images: [[await shop(0, 0, 'Maroon embroidered cotton kurta, front'), 'main', 'maroon'], [await shop(1, 2, 'Navy embroidered cotton kurta, front'), 'main', 'navy']],
      colls: ['col_everyday', 'col_embroidery', 'col_cotton'], pop: 90 },
    { slug: 'floral-co-ord-set', title: 'Floral Co-ord Set', cat: 'cat_coords', price: 189900, mrp: 249900, fabric: 'Cotton', colours: ['peach', 'rose'], sizes: SIZES_SET,
      desc: 'A relaxed shirt-style top with matching straight pants in a soft floral print. Wear together or style separately.',
      images: [[await shop(0, 1, 'Peach floral cotton co-ord set'), 'main', 'peach']], colls: ['col_everyday', 'col_cotton'], pop: 80 },
    { slug: 'printed-kurta', title: 'Printed Kurta', cat: 'cat_kurtas', price: 139900, mrp: 189900, fabric: 'Rayon', colours: ['olive', 'cream'], sizes: SIZES_STD,
      desc: 'A flowing A-line kurta with a delicate all-over print and gathered yoke. Light, easy and made for movement.',
      images: [[await shop(0, 2, 'Olive printed rayon kurta'), 'main', 'olive']], colls: ['col_work', 'col_everyday'], pop: 70 },
    { slug: 'chikankari-kurta', title: 'Chikankari Kurta', cat: 'cat_kurtas', price: 179900, mrp: 229900, fabric: 'Georgette', colours: ['lavender', 'cream'], sizes: SIZES_STD,
      desc: 'Fine chikankari-inspired embroidery on soft georgette, with a gathered waist and three-quarter sleeves.',
      images: [[await shop(0, 3, 'Lavender chikankari georgette kurta'), 'main', 'lavender']], colls: ['col_festive', 'col_embroidery'], pop: 85 },
    { slug: 'tiered-dress', title: 'Tiered Dress', cat: 'cat_dresses', price: 169900, mrp: null, fabric: 'Cotton', colours: ['mustard', 'olive'], sizes: SIZES_SET,
      desc: 'A sunny tiered midi dress with a printed body and embroidered neckline. Pockets included.',
      images: [[await shop(1, 0, 'Mustard tiered cotton dress'), 'main', 'mustard']], colls: ['col_everyday', 'col_cotton'], pop: 60 },
    { slug: 'cotton-co-ord-set', title: 'Cotton Co-ord Set', cat: 'cat_coords', price: 189900, mrp: null, fabric: 'Cotton', colours: ['cream', 'rose'], sizes: SIZES_SET,
      desc: 'A block-printed cotton co-ord with a mandarin-collar shirt and straight pants.',
      images: [[await shop(1, 1, 'Cream block-print cotton co-ord set'), 'main', 'cream']], colls: ['col_work', 'col_cotton'], pop: 55 },
    { slug: 'a-line-dress', title: 'A-line Dress', cat: 'cat_dresses', price: 179900, mrp: null, fabric: 'Rayon', colours: ['rose', 'cream'], sizes: SIZES_SET,
      desc: 'A rose A-line dress with tonal embroidery at the neckline and soft gathers at the waist.',
      images: [[await shop(1, 3, 'Rose A-line rayon dress'), 'main', 'rose']], colls: ['col_festive'], pop: 50 },
    { slug: 'lavender-embroidered-top', title: 'Lavender Embroidered Top', cat: 'cat_tops', price: 119900, mrp: 149900, fabric: 'Cotton', colours: ['lavender'], sizes: SIZES_STD,
      desc: 'A short kurta-style top with fine embroidery. Pair with palazzos or jeans.',
      images: [[cats[3][3], 'main', 'lavender']], colls: ['col_work'], pop: 40 },
    { slug: 'block-print-palazzo', title: 'Block Print Palazzo', cat: 'cat_bottoms', price: 99900, mrp: null, fabric: 'Cotton', colours: ['cream'], sizes: SIZES_SET,
      desc: 'Wide-leg cotton palazzos with a hand-block print border and an easy elasticated waist.',
      images: [[cats[4][3], 'main', 'cream']], colls: ['col_everyday', 'col_cotton'], pop: 30 },
  ];

  // deterministic pseudo-random stock: some sold-out, some low
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const day = 864e5;
  products.forEach((p, pi) => {
    const id = `prd_seed${pi + 1}`;
    const published = new Date(Date.now() - (pi * 3 + 1) * day).toISOString();
    sql.push(insert('products', {
      id, slug: p.slug, title: p.title, description: p.desc, category_id: p.cat, fabric: p.fabric, care: CARE, status: 'active',
      price: p.price, compare_at_price: p.mrp, popularity: p.pop, published_at: published, created_at: published, updated_at: published,
    }));
    p.sizes.forEach((s, i) => sql.push(insert('product_options', { product_id: id, option: 1, value: s, label: s, swatch: null, sort: i })));
    p.colours.forEach((c, i) => sql.push(insert('product_options', { product_id: id, option: 2, value: C[c][0], label: C[c][1], swatch: C[c][2], sort: i })));
    let vi = 0;
    for (const c of p.colours) for (const s of p.sizes) {
      const r = rnd();
      const onHand = r < 0.12 ? 0 : r < 0.25 ? 1 : Math.floor(2 + rnd() * 6);
      const vid = `var_seed${pi + 1}x${vi}`;
      const sku = `${p.cat.slice(4, 7).toUpperCase()}-${p.slug.split('-').map((w) => w[0]).join('').toUpperCase()}-${s}-${C[c][0].slice(0, 3).toUpperCase()}`;
      sql.push(insert('variants', { id: vid, product_id: id, sku, option1: s, option2: C[c][0], on_hand: onHand, sort: vi++ }));
      if (onHand) sql.push(insert('stock_ledger', { variant_id: vid, delta: onHand, reason: 'restock', note: 'Opening stock (seed)', actor: 'seed' }));
    }
    p.images.forEach(([mid, role, colour], i) => sql.push(insert('product_media', { product_id: id, media_id: mid, role, option2: colour, sort: i })));
    p.colls.forEach((cid, i) => sql.push(insert('product_collections', { product_id: id, collection_id: cid, sort: i })));
  });

  const settings = {
    store: {
      name: 'Femia', tagline: 'Elegant Ethnicwear for Every Occasion', email: 'hello@femia.example', phone: '+91 98470 00000', whatsapp: '9847000000',
      address: { line1: 'MG Road', line2: '', city: 'Kochi', state: 'Kerala', pincode: '682035' },
      mapUrl: 'https://maps.google.com/?q=MG+Road+Kochi', geo: { lat: 9.9706, lng: 76.2856 }, hoursSummary: 'Open daily · 10 AM – 9 PM', hours: null,
      socials: { instagram: 'https://instagram.com/femia', facebook: '', youtube: '' },
    },
    shipping: { freeShippingThreshold: 99900, flatFee: 7900, shipToStates: ['KL'], cod: { enabled: true, maxOrderValue: 500000 } },
    payments: { upi: { enabled: true, vpa: 'femia@okicici', payeeName: 'Femia', holdHours: 12 }, gateway: { enabled: false, provider: 'razorpay', testMode: true }, whatsapp: { enabled: true } },
    notifications: { telegramChatId: '', lowStockThreshold: 2, dailySummary: true },
  };
  for (const [k, v] of Object.entries(settings)) sql.push(insert('settings', { key: k, value: JSON.stringify(v), updated_by: 'seed' }));
  sql.push(insert('settings', { key: 'site_manifest', value: readFileSync(join(ROOT, 'apps/storefront/site.manifest.json'), 'utf8'), updated_by: 'seed' }));

  const content = {
    announcement: { enabled: true, messages: [{ text: 'Free shipping above ₹999', link: '/shop' }, { text: 'Easy returns within 7 days', link: '/policies/returns' }] },
    hero: {
      eyebrow: 'Contemporary Ethnic Wear', title: 'Everyday Styles for', titleAccent: 'Modern Women',
      body: 'Kurtas, co-ord sets and dresses, thoughtfully curated for your everyday story.',
      ctaLabel: 'Shop New Arrivals', ctaLink: '/shop?sort=new', secondaryLabel: 'Visit our boutique', secondaryLink: '/visit', image: hero,
    },
    categories: { eyebrow: 'Shop by Category', items: cats.map(([id, , , img]) => ({ category: id, image: img })) },
    newArrivals: { eyebrow: 'New Arrivals', title: 'Just landed', collection: null, count: 8 },
    occasions: { eyebrow: 'Shop by Occasion', title: 'Dressed for every moment', items: [
      { collection: 'col_everyday', title: 'Everyday Edit', image: occ[0] }, { collection: 'col_festive', title: 'Festive Edit', image: occ[1] }, { collection: 'col_work', title: 'Work Edit', image: occ[2] },
    ] },
    boutique: { eyebrow: 'Visit Our Boutique', title: 'Try it on in person', body: 'Step into our boutique to explore the full collection, feel the fabrics and find your perfect fit with our stylists.', image: boutique },
    styled: { enabled: true, eyebrow: 'Styled by You', handle: '@femia', images: social.map((image) => ({ image, link: '' })) },
    trust: { items: [
      { icon: 'truck', title: 'Free Shipping', body: 'Above ₹999' }, { icon: 'returns', title: 'Easy Returns', body: 'Within 7 days' },
      { icon: 'shield', title: 'Secure Payments', body: 'UPI, Cards & more' }, { icon: 'chat', title: 'Need Help?', body: 'Chat on WhatsApp' },
    ] },
    newsletter: { title: 'Get Style Updates', body: 'New arrivals and exclusive offers, straight to your inbox.' },
    about: {
      title: 'Made for the way you live', intro: 'Femia is a Kochi boutique for contemporary ethnic wear: kurtas, co-ords and dresses you will reach for again and again.',
      body: 'DRAFT: replace with the owner\'s story before launch.\n\nWe started Femia to make beautiful, comfortable ethnic wear easy to find. Every piece is chosen for its fabric, its fit and how it feels at the end of a long day.',
      image: banner,
    },
    policies: {
      shipping: 'DRAFT for client review.\n\n## Where we deliver\nWe currently deliver within Kerala.\n\n## Charges\nFree shipping on orders above ₹999. A flat ₹79 applies below that.\n\n## Timelines\nOrders are packed within 1–2 working days and usually arrive in 2–5 days.',
      returns: 'DRAFT for client review.\n\n## Returns within 7 days\nUnworn items with tags attached can be returned within 7 days of delivery. Message us on WhatsApp with your order number to start a return.',
      privacy: 'DRAFT for client review (DPDP Act 2023).\n\nWe collect your name, phone, email and address only to deliver your order and keep you updated. We never sell your data.',
      terms: 'DRAFT for client review.\n\nBy placing an order you agree to these terms.',
      contact: 'WhatsApp: +91 98470 00000\nEmail: hello@femia.example\nBoutique: MG Road, Kochi. Open daily, 10 AM – 9 PM.',
    },
    sizeGuide: {
      chart: '| Size | Bust (in) | Waist (in) | Hip (in) |\n|---|---|---|---|\n| XS | 32 | 26 | 35 |\n| S | 34 | 28 | 37 |\n| M | 36 | 30 | 39 |\n| L | 38 | 32 | 41 |\n| XL | 40 | 34 | 43 |\n| XXL | 42 | 36 | 45 |',
      howToMeasure: 'Measure around the fullest part of your bust, the narrowest part of your waist and the fullest part of your hips. If you are between sizes, choose the larger one.',
    },
  };
  sql.push(insert('content_versions', { status: 'published', data: JSON.stringify(content), note: 'Seed content', created_by: 'seed', published_at: new Date().toISOString() }));

  sql.push(insert('users', { id: 'usr_owner', email: 'owner@femia.local', name: 'Owner (dev)', role_id: 'owner' }));
  sql.push(insert('users', { id: 'usr_staff', email: 'staff@femia.local', name: 'Staff (dev)', role_id: 'staff' }));

  // media rows first (everything else references them)
  sql.splice(2, 0, ...mediaRows.map((m) => insert('media', { ...m, sizes: JSON.stringify(SIZES) })));
  writeFileSync(SQL_OUT, sql.join('\n') + '\n');
  writeFileSync(join(ROOT, '.seed/media.json'), JSON.stringify(mediaRows.map((m) => m.id)));
  console.log(`seed: ${mediaRows.length} images, ${products.length} products → ${SQL_OUT}`);
}

await main();
