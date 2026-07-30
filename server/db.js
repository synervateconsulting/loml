import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add a Postgres database to the Railway project.');
  process.exit(1);
}

const needsSsl = !/localhost|127\.0\.0\.1|\.railway\.internal/.test(process.env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 5,
});

export const query = (text, params) => pool.query(text, params);

export function hashKey(key, salt) {
  return crypto.scryptSync(key.trim(), salt, 64).toString('hex');
}

export function keyMatches(key, hash, salt) {
  const candidate = Buffer.from(hashKey(key, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

async function seedUser(slug, displayName, accessKey) {
  if (!accessKey) {
    console.error(`Missing access key for "${slug}". Set it in the Railway variables.`);
    process.exit(1);
  }
  const salt = crypto.createHash('sha256').update(`loml:${slug}`).digest('hex').slice(0, 32);
  const hash = hashKey(accessKey, salt);
  await query(
    `INSERT INTO app_user (slug, display_name, key_hash, key_salt)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           key_hash = EXCLUDED.key_hash,
           key_salt = EXCLUDED.key_salt`,
    [slug, displayName, hash, salt]
  );
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(sql);
  await seedUser('zak', process.env.USER_A_NAME || 'Zak', process.env.USER_A_ACCESS_KEY);
  await seedUser('freddie', process.env.USER_B_NAME || 'Freddie', process.env.USER_B_ACCESS_KEY);
  console.log('Database ready.');
}

export async function logActivity(actorId, action, entityKind, entityId, detail = null) {
  await query(
    `INSERT INTO activity_log (actor_id, action, entity_kind, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, entityKind, String(entityId), detail]
  );
}
