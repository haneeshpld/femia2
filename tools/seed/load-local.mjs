// Resets the LOCAL dev database + R2 and loads the dev seed. Never touches remote resources.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';

const ROOT = new URL('../../', import.meta.url).pathname;
const API = join(ROOT, 'apps/api');
const STATE = join(ROOT, '.wrangler/state');
const run = (cmd) => execSync(cmd, { cwd: API, stdio: 'inherit' });

rmSync(join(STATE, 'v3/d1'), { recursive: true, force: true });
rmSync(join(STATE, 'v3/r2'), { recursive: true, force: true });
run(`npx wrangler d1 migrations apply DB --local --persist-to ${STATE}`);
run(`npx wrangler d1 execute DB --local --persist-to ${STATE} --file seed/dev.sql`);

const proxy = await getPlatformProxy({ configPath: join(API, 'wrangler.jsonc'), persist: { path: join(STATE, 'v3') } });
const media = join(ROOT, '.seed/media');
let n = 0;
for (const id of readdirSync(media)) {
  for (const f of readdirSync(join(media, id))) {
    await proxy.env.MEDIA.put(`seed/${id}/${f}`, readFileSync(join(media, id, f)), { httpMetadata: { contentType: 'image/webp' } });
    n++;
  }
}
await proxy.dispose();
console.log(`loaded ${n} seed images into local R2`);
