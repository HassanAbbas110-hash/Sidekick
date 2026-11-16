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
- 0.0.5 (2026-11-16) — Inbox, push queue, send-push function (FCM), every-minute schedule; 34 tests.
- 0.0.4 (2026-11-16) — Task assignment/status/due date, offline reading cache, explicit-only DB grants; 25 tests.
- 0.0.3 (2026-11-16) — App shell (sign-in, shared spaces, notes/tasks via outbox), Capacitor Android project, icon/splash, APK workflow.
- 0.0.2 (2026-11-16) — Core schema with RLS, idempotent sync, outbox, on-device encryption; 21 tests.
- 0.0.1 (2026-11-16) — Project created; Stage 0 docs; proposed logo.
