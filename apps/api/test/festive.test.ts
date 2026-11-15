import { beforeEach, describe, expect, it } from 'vitest';
import { call, seedBasics } from './helpers.ts';

beforeEach(seedBasics);
const day = 864e5;

describe('festive themes', () => {
  it('switches the Christmas theme on and off for the website, with its options', async () => {
    expect((await call('GET', '/settings/public')).json.festive).toBeNull();
    const on = await call('PUT', '/admin/settings/festive', { theme: 'christmas', themes: { christmas: { sparkle: 'snow', stars: false, sealText: 'Winter Edit' } } });
    expect(on.status).toBe(200);
    expect((await call('GET', '/settings/public')).json.festive).toMatchObject({ theme: 'christmas', options: { sparkle: 'snow', stars: false, garland: true, sealText: 'Winter Edit', sealLink: '/shop' } });
    await call('PUT', '/admin/settings/festive', { theme: null, themes: { christmas: { sparkle: 'snow' } } });
    expect((await call('GET', '/settings/public')).json.festive).toBeNull();
  });

  it('respects the schedule and only the owner can change it', async () => {
    const later = { theme: 'christmas', startsAt: new Date(Date.now() + day).toISOString(), endsAt: new Date(Date.now() + 9 * day).toISOString() };
    expect((await call('PUT', '/admin/settings/festive', later)).status).toBe(200);
    expect((await call('GET', '/settings/public')).json.festive).toBeNull();
    const now = { theme: 'christmas', startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + day).toISOString() };
    await call('PUT', '/admin/settings/festive', now);
    expect((await call('GET', '/settings/public')).json.festive?.theme).toBe('christmas');
    const bad = await call('PUT', '/admin/settings/festive', { ...now, endsAt: now.startsAt });
    expect(bad.status).toBe(422);
    expect((await call('PUT', '/admin/settings/festive', { theme: null }, { 'X-Dev-User': 'staff@test.local' })).status).toBe(403);
  });
});
