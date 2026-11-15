import { beforeEach, describe, expect, it } from 'vitest';
import manifest from '../../storefront/site.manifest.json?raw';
import { call, E, seedBasics } from './helpers.ts';

const base = {
  announcement: { enabled: false, messages: [] }, boutique: {}, trust: { items: [{ icon: 'truck', title: 'Free shipping' }, { icon: 'chat', title: 'Help' }] },
  newsletter: {}, about: { title: 'About' }, policies: { shipping: 's', returns: 'r', privacy: 'p', terms: 't', contact: 'c' }, sizeGuide: {},
};

beforeEach(async () => {
  await seedBasics();
  await E.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('site_manifest', ?)").bind(manifest).run();
});

describe('home page builder', () => {
  it('saves, publishes and keeps order, hidden state and repeated types', async () => {
    const home = { sections: [
      { id: 'hero', type: 'hero', data: { title: 'Everyday', ctaLabel: 'Shop', ctaLink: '/shop' } },
      { id: 'sale', type: 'banner', data: { heading: 'Onam *Edit*', ctaLabel: 'Shop', ctaLink: '/collections' } },
      { id: 'new', type: 'products', data: { heading: 'Just landed', source: 'newest', count: 4 } },
      { id: 'festive', type: 'products', enabled: false, data: { heading: 'Festive picks', source: 'collection', collection: 'col_x' } },
      { id: 'about', type: 'story', data: { heading: 'Since 2019', body: 'A Kochi boutique.' } },
    ] };
    const saved = await call('PUT', '/admin/content/draft', { data: { ...base, home } });
    expect(saved.status).toBe(200);
    const pub = await call('POST', '/admin/content/publish');
    const sections = pub.json.data.home.sections;
    expect(sections.map((s: { id: string }) => s.id)).toEqual(['hero', 'sale', 'new', 'festive', 'about']);
    expect(sections[3].enabled).toBe(false);
    expect(sections[2].data.count).toBe(4);
  });

  it('refuses a page where the hero is moved down or added twice', async () => {
    const r = await call('PUT', '/admin/content/draft', { data: { ...base, home: { sections: [
      { id: 'p', type: 'products', data: {} }, { id: 'hero', type: 'hero', data: { title: 'T', ctaLabel: 'S', ctaLink: '/' } },
    ] } } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json.error.details.fields)).toContain('must stay at the top');
  });

  it('staff can arrange sections in a draft but cannot publish', async () => {
    const staff = { 'X-Dev-User': 'staff@test.local' };
    const ok = await call('PUT', '/admin/content/draft', { data: { ...base, home: { sections: [{ id: 'hero', type: 'hero', data: { title: 'T', ctaLabel: 'S', ctaLink: '/' } }] } } }, staff);
    expect(ok.status).toBe(200);
    expect((await call('POST', '/admin/content/publish', undefined, staff)).status).toBe(403);
  });
});
