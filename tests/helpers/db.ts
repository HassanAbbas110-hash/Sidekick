// Throwaway in-memory Postgres (PGlite) with stand-ins for Supabase's auth schema and roles.
// Not the same as hosted Supabase: auth.uid() reads a session setting, and auth.users is a fixture table.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

export const HASSAN = '00000000-0000-4000-8000-000000000001';
export const MARKETER = '00000000-0000-4000-8000-000000000002';
export const STRANGER = '00000000-0000-4000-8000-000000000003';
export const SHARED = '10000000-0000-4000-8000-000000000001';
export const HASSAN_PRIVATE = '10000000-0000-4000-8000-000000000002';
export const MARKETER_PRIVATE = '10000000-0000-4000-8000-000000000003';

const migrations = new URL('../../supabase/migrations/', import.meta.url);

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text not null);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, migrations), 'utf8'));
  }
  // Fictional test identities only.
  await db.exec(`
    insert into invites values ('hassan@example.test', 'owner'), ('marketer@example.test', 'member');
    insert into auth.users values ('${HASSAN}', 'hassan@example.test'), ('${MARKETER}', 'Marketer@Example.test');
    insert into spaces (id, name, visibility, owner_id, created_by) values
      ('${SHARED}', 'WebRift', 'shared', null, '${HASSAN}'),
      ('${HASSAN_PRIVATE}', 'enc:hassan-private', 'private', '${HASSAN}', '${HASSAN}'),
      ('${MARKETER_PRIVATE}', 'enc:marketer-private', 'private', '${MARKETER}', '${MARKETER}');
  `);
  return db;
}

/** Run one statement as a signed-in user, with RLS applied exactly as for the app. */
export async function as<T = Record<string, unknown>>(db: PGlite, user: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function newItem(db: PGlite, user: string, space: string, fields: Record<string, string> = {}) {
  const [row] = await as<{ id: string }>(db, user,
    `insert into items (space_id, kind, title, body, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6) returning id`,
    [space, fields.kind ?? 'note', fields.title ?? null, fields.body ?? null, fields.starts_at ?? null, fields.ends_at ?? null]);
  return row.id;
}
