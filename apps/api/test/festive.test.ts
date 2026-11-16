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

  it('switches between the Ramzan and Bakrid themes, keeping each theme options', async () => {
    const themes = { ramzan: { lanterns: false, greetingDay: '2027-03-10' }, bakrid: { sparkle: 'off', sealText: 'Perunnal Edit' } };
    expect((await call('PUT', '/admin/settings/festive', { theme: 'ramzan', themes })).status).toBe(200);
    expect((await call('GET', '/settings/public')).json.festive).toMatchObject({
      theme: 'ramzan', options: { sparkle: 'glow', lights: true, lanterns: false, seal: true, sealText: 'The Festive Edit', greetingDay: '2027-03-10', greetingText: 'Eid Mubarak' },
    });
    await call('PUT', '/admin/settings/festive', { theme: 'bakrid', themes });
    expect((await call('GET', '/settings/public')).json.festive).toMatchObject({ theme: 'bakrid', options: { sparkle: 'off', toran: true, medallions: true, sealText: 'Perunnal Edit' } });
    const saved = (await call('GET', '/admin/settings')).json.settings.festive;
    expect(saved.themes.ramzan.lanterns).toBe(false);
    expect(saved.themes.christmas.garland).toBe(true);
    expect((await call('PUT', '/admin/settings/festive', { theme: 'bakrid', themes: { bakrid: { greetingDay: '10 March' } } })).status).toBe(422);
    expect((await call('PUT', '/admin/settings/festive', { theme: 'diwali' })).status).toBe(422);
  });

  it('switches on the Onam, Vishu and national-day themes with their defaults', async () => {
    for (const [theme, opts] of [
      ['onam', { sparkle: 'petals', thoranam: true, flowers: true, sealText: 'The Harvest Edit', greetingText: 'Happy Onam' }],
      ['vishu', { sparkle: 'petals', branch: true, blossoms: true, sealText: 'The Golden Edit', greetingText: 'Happy Vishu' }],
      ['india', { sparkle: 'petals', bunting: true, kites: true, sealText: 'Celebrating India', dayGreeting: true }],
    ] as const) {
      expect((await call('PUT', '/admin/settings/festive', { theme })).status).toBe(200);
      expect((await call('GET', '/settings/public')).json.festive).toMatchObject({ theme, options: opts });
    }
    await call('PUT', '/admin/settings/festive', { theme: 'india', themes: { india: { kites: false, dayGreeting: false } } });
    expect((await call('GET', '/settings/public')).json.festive.options).toMatchObject({ kites: false, dayGreeting: false, bunting: true });
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
