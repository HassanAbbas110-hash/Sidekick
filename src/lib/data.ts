import { supabase } from './supabase.ts';
import type { Remote } from './keystore.ts';
import type { WrappedKey } from '../crypto/vault.ts';
import { openText, sealText } from '../crypto/vault.ts';
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

// ---------- deletion lifecycle (online-only, authoritative on the server) ----------
export type DeletionRequest = {
  id: string; item_id: string; item_version: number; reason: string; requested_by: string; status: string;
  action: 'delete' | 'restore'; created_at: string; items: { title: string | null; kind: string; space_id: string } | null;
};
export type TrashedItem = { id: string; kind: string; title: string | null; body: string | null; version: number; deleted_at: string; created_by: string };

export async function loadRequests(spaceId: string) {
  const rows = check(await supabase.from('deletion_requests')
    .select('id, item_id, item_version, reason, requested_by, status, action, created_at, items(title, kind, space_id)')
    .eq('status', 'pending').order('created_at')) as unknown as DeletionRequest[];
  return rows.filter((r) => r.items?.space_id === spaceId);
}

export const loadTrash = async (spaceId: string) =>
  check(await supabase.from('items').select('id, kind, title, body, version, deleted_at, created_by')
    .eq('space_id', spaceId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })) as TrashedItem[];

export async function requestDeletion(itemId: string, version: number, reason: string, action: 'delete' | 'restore', userId: string) {
  check(await supabase.from('deletion_requests').insert({ item_id: itemId, item_version: version, reason, action, requested_by: userId }));
}

export const decideRequest = async (id: string, approve: boolean) =>
  check(await supabase.rpc('decide_deletion', { p_request: id, p_approve: approve })) as 'approved' | 'rejected' | 'stale';

export async function trashItem(id: string) { check(await supabase.rpc('trash_item', { p_item: id })); }
export async function purgeItem(id: string) { check(await supabase.rpc('purge_item', { p_item: id, p_confirm: 'DELETE' })); }
/** Hassan restoring directly from the trash (the database allows this for the owner only). */
export async function restoreItem(id: string) { check(await supabase.from('items').update({ deleted_at: null }).eq('id', id)); }

// ---------- calendar and focus ----------
export type CalEvent = {
  id: string; space_id: string; kind: string; title: string | null; body: string | null; starts_at: string; ends_at: string;
  all_day: boolean; recur: import('./recur.ts').Recur | null; task_id: string | null; version: number; created_by: string;
};
export type DueTask = { id: string; space_id: string; title: string | null; due_at: string; assignee: string | null; status: TaskStatus | null };
export type BusySlot = { user_id: string; starts_at: string; ends_at: string; all_day: boolean; recur: import('./recur.ts').Recur | null };
export type FocusSummary = { user_id: string; day: string; measured_seconds: number; adjusted_seconds: number; sessions: number; completed: number; running: boolean };
export type FocusSession = { id: string; mode: string; started_at: string; ended_at: string | null; paused_seconds: number; completed: boolean | null; adjust_seconds: number; adjust_reason: string | null };

export async function loadCalendar(from: Date, to: Date) {
  const f = from.toISOString(), t = to.toISOString();
  const [ev, rec, due, busy] = await Promise.all([
    supabase.from('items').select('id, space_id, kind, title, body, starts_at, ends_at, all_day, recur, task_id, version, created_by')
      .eq('kind', 'event').is('deleted_at', null).is('recur', null).lt('starts_at', t).gt('ends_at', f),
    supabase.from('items').select('id, space_id, kind, title, body, starts_at, ends_at, all_day, recur, task_id, version, created_by')
      .eq('kind', 'event').is('deleted_at', null).not('recur', 'is', null).lt('starts_at', t),
    supabase.from('items').select('id, space_id, title, due_at, assignee, status').eq('kind', 'task').is('deleted_at', null).gte('due_at', f).lt('due_at', t),
    supabase.rpc('busy_slots', { p_from: f, p_to: t }),
  ]);
  const recurring = check(rec) as CalEvent[];
  const skips = recurring.length
    ? check(await supabase.from('event_exceptions').select('item_id, occurrence_start').in('item_id', recurring.map((r) => r.id))) as { item_id: string; occurrence_start: string }[]
    : [];
  return { events: [...(check(ev) as CalEvent[]), ...recurring], due: check(due) as DueTask[], busy: check(busy) as BusySlot[], skips };
}

export async function skipOccurrence(itemId: string, occurrenceStart: string, userId: string) {
  check(await supabase.from('event_exceptions').insert({ item_id: itemId, occurrence_start: occurrenceStart, created_by: userId }));
}

export const loadFocusSummaries = async (fromDay: string, toDay: string) =>
  check(await supabase.rpc('focus_summaries', { p_from: fromDay, p_to: toDay })) as FocusSummary[];

export const loadMySessions = async (sinceIso: string) =>
  check(await supabase.from('focus_sessions').select('id, mode, started_at, ended_at, paused_seconds, completed, adjust_seconds, adjust_reason')
    .gte('started_at', sinceIso).order('started_at', { ascending: false })) as FocusSession[];

// ---------- private area ----------

export const vaultRemote = (userId: string): Remote => ({
  get: async () => {
    const rows = check(await supabase.from('vaults').select('by_passphrase, by_recovery').eq('user_id', userId)) as { by_passphrase: WrappedKey; by_recovery: WrappedKey }[];
    return rows[0] ?? null;
  },
  create: async (p, r) => { check(await supabase.from('vaults').insert({ user_id: userId, by_passphrase: p, by_recovery: r })); },
  setPassphraseWrapper: async (p) => { check(await supabase.from('vaults').update({ by_passphrase: p }).eq('user_id', userId)); },
});

/** Private space: the name is encrypted on this device, bound to the space id. */
export async function createPrivateSpace(userId: string, key: CryptoKey, name: string) {
  const id = crypto.randomUUID();
  check(await supabase.from('spaces').insert({ id, name: await sealText(key, name, id, 'name'), visibility: 'private', owner_id: userId, created_by: userId }));
  return id;
}

/** Decrypt a private field; plain text (shared items) passes through unchanged. */
export async function reveal(key: CryptoKey | null, value: string | null, id: string, field: string): Promise<string | null> {
  if (!value || !value.startsWith('enc1:')) return value;
  if (!key) return null;
  try { return await openText(key, value, id, field); } catch { return null; }
}

export const hide = (key: CryptoKey, value: string | null, id: string, field: string) =>
  value ? sealText(key, value, id, field) : Promise.resolve(null);

export type PrivacyNotice = { id: string; actor: string; category: string; action: 'trashed' | 'deleted'; at: string };
export const loadPrivacyNotices = async () =>
  check(await supabase.from('private_deletion_notices').select('id, actor, category, action, at').order('at', { ascending: false }).limit(50)) as PrivacyNotice[];

export async function setPrivateTrashed(id: string, trashed: boolean) {
  check(await supabase.from('items').update({ deleted_at: trashed ? new Date().toISOString() : null }).eq('id', id));
}
export async function deletePrivateForGood(id: string) { check(await supabase.from('items').delete().eq('id', id)); }
export const loadPrivateTrash = async (spaceId: string) =>
  check(await supabase.from('items').select('id, kind, title, deleted_at').eq('space_id', spaceId).not('deleted_at', 'is', null)) as { id: string; kind: string; title: string | null; deleted_at: string }[];
