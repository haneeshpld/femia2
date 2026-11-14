import { beforeEach, describe, expect, it } from 'vitest';
import { call, seedBasics } from './helpers.ts';

const staff = { 'X-Dev-User': 'staff@test.local' };
beforeEach(seedBasics);

describe('catalog setup', () => {
  it('staff can add a category inline; duplicate names are refused with the existing id', async () => {
    const name = `Kaftans ${Math.random().toString(36).slice(2, 6)}`;
    const a = await call('POST', '/admin/categories', { name }, staff);
    expect(a.status).toBe(201);
    expect(a.json.slug).toMatch(/^kaftans-/);
    const b = await call('POST', '/admin/categories', { name: name.toUpperCase() }, staff);
    expect(b.status).toBe(409);
    expect(b.json.error.details.id).toBe(a.json.id);
    const renamed = await call('PATCH', `/admin/categories/${a.json.id}`, { name: `${name} & Tunics` }, staff);
    expect(renamed.json.name).toBe(`${name} & Tunics`);
  });

  it('creates occasions and collections, and can hide them', async () => {
    const r = await call('POST', '/admin/collections', { name: `Onam Edit ${Date.now()}`, kind: 'occasion', description: 'Kasavu whites and gold.' });
    expect(r.status).toBe(201);
    expect(r.json.kind).toBe('occasion');
    const hidden = await call('PATCH', `/admin/collections/${r.json.id}`, { active: false });
    expect(hidden.json.active).toBe(0);
  });

  it('colour / size / fabric lists: staff can extend, values are validated', async () => {
    const before = await call('GET', '/admin/catalog/presets', undefined, staff);
    expect(before.json.colours.length).toBeGreaterThan(10);
    const next = { ...before.json, colours: [...before.json.colours, { label: 'Bottle Green', hex: '#0F4D3A' }], sizes: [...before.json.sizes, '4XL'] };
    expect((await call('PUT', '/admin/catalog/presets', next, staff)).status).toBe(200);
    const after = await call('GET', '/admin/catalog/presets');
    expect(after.json.colours.at(-1)).toEqual({ label: 'Bottle Green', hex: '#0F4D3A' });
    expect(after.json.sizes).toContain('4XL');
    const bad = await call('PUT', '/admin/catalog/presets', { ...next, colours: [{ label: 'Oops', hex: 'green' }] }, staff);
    expect(bad.status).toBe(422);
    // and the presets are not editable through the owner-only settings endpoint
    expect((await call('PUT', '/admin/settings/catalog', next)).status).toBe(404);
  });
});
