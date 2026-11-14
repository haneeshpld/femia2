// Turns a nightly backup (R2 backups/YYYY-MM-DD.json.gz) back into SQL you can load into a fresh D1.
// Usage: node tools/restore-backup.mjs backup.json.gz > restore.sql
//        npx wrangler d1 execute DB --remote --file restore.sql   (into an EMPTY, migrated database)
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/restore-backup.mjs <backup.json.gz>'); process.exit(1); }
const dump = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
const q = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const out = ['-- restored from backup ' + dump.createdAt, 'PRAGMA defer_foreign_keys = ON;'];
// Seeded rows from the migration are replaced by the backup's copy.
out.push('DELETE FROM roles;', 'DELETE FROM counters;');
for (const [table, rows] of Object.entries(dump.tables)) {
  for (const r of rows) out.push(`INSERT INTO ${table} (${Object.keys(r).join(', ')}) VALUES (${Object.values(r).map(q).join(', ')});`);
}
console.log(out.join('\n'));
