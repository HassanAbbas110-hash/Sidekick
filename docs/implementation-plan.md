# Sidekick — staged implementation plan

Stages follow spec §18. A stage does not start until the previous gate is reviewed. Labels follow spec §20.

## Stage 0 — design and feasibility (current)
- [x] Project folder `C:\Users\HP\Sidekick`, git `main`
- [x] Spec, README, architecture, plan, acceptance matrix
- [x] Logo concept (`brand/`) — proposed, not yet approved
- [x] GitHub repo `Sidekick`, `origin` connected, push verified by ls-remote readback
- [x] Privacy option chosen: encrypt on device (architecture.md §3)
- [ ] Hassan approves overall architecture
- [x] Supabase project `Sidekick` (free, eu-west-3) created; migration 0001 applied; live checks 18/18
- [ ] Firebase project (FCM) connected
- [ ] Follow-up migration: type the empty arrays in apply_op (lint warning), revoke Supabase's default anon/authenticated table grants so access relies on explicit grants as well as RLS
- [x] Proofs without accounts: DB privacy/deletion rules, outbox exactly-once, on-device encryption (21 automated tests)
- [ ] Proofs needing devices: FCM push to phone, Capacitor offline restart, private file storage

## Stage 1 — secure vertical slice
Progress (2026-11-16):
- [x] App shell: Vite + React + TypeScript, Capacitor Android project (`app.sidekick.organiser`), Sidekick launcher icon and splash
- [x] Sign-in screen against the real Supabase project (wrong password shows a clear error; checked in a real browser)
- [x] Shared spaces list, create shared space, add note/task through the outbox with per-item sync status (code written; **not yet exercised with real accounts**)
- [x] Signed APK builds on GitHub Actions (first green run 2026-11-16). Keystore kept by Hassan at C:\Users\HP\Sidekick-signing (outside the repo) and as a GitHub secret.
- [x] Demo accounts created (owner + member), public sign-up off, invites added. **Demo only: replace with real emails and separate strong passwords before any real data.**
- [x] Migration 0002: task assignee/status/due date, explicit-only grants, lint clean; live checks 18/18 after applying
- [x] Offline reading cache (per account, removed on sign-out) with "saved copy from HH:MM" banner
- [x] Task assignment UI: responsible person, due date (Africa/Johannesburg display), status, My/Their tasks filters, overdue flag
- [x] Inbox + push queue (migration 0003): one row per important shared change for the other person, deduped, private items excluded, per-user read state; device tokens move with sign-in and are removed on sign-out
- [x] send-push Edge Function (FCM HTTP v1, key only in server secrets) deployed; pg_cron runs it every minute while anything is queued (0004); app nudges it after each sync
- [x] App: inbox panel with unread badge, Android push registration and notification channel
- [ ] Hassan: Firebase service-account key into Supabase secrets; google-services.json into GitHub secret; then real-phone notification matrix (A7)
- [x] Visual direction pulled forward at Hassan's request (2026-11-16): "two sides of one S" — gold = you, ivory = your partner, a seam between lanes; tasks live on the side of whoever is responsible and travel across on handover. Bricolage Grotesque bundled for offline use. Dark-first. Checked at 1360px and 390px with fictional data (design-preview.html, dev only); not yet reviewed on Hassan's phone.
- [x] Deletion lifecycle (0006 + screens): ask to delete with reason, Hassan's decision panel, stale-version refusal, trash with restore / ask to restore, permanent deletion only by Hassan from the trash with typed DELETE; content-free purge log; inbox text scrubbed. Online-only by design.
- [ ] Private spaces + vault unlock, comments

App shell (Vite/React/Capacitor), invite-only auth, shared/private spaces, client record, note, task assignment, evidence file, outbox sync, conflict rows, inbox + push, deletion request/approval. Demonstrated on two identities across two devices.

Pulled forward from Stage 2/3 at Hassan's request (2026-11-16):
- [x] Clients and lead pipeline (approached → discussion → proposal → client, paused/lost/archived), contacts, follow-up date, edit history, version-checked edits
- [x] Money ledger: agreements (snapshot of agreed price, deposit, once-off or monthly), charges, payments with oldest-first allocation, reversals with reason; append-only; integer cents; currency per amount, never summed across currencies; op_id idempotency; queued offline through the outbox
- [x] Monthly charges: stable YYYY-MM periods, month-end clamping, daily schedule
- [ ] Package catalogue screen (agreements already snapshot the actual price), payment proof attachments, renewal reminders

## Stage 2 — complete organisation
File library, versioning, selective offline, quick capture, search, pipeline, templates, dependencies, comments, change requests, CSV/folder import with preview and rollback.

## Stage 3 — planning, money, study
Calendar and recurrence, package snapshots, payment ledger, reminders, renewals/marketing, focus timer, Busy/session projections, redacted deletion notices, weekly review.

## Stage 4 — reliability and real-device acceptance
Backup and restore drill, exports, security tests, notification matrix, APK update/migration, quota errors, scale profiling.

## Stage 5 — visual polish · Stage 6 — optional AI
