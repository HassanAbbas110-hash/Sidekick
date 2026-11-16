# Sidekick — architecture decision (Stage 0, proposed)

Status: **Proposed, awaiting Hassan's approval.** Nothing below is built or verified yet. Prices and free-tier limits must be rechecked against official pages before any account is created (spec §3, §16).

## 1. Decision

**Candidate A: one shared web UI, packaged for Android with Capacitor, plus browser deployment.**

| Layer | Choice | Why |
|---|---|---|
| UI | React + TypeScript + Vite single-page app | Same language/tooling as WebRift and 7 Waves, so one maintainer skill set. Static output, so it can be bundled *inside* the APK. |
| Android | Capacitor (bundled web assets, not a remote URL) | App opens and works with no network. Gives native push (FCM), local notifications, camera/file picker, and a normal Gradle signed-release build. |
| Browser | Same build as static hosting (Vercel or similar free static tier) | Laptop needs no executable (spec §1). |
| Local store | IndexedDB (Dexie) on both browser and Android WebView, with `navigator.storage.persist()` | One code path. Holds records, the durable outbox and downloaded file bytes. Upgrade to Capacitor SQLite only if WebView storage eviction appears in device tests. |
| Backend | Supabase: Postgres + Row Level Security, Auth, Storage (private buckets), Edge Functions, pg_cron | Hassan already runs Supabase for 7 Waves. Real database rules enforce privacy server-side. Cron + functions send reminders without the laptop being awake. |
| Push | FCM HTTP v1 sent only from an Edge Function. The service-account key is a server secret, never in the app. | Spec §11: no sending credentials on devices. |
| Files | Supabase Storage private buckets, one path prefix per owner/space, signed short-lived URLs | No "anyone with link" files. Google Drive is deferred (see §6). |

### Why not Candidate B (Flutter or similar)
It would mean a second language (Dart) and a second UI codebase culture, with no existing project to share skills with. Its offline and push story is not meaningfully better than Capacitor's for this app.

### Why not the 7 Waves APK pattern
The 7 Waves staff APK is a WebView that loads a remote site. The spec (§3) says that is **not** an offline app. Sidekick bundles its UI inside the APK and keeps its data locally.

### Why not Next.js
Capacitor needs a static bundle, and offline-first work happens in the client anyway. Server rendering adds nothing here and complicates the APK build.

## 2. Data model (outline)

- `profiles` (2 invited users; `role` = owner | member). `invites` allowlist; sign-up is rejected unless the email is on it (enforced in a DB trigger, not the UI).
- `spaces` (`visibility` = shared | private, `owner_id` for private). `sections` → `items` (`kind`: note, task, file, event, client, project, link, evidence, tracker).
- `item_versions` (append-only revisions; original bytes/content kept), `audit_log` (append-only; no UPDATE/DELETE grants).
- `deletion_requests` (target, target_version, reason, status). Approval checks the current version; a mismatch forces re-approval.
- Money: `charges`, `payments`, `allocations`, `adjustments`. Amounts are `bigint` minor units + `currency` char(3). Balances are a **view** over the ledger, never a stored editable number.
- `busy_projections` and `session_summaries`: separate tables written by trigger from private events and timer sessions. They hold only owner, start/end, duration and completion. They contain **no private IDs**, so they cannot be used to look up hidden content.
- `notifications` (inbox: stable id, dedupe key, per-user read/handled state) and `push_attempts`.
- `private_deletion_notices`: actor, fixed category enum (`private_file|private_note|private_task|private_event`), time.

## 3. Privacy enforcement

- Every table has RLS. Private rows: `owner_id = auth.uid()` only, **including for Hassan**. The owner role grants shared-deletion powers, not private reads.
- Search, exports, reports and notification payloads are built by queries that run *as the user*, so RLS applies to them as well.
- Push payloads carry only an inbox id. The app fetches content after opening, with permission re-checked.
- On logout or account switch, the local DB is per-user (`sidekick-<userId>`). Unsynced ops prompt: sync now / keep encrypted for this account / discard (with a list of what is lost).

### Threat model: a decision Hassan must make before real private uploads
Hassan, as owner of the Supabase project, can technically read any row or file through the provider dashboard. RLS stops *app* access, not *infrastructure-admin* access (spec §4).

Options:
1. **Accept admin visibility** and document it to the marketer. This is the simplest option, but private content is then not private from Hassan.
2. **Client-side encryption of private notes and files** (WebCrypto AES-GCM). Each user has a key wrapped by a passphrase only they know. The server stores ciphertext. Trade-off: a lost passphrase means lost data unless that user keeps a recovery key. Server-side search of private content is not possible.

**Decision (Hassan, 2026-11-16): option 2, encrypt on device.** Applies to private note bodies, titles and file bytes. Search of private items is on-device only.

Design to prove in Stage 0:
- Each user generates a random 256-bit data key on first login. It is wrapped by a key derived from their passphrase (PBKDF2-SHA256, high iteration count, or Argon2 if a vetted WASM build is used) and stored server-side only in wrapped form.
- A one-time recovery key is shown to the user at setup for them to keep offline. Without the passphrase or the recovery key, private data is unrecoverable. Neither Hassan nor the server can reset it.
- Ciphertext is AES-256-GCM with a random 96-bit IV per record or file. Record id and version are bound as associated data, so swapping ciphertexts between rows fails to decrypt.
- Metadata that stays visible to the infrastructure owner: private row existence, owner, timestamps, sizes and fixed categories. Busy times and session durations are shared by design anyway.
- Changing the passphrase re-wraps the data key only. It does not re-encrypt the data.
- The marketer's onboarding must explain the recovery-key duty and what metadata remains visible.

## 4. Sync protocol

- Every local change is written to the record **and** to an `outbox` row in one IndexedDB transaction. Each op carries `op_id` (UUID), `entity`, `entity_id`, `base_version`, the changed fields and `device_time`.
- `apply_ops(ops[])` RPC runs with the caller's RLS. It is idempotent: an `op_id` already in `applied_ops` returns its original result. Effects:
  - The row version increments.
  - The server assigns a monotonic `seq`.
  - If a field changed since `base_version` with a different value, a `conflicts` row keeps both candidates. The field is not overwritten.
- Financial ops, deletion approvals and permission changes are **online-only authoritative**. They stay "pending server" until accepted and never show as complete offline.
- Pull: `changes_since(seq)` returns rows the user can see, plus tombstones. Tombstones are kept for 180 days (proposed default). A device that has been offline longer must do a full resync.
- Status labels: local saved → uploading → pending server → synced | conflict | failed. Retries use backoff with a cap, and failure is shown to the user.

## 5. Notifications

- DB trigger → `notifications` row with a `dedupe_key` (unique). This prevents duplicate logical alerts on replay or a second worker.
- Edge Function `send-push` drains pending rows and calls FCM. It records `push_attempts` and never marks anything "read".
- Reminders: `reminders` rows carry a `generation`. Editing a deadline bumps the generation, so stale sends are skipped. pg_cron runs every minute.
- Android local notifications handle on-device timers (focus sessions).

## 6. Storage and cost (to verify; not yet checked against current official pages)

| Item | Plan | Risk |
|---|---|---|
| Supabase free tier | DB, auth, storage, functions, cron | Free projects pause after inactivity, and storage/DB caps are small. **No automated backups on free.** We need our own export/backup job (Stage 4). |
| File bytes at scale | Start in Supabase Storage. Revisit Google Drive (Hassan reports ~5 TB, unverified) as a per-user storage provider later. | Drive needs OAuth scopes, quota checks and missing-file detection. Provider-side deletion bypasses app approval. |
| Push | FCM, no charge for sending | Needs a Firebase project (Hassan's account). |
| APK build | GitHub Actions (free for private repos within minutes quota), same pattern as 7 Waves | Keystore lives in Hassan's custody plus a GitHub secret only. |
| Hosting | Free static tier | — |

Nothing paid is enabled without Hassan's explicit approval.

## 7. Stage 0 proofs still to run (not done)

1. Capacitor APK that opens offline, edits a note, restarts, and replays the outbox exactly once.
2. FCM push to a real phone with the app swiped away. Record the result per Android state.
3. RLS test: user B fetching user A's private row/file by id → rejected (automated SQL test).
4. Signed private-file download via short-lived URL; expired URL rejected.
