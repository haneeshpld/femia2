import { homeSections, type Category, type MediaRef, type PublicSettings } from '@femia/contracts';
import type { PublishedContent } from '@femia/sdk';
import { api } from './api.ts';

export interface SiteData {
  content: Record<string, any>;
  media: Record<string, MediaRef>;
  settings: PublicSettings;
}

/** Published content + public settings, fetched once per request (cached at the API for 60s). */
export async function getSiteData(): Promise<SiteData> {
  const [published, settings] = await Promise.all([api().content.published(), api().settings.public()]);
  const p = published as PublishedContent | null;
  return { content: p?.data ?? {}, media: p?.media ?? {}, settings };
}

/** What every page needs for header/footer, fetched in parallel. */
export async function getCommon(): Promise<{ site: SiteData; categories: Category[] }> {
  const [site, categories] = await Promise.all([getSiteData(), api().catalog.categories()]);
  return { site, categories };
}

/** The home page's hero section (wherever the owner's section list keeps it), with its resolved image. */
export function heroOf(site: SiteData): { data: Record<string, any>; image: MediaRef | null } {
  const s = homeSections(site.content).find((x) => x.type === 'hero');
  return { data: s?.data ?? {}, image: s?.data.image ? site.media[s.data.image] ?? null : null };
}
