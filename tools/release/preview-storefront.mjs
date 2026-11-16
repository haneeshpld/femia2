// Deploy the current storefront as a separate preview Worker, beside production, for side-by-side design reviews.
// It shares production's API (service binding) and therefore its database and media; production is not touched.
// Usage: node tools/release/preview-storefront.mjs clients/<client>.json [--name=storefront-preview]
// Note: the API only accepts sign-in, checkout and newsletter POSTs from the production storefront's address, so on
// the preview those are blocked (by design); browsing, search, wishlist and the bag work.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadClient, patchStorefrontBuild, ROOT, run, urls, version } from './lib.mjs';

const args = process.argv.slice(2);
const c = loadClient(args.find((a) => a.endsWith('.json')));
const suffix = args.find((a) => a.startsWith('--name='))?.slice(7) ?? 'storefront-preview';
if (!c.workersDev) throw new Error(`${c.__path}: "workersDev" is needed for a preview address`);
const name = `${c.prefix}-${suffix}`;
const url = `https://${name}.${c.workersDev}.workers.dev`;
const v = version();

console.log(`\nPreview storefront for ${c.client}: ${name} (${v})`);
process.env.PUBLIC_SITE_URL = url;
run('npx', ['astro', 'build'], { cwd: join(ROOT, 'apps/storefront') });
// Start from the client's real storefront config (same API binding), then make it a separate, unlisted Worker.
const file = patchStorefrontBuild(c);
const built = JSON.parse(readFileSync(file, 'utf8'));
built.name = name; built.topLevelName = name;
built.workers_dev = true;
delete built.routes;                                   // never claim production's custom domains
built.vars = { ...built.vars, PUBLIC_SITE_URL: url, NOINDEX: '1' };
writeFileSync(file, JSON.stringify(built));
run('npx', ['wrangler', 'deploy', '-c', file, '--message', `preview ${v}`], { client: c, cwd: join(ROOT, 'apps/storefront') });

console.log(`
✓ Preview storefront: ${url}
  Production (unchanged): ${urls(c).store}
  Same API, database and media as production. Sign-in, checkout and newsletter are blocked on the preview.`);
