// One-off backfill: move every attachment still stored as Postgres bytea into
// R2, so all files live in one place. Idempotent — rows already on R2 are
// skipped, so it's safe to re-run. Each row is verified (object size matches the
// bytea length) BEFORE the bytea is cleared. Run: `npm run migrate:r2`.

import { query, pool } from './db.js';
import { r2Enabled, putObject, headObject } from './storage.js';

async function main() {
  if (!r2Enabled()) {
    console.error('R2 is not configured. Set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET.');
    process.exit(1);
  }

  const { rows } = await query(
    "SELECT id FROM attachment WHERE storage = 'db' AND bytes IS NOT NULL ORDER BY created_at"
  );
  console.log(`Migrating ${rows.length} attachment(s) to R2…`);

  let done = 0;
  let failed = 0;
  for (const { id } of rows) {
    try {
      const { rows: br } = await query('SELECT bytes, mime_type FROM attachment WHERE id = $1', [id]);
      const a = br[0];
      if (!a?.bytes) continue; // already cleared by a concurrent/previous run
      const key = `att/${id}/original`;
      await putObject(key, a.bytes, a.mime_type);

      const head = await headObject(key);
      if (!head || head.size !== a.bytes.length) {
        console.error(`  ✗ ${id}: verify failed (R2 ${head?.size ?? 'missing'} vs db ${a.bytes.length}); leaving in db`);
        failed++;
        continue;
      }

      // Verified — point the row at R2 and drop the bytea.
      await query("UPDATE attachment SET storage = 'r2', storage_key = $1, bytes = NULL WHERE id = $2", [key, id]);
      done++;
      console.log(`  ✓ ${done}/${rows.length}  ${id}  (${a.bytes.length} bytes)`);
    } catch (err) {
      console.error(`  ✗ ${id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`Done. migrated=${done} failed=${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
