# Sidekick

A private, offline-capable organiser for Hassan and his marketer: shared business work (WebRift, 7 Waves planning), private personal work, and study. Browser on laptop, signed APK on Android.

**Status: early Stage 1.** Database rules, sync outbox and on-device encryption are tested. A first app shell exists: sign in, shared spaces, notes and tasks saved through the outbox. Nothing is deployed, and no APK has been built or installed on a phone yet.

## Run the app (laptop)
```bash
cp .env.example .env   # then fill in the project URL and publishable key
npm install
npm run dev
```

## Run the tests
Needs Node 24+.

```bash
npm install
npm test
```

The database tests run on PGlite (in-memory Postgres) with stand-ins for Supabase auth. They touch no real database.

`npm run test:live` repeats the key checks on the linked Supabase project inside one transaction that is always rolled back. It needs `npx supabase login` and `npx supabase link --project-ref acpyiscfzjsnvpxtukge` first.

- Specification: [docs/specification.md](docs/specification.md)
- Architecture decision (proposed): [docs/architecture.md](docs/architecture.md)
- Plan: [docs/implementation-plan.md](docs/implementation-plan.md)
- Acceptance matrix: [docs/acceptance-matrix.md](docs/acceptance-matrix.md)
- Brand (proposed logo): [brand/](brand/) — gold and ivory halves of one "S": two people, one shared workspace.

## Rules for this repo
- Never commit secrets, keystores, `.env`, local databases, uploads or client data.
- Work on task branches; `main` stays reviewable.
- This repo is separate from WebRift, 7 Waves and Google Reviewer Management.

## Changelog
- 0.1.1 (2026-11-16) — Private area: on-device encryption, passphrase + recovery key, private tasks/notes/events, redacted deletion notices; 82 tests, 31 live checks.
- 0.1.0 (2026-11-16) — Calendar (repeats, deadlines vs work time, partner Busy) and focus timer (alarms, overlap-safe totals); 76 tests.
- 0.0.9 (2026-11-16) — Files and photos: versions, verified uploads, upload queue, links, offline keep; 59 tests, 29 live checks.
- 0.0.8 (2026-11-16) — Deletion approvals: requests, decision panel, trash, restore, permanent deletion; 50 tests.
- 0.0.7 (2026-11-16) — Clients, lead pipeline and money ledger (charges, payments, reversals, agreements, monthly charges); 44 tests, 22 live checks.
- 0.0.6 (2026-11-16) — Redesign: two-lane "your side / their side" workspace, handover, inbox drawer, new sign-in; bundled font.
- 0.0.5 (2026-11-16) — Inbox, push queue, send-push function (FCM), every-minute schedule; 34 tests.
- 0.0.4 (2026-11-16) — Task assignment/status/due date, offline reading cache, explicit-only DB grants; 25 tests.
- 0.0.3 (2026-11-16) — App shell (sign-in, shared spaces, notes/tasks via outbox), Capacitor Android project, icon/splash, APK workflow.
- 0.0.2 (2026-11-16) — Core schema with RLS, idempotent sync, outbox, on-device encryption; 21 tests.
- 0.0.1 (2026-11-16) — Project created; Stage 0 docs; proposed logo.
