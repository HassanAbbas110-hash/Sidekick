import { supabase } from './supabase.ts';
import type { Op, OpResult } from '../sync/outbox.ts';

export type Space = { id: string; name: string; visibility: 'shared' | 'private'; owner_id: string | null };
export type Item = {
  id: string; space_id: string; kind: string; title: string | null; body: string | null;
  version: number; created_by: string; updated_at: string;
  assignee: string | null; status: TaskStatus | null; due_at: string | null;
};
export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'done';
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
    .select('id, space_id, kind, title, body, version, created_by, updated_at, assignee, status, due_at')
    .eq('space_id', spaceId).is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(200)) as Item[];

/** Spaces are created online only for now; visibility is fixed at creation by the database. */
export async function createSharedSpace(name: string, userId: string) {
  check(await supabase.from('spaces').insert({ name, visibility: 'shared', created_by: userId }));
}

/** Sends one queued op. Throws on network failure or server rejection, so the outbox keeps it. */
export async function sendOp(op: Op): Promise<OpResult> {
  if (op.type === 'call') {
    return { status: 'called', result: check(await supabase.rpc(op.fn, { p_op_id: op.op_id, ...op.args })) };
  }
  return check(await supabase.rpc('apply_op', { op })) as OpResult;
}

export type Notification = { id: string; kind: string; title: string; body: string | null; item_id: string | null; created_at: string; read_at: string | null };

// shortcut: newest 50; older history stays in the database (no automatic deletion).
export const loadInbox = async () =>
  check(await supabase.from('notifications').select('id, kind, title, body, item_id, created_at, read_at')
    .order('created_at', { ascending: false }).limit(50)) as Notification[];

export async function markRead(ids: string[]) {
  if (ids.length) check(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null));
}

// ---------- clients and money ----------
export type Stage = 'approached' | 'discussion' | 'proposal' | 'client' | 'paused' | 'lost' | 'archived';
export type Client = {
  id: string; space_id: string; name: string; contact_name: string | null; email: string | null; phone: string | null;
  website: string | null; location: string | null; stage: Stage; responsible: string | null; follow_up_on: string | null;
  notes: string | null; version: number; created_by: string; updated_at: string;
};
export type Balance = { client_id: string; currency: string; charged_minor: number; paid_minor: number; outstanding_minor: number; overdue_minor: number };
export type Charge = {
  id: string; client_id: string; agreement_id: string | null; description: string; amount_minor: number; currency: string;
  due_on: string; paid_minor: number; outstanding_minor: number; state: 'paid' | 'due' | 'overdue'; created_by: string | null;
};
export type Payment = {
  id: string; client_id: string; amount_minor: number; currency: string; received_on: string; method: string | null;
  reference: string | null; note: string | null; recorded_by: string; recorded_at: string; reversed: boolean;
  reversal_reason: string | null; reversed_by: string | null; allocated_minor: number;
};
export type Agreement = {
  id: string; title: string; inclusions: string | null; currency: string; price_minor: number; deposit_minor: number;
  billing: 'once' | 'monthly'; starts_on: string; ends_on: string | null; created_by: string | null;
};
export type ClientMoney = { charges: Charge[]; payments: Payment[]; agreements: Agreement[] };

const CLIENT_COLS = 'id, space_id, name, contact_name, email, phone, website, location, stage, responsible, follow_up_on, notes, version, created_by, updated_at';

export const loadClients = async (spaceId: string) =>
  check(await supabase.from('clients').select(CLIENT_COLS).eq('space_id', spaceId).order('name')) as Client[];

export const loadBalances = async (clientIds: string[]) =>
  clientIds.length ? check(await supabase.from('client_balances').select('*').in('client_id', clientIds)) as Balance[] : [];

export async function loadClientMoney(clientId: string): Promise<ClientMoney> {
  const [charges, payments, agreements] = await Promise.all([
    supabase.from('charge_balances').select('*').eq('client_id', clientId).order('due_on'),
    supabase.from('payment_ledger').select('*').eq('client_id', clientId).order('received_on', { ascending: false }),
    supabase.from('agreements').select('id, title, inclusions, currency, price_minor, deposit_minor, billing, starts_on, ends_on, created_by').eq('client_id', clientId).order('starts_on'),
  ]);
  return { charges: check(charges) as Charge[], payments: check(payments) as Payment[], agreements: check(agreements) as Agreement[] };
}

export async function createClient(spaceId: string, userId: string, f: Partial<Client>) {
  return (check(await supabase.from('clients').insert({ ...f, space_id: spaceId, created_by: userId }).select(CLIENT_COLS).single())) as Client;
}

/** Saves only if nobody changed the client since `version`; otherwise returns null so the screen can show the conflict. */
export async function updateClient(c: Client, f: Partial<Client>): Promise<Client | null> {
  const rows = check(await supabase.from('clients').update(f).eq('id', c.id).eq('version', c.version).select(CLIENT_COLS)) as Client[];
  return rows[0] ?? null;
}
