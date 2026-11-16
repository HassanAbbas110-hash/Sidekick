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
- [x] GitHub Actions workflow for a signed APK (**not yet run**: needs keystore secrets and repository variables)
- [x] Demo accounts created (owner + member), public sign-up off, invites added. **Demo only: replace with real emails and separate strong passwords before any real data.**
- [x] Migration 0002: task assignee/status/due date, explicit-only grants, lint clean; live checks 18/18 after applying
- [x] Offline reading cache (per account, removed on sign-out) with "saved copy from HH:MM" banner
- [x] Task assignment UI: responsible person, due date (Africa/Johannesburg display), status, My/Their tasks filters, overdue flag
- [ ] Private spaces + vault unlock, inbox, push, deletion request/approval UI, comments

App shell (Vite/React/Capacitor), invite-only auth, shared/private spaces, client record, note, task assignment, evidence file, outbox sync, conflict rows, inbox + push, deletion request/approval. Demonstrated on two identities across two devices.

## Stage 2 — complete organisation
File library, versioning, selective offline, quick capture, search, pipeline, templates, dependencies, comments, change requests, CSV/folder import with preview and rollback.

## Stage 3 — planning, money, study
Calendar and recurrence, package snapshots, payment ledger, reminders, renewals/marketing, focus timer, Busy/session projections, redacted deletion notices, weekly review.

## Stage 4 — reliability and real-device acceptance
Backup and restore drill, exports, security tests, notification matrix, APK update/migration, quota errors, scale profiling.

## Stage 5 — visual polish · Stage 6 — optional AI
