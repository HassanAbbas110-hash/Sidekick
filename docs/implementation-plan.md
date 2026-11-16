# Sidekick — staged implementation plan

Stages follow spec §18. A stage does not start until the previous gate is reviewed. Labels follow spec §20.

## Stage 0 — design and feasibility (current)
- [x] Project folder `C:\Users\HP\Sidekick`, git `main`
- [x] Spec, README, architecture, plan, acceptance matrix
- [x] Logo concept (`brand/`) — proposed, not yet approved
- [x] GitHub repo `Sidekick`, `origin` connected, push verified by ls-remote readback
- [ ] Hassan approves architecture + privacy option (architecture.md §3)
- [ ] Supabase project (free) + Firebase project (FCM) created by Hassan
- [ ] Proofs 1–4 (architecture.md §7)

## Stage 1 — secure vertical slice
App shell (Vite/React/Capacitor), invite-only auth, shared/private spaces, client record, note, task assignment, evidence file, outbox sync, conflict rows, inbox + push, deletion request/approval. Demonstrated on two identities across two devices.

## Stage 2 — complete organisation
File library, versioning, selective offline, quick capture, search, pipeline, templates, dependencies, comments, change requests, CSV/folder import with preview and rollback.

## Stage 3 — planning, money, study
Calendar and recurrence, package snapshots, payment ledger, reminders, renewals/marketing, focus timer, Busy/session projections, redacted deletion notices, weekly review.

## Stage 4 — reliability and real-device acceptance
Backup and restore drill, exports, security tests, notification matrix, APK update/migration, quota errors, scale profiling.

## Stage 5 — visual polish · Stage 6 — optional AI
