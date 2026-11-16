# Sidekick — acceptance matrix

Status labels: Not started · Implemented · Automated-test verified · Real-browser verified · Real-Android verified · Blocked · Accepted by owner.

| ID | Requirement (spec §19) | Stage | Code area | Tests | Evidence | Status |
|---|---|---|---|---|---|---|
| A1 | Invite-only identity, per-user read state | 1 | supabase/migrations/0001_core.sql (handle_new_user) | tests/privacy.test.ts, tests/live/privacy-live.sql | npm test; npm run test:live (2026-11-16, 18/18) | Automated-test verified + live Supabase verified (DB level) (invite gate only; read state not built; PGlite stand-in) |
| A2 | Shared task visible to both with actor | 1 | items, sync, src/ui/Workspace.tsx | tests/sync.test.ts, tests/live/privacy-live.sql | npm test; test:live; Hassan's two-account browser test 2026-11-16 (assign → other account sees it → status change syncs back) | Real-browser verified (laptop browser; Android not yet) |
| A3 | Private access rejected via id/API/search/export | 1 | RLS, src/crypto/vault.ts | tests/privacy.test.ts, tests/vault.test.ts, tests/live/privacy-live.sql | npm test; npm run test:live (2026-11-16, 18/18) | Automated-test verified + live Supabase verified (DB level) for rows by id + encryption; search/export/files not built |
| A4 | Busy/session projections leak nothing | 3 | busy_slots() | tests/privacy.test.ts, tests/live/privacy-live.sql | npm test; npm run test:live (2026-11-16, 18/18) | Automated-test verified + live Supabase verified (DB level) (Busy only; session summaries and push payloads not built) |
| A5 | Shared deletion needs Hassan, revalidated | 1 | items_guard, decide_deletion | tests/privacy.test.ts, tests/live/privacy-live.sql | npm test; npm run test:live (2026-11-16, 18/18) | Automated-test verified + live Supabase verified (DB level) (DB level; revision purge and folder cascade not built) |
| A6 | Redacted private-deletion notice | 3 | notify_private_deletion | tests/privacy.test.ts, tests/live/privacy-live.sql | npm test; npm run test:live (2026-11-16, 18/18) | Automated-test verified + live Supabase verified (DB level) (DB level; onboarding explanation not built) |
| A7 | Notification matrix on real phones | 1/4 | push, inbox | — | — | Not started |
| A8 | Reminder edits cancel stale sends; no duplicates | 3 | reminders | — | — | Not started |
| A9 | Offline replay exactly once; conflicts preserved | 1 | src/sync/outbox.ts, apply_op | tests/sync.test.ts, tests/live/privacy-live.sql | npm test; npm run test:live (2026-11-16, 18/18) | Automated-test verified + live Supabase verified (DB level) (simulated IndexedDB; no real device restart yet; logout flow not built) |
| A10 | Ledger R1700/R500/R200/reversal | 3 | money | — | — | Not started |
| A11 | Recurrence periods, month-end, timezone | 3 | recurrence | — | — | Not started |
| A12 | File upload/version/link/offline/trash/export | 2 | files | — | — | Not started |
| A13 | Timer survives restart, no double-count | 3 | timer | — | — | Not started |
| A14 | Reports/search match accessible records | 2/3 | search, reports | — | — | Not started |
| A15 | Backup restore into isolated env | 4 | backup | — | — | Not started |
| A16 | Signed APK update keeps data | 4 | android | — | — | Not started |
| A17 | Quota/unavailable states, no silent billing | 4 | errors | — | — | Not started |
| A18 | Keyboard/touch, focus, contrast, no leaks | 1–5 | ui | — | — | Not started |
| S0-GIT | GitHub repo connected and push verified | 0 | — | git ls-remote origin | remote main = 390482b | Implemented (verified) |
| S0-LOGO | Logo concept | 0 | brand/ | — | brand/logo-sheet.png | Implemented (unapproved) |
| S0-SUPA | Sidekick Supabase project, schema applied | 0 | supabase/ | npm run test:live | ref acpyiscfzjsnvpxtukge, eu-west-3 | Implemented (verified) |
| S1-SHELL | Browser app shell signs in against real Supabase | 1 | src/ui/SignIn.tsx | manual Playwright check | wrong-password error shown, 2026-11-16 | Real-browser verified (sign-in error path only) |
| S1-APK | Signed APK build pipeline | 1 | .github/workflows/android.yml, android/ | CI run | — | Implemented (not yet run) |
