import { supabase } from './supabase.ts';
import type { Op, OpResult } from '../sync/outbox.ts';

export type Space = { id: string; name: string; visibility: 'shared' | 'private'; owner_id: string | null };
export type Item = {
  id: string; space_id: string; kind: string; title: string | null; body: string | null;
  version: number; created_by: string; updated_at: string;
};
export type Profile = { id: string; email: string; role: 'owner' | 'member'; display_name: string | null };

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadProfiles = async () => check(await supabase.from('profiles').select('id, email, role, display_name')) as Profile[];

export const loadSpaces = async () =>
  check(await supabase.from('spaces').select('id, name, visibility, owner_id').order('name')) as Space[];

// shortcut: newest 200 only; Stage 2 adds pagination and search.
export const loadItems = async (spaceId: string) =>
  check(await supabase.from('items')
    .select('id, space_id, kind, title, body, version, created_by, updated_at')
    .eq('space_id', spaceId).is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(200)) as Item[];

/** Spaces are created online only for now; visibility is fixed at creation by the database. */
export async function createSharedSpace(name: string, userId: string) {
  check(await supabase.from('spaces').insert({ name, visibility: 'shared', created_by: userId }));
}

/** Sends one queued op. Throws on network failure or server rejection, so the outbox keeps it. */
export async function sendOp(op: Op): Promise<OpResult> {
  return check(await supabase.rpc('apply_op', { op })) as OpResult;
}
