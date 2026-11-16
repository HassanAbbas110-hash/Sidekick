# Sidekick — agent build brief, full scope and acceptance contract

Version 1.0 • 16 November 2026 • Owner: Hassan

## 1. Instructions to the implementing agent

Build Sidekick: a flexible organiser for Hassan and his marketer, covering shared business work, private individual work and shared/private studying. This is a NEW project. Do not modify or reuse the Google Reviewer Management repository as its application. That project is separate. No Sidekick repository, backend, provider accounts or deployed application have been established by this specification.

Read this entire document before coding. Deliver functional vertical slices with persisted data and demonstrable behaviour. An attractive mockup, clickable screens, local-only demo data or passing unit tests are not a complete shared product. Clearly distinguish implementation from verified operation on real devices.

The user will bring your implementation, repository changes, screenshots and test results back to a reviewing assistant, which will audit and help correct it. Make that review possible: keep changes versioned, provide test commands, report failures, record assumptions and provide a requirement-to-test matrix. Never report success for a check you could not run. Do not promise zero bugs.

### Confirmed decisions

- Working product name: Sidekick. Domain/trademark/app-name availability has not been checked.
- Two initial users: Hassan and his marketer, each with a distinct identity and login.
- Both can create and edit shared work. Hassan alone controls shared deletion approval and permanent shared deletion.
- Android: downloadable signed APK, installed from a trusted web link. Laptop: browser access; no desktop executable required.
- Shared cloud records, useful offline working, later sync and visible conflicts.
- Flexible spaces/sections for almost any supported information, not a rigid business-only CRM.
- WebRift records include clients, packages, deposits, balances, recurring payment dates, files, tasks and evidence.
- 7 Waves already has its own operations system. Sidekick stores its planning/reference work; it must not duplicate dispatch, order or delivery operations.
- Private study/personal spaces and shared study/work spaces.
- Private scheduled events appear to the other user as Busy, with times only.
- Agreed default: private focus-session duration and completion status are shared, but not subjects, titles, notes or content. Explain this sharing clearly during onboarding; broader sharing always requires an explicit action.
- Transparent private-deletion notices to Hassan contain only actor, broad item category and time.
- Pop-up notifications while the app is closed, plus an in-app notification inbox. No routine email reports.
- Both users receive important shared-work updates, even if only one is assigned the task.
- Weekly reports are available on demand within the app.
- Start using no-cost service allowances where practical. No paid service or automatic paid upgrade without Hassan's explicit approval. A small justified future cost is acceptable; no final monthly cap has been authorised.
- Optional AI later, not a prerequisite for core operation; no paid AI dependency. Do not assume ChatGPT/Claude/Google subscriptions include app API usage.
- Strong visual quality is an eventual requirement. Detailed aesthetic design is deferred until functional foundations are working; clean usable layouts and accessibility are required throughout.

### Proposed implementation defaults, not user-approved details

Defaults in this document make the brief buildable. Mark them in the design and permit Hassan to correct them. They include: ZAR default currency, Africa/Johannesburg display timezone, invitation-only membership, no automatic trash purge, English initial UI, initial import/export formats, notification grouping behaviour, stage boundaries and test volumes. Do not silently treat these as previously agreed preferences.

### Mandatory separate project setup

Create a new project folder named `Sidekick` on Hassan's laptop (confirm the actual parent folder rather than assuming this remote workspace is his laptop). Create a separate GitHub repository named `Sidekick`, preferably private unless Hassan chooses otherwise. Never put this project inside the Google reviewer, WebRift website or 7 Waves application repositories.

Before generating application code: check whether the folder/repository already exists; preserve existing work; initialise Git only where needed; connect `origin` to the real repository URL; use `main` and task branches; commit the specification, README and appropriate ignore rules. Do not claim a remote is connected merely because a guessed URL was added. Verify repository access and a successful push/readback. If creation or authentication is unavailable, explicitly report that blocker and request only the minimum owner action; never ask for tokens in chat.

Track application source, migrations, safe configuration examples, tests and docs. Exclude secrets, local databases/client records, uploaded documents/photos, signing keystores, build artefacts and local caches. Keep Android signing material in owner-controlled secure storage. Include reproducible build/run/test instructions, a changelog and release version identification. The source repository is not the storage location for business/personal uploads.

Initial documentation layout: `README.md`, `docs/specification.md`, `docs/architecture.md`, `docs/implementation-plan.md` and `docs/acceptance-matrix.md`. Only the specification/README need exist before architecture decisions. Create implementation directories after choosing the stack; do not fabricate completed backend/mobile components.

## 2. Purpose, boundaries and success

Sidekick should answer: What needs doing? Who is responsible? What is due? Where is the information? What did we agree? What money is expected/recorded? What changed since I last looked?

A successful day: Hassan captures a client requirement and evidence on his laptop; the marketer adds a task from Android; both receive an update; Hassan works offline on selected materials; reconnecting preserves both users' edits; a payment entry has an accurate balance/history; private study content never leaks into the shared workspace.

Non-goals for initial releases: replacing 7 Waves operations, an accounting/tax platform, automatic bank reconciliation, collecting payments, automatic WhatsApp/email ingestion, social publishing, public client portals, AI making decisions, unlimited file previews, flawless OCR, or guaranteed notification delivery under all phone conditions. Links/manual attachments and useful export are sufficient before separately authorised integrations.

## 3. Architecture decision required before implementation

Platform selection is settled; exact technology is not. Recommend one maintainable approach and justify it with a small technical proof covering Android push, offline updates, private access enforcement and file access.

Candidate A: a shared web UI packaged with native Android integrations, plus browser deployment. Candidate B: a cross-platform application framework with Android and web targets. Choose based on maintainability, local persistence, signed APK tooling, Android integrations, privacy and sync requirements. Do not describe an APK wrapping a remote URL with no offline persistence as a completed offline app.

Earlier discussion considered Firebase Authentication/Firestore/Cloud Messaging, static hosting and Google Drive for files. These are candidates, not a verified or mandatory stack. Recheck current official pricing, policies, limits, commercial-use terms, APIs and credentials before committing. Include background server execution, scheduling, backups, storage traffic and build distribution in the cost assessment. Storage allowance alone does not supply a database, reliable sync or push scheduling.

Do not require the user's laptop to remain awake for shared sync or remote reminders. Do not ship privileged provider keys or service-account credentials in the APK/browser. Client-side secrets are not secrets. Use server-enforced authorisation and invite allowlists. No public self-registration into this private workspace.

Before coding the full app, deliver a concise architecture decision and requirements matrix. Treat this file as a proposed build contract: clarify genuine blocking contradictions, preserve agreed scope, and use documented engineering judgment for routine implementation details.

## 4. Accounts and permissions

Two separate accounts, equal shared creation/edit permissions, distinct read states and clear actor attribution. Proposed authentication: provider login or another secure low-friction method, with durable sessions and safe recovery; exact method is an engineering decision to document.

| Action | Hassan | Marketer |
|---|---|---|
| View/create/edit shared records | Yes | Yes |
| Assign shared tasks to either user | Yes | Yes |
| Request shared deletion | Yes | Yes |
| Approve/reject shared deletion | Yes | No |
| Restore shared trash | Yes | Proposed: request restoration; Hassan approves |
| Permanently delete shared content | Yes, explicit confirmation | No |
| Read another person's private content | No through normal app access | No |
| Manage own private content/trash | Yes | Yes |
| See private Busy projections and shared session summaries | Yes | Yes |
| Receive redacted marketer private-deletion notices | Yes | Not applicable; no symmetric notice requirement agreed |

Private deletion remains owner-controlled. The marketer must be told clearly during onboarding that Hassan sees broad-category deletion activity. No private item names, parent-space names, subject names, previews, attachments, source links or content go in these notices. Use a fixed category allowlist such as private file/private note/private task/private event, not a free-text label that can leak content.

Hassan's shared administration role must not automatically grant normal API access to private content. Explain the distinction between app privacy and cloud/project-administrator access: if the selected storage puts all private files in Hassan's Drive, an app-only hide is not sufficient for strong privacy. Decide whether private files use each user's storage or encryption with separately held keys. Document the threat model and recovery trade-off. Never claim end-to-end privacy merely because a screen hides a folder.

Enforce access on APIs, database rules, file downloads, search, exports, notification payloads, previews, backups and offline caches. No private data in shared global search or report counts. Do not keep another account's cached private data after account switching. Tokens and cached data must be handled safely on logout/lost-device recovery. Never silently clear unsynced work during logout or account switching: first offer sync, an encrypted account-bound pending queue that cannot be read by the next account, or explicit confirmation to discard pending operations. Clearly distinguish a normal logout from secure local-data removal; explain what will be lost before confirmation. Test pending file uploads and financial entries as well as notes.

## 5. Flexible organisation and information model

Hierarchy: workspace → spaces → sections/folders → items. Shared and private visibility must be explicit when creating a space. Initial suggested spaces: WebRift, 7 Waves, Shared Study and each person's private area. Users can create more.

Items: pages/notes, files, galleries, tasks/checklists, events, project/client records, tables/trackers, links and evidence. Support custom fields and labels, favourites, pinned items, archive and saved filters. Avoid implementing a complex arbitrary database/formula engine unless needed; a small set of field types is an acceptable first step, documented honestly.

Items may link across shared spaces without file duplication. Private-to-shared linking must not disclose hidden titles or previews. Sharing private content requires an explicit, informed action; never widen a whole folder's visibility as a side effect. Moving content between visibility boundaries must show the consequences and preserve server-side checks. Proposed integrity rule: any shared-to-private move or visibility restriction that removes the other person's shared access needs Hassan's approval, including parent folders/spaces. The marketer may copy shared content into their private area while leaving the shared original intact. This rule closes an access-removal bypass of shared deletion approval.

Quick capture inbox: task/note/file/photo/link/deadline, saved immediately to a chosen private/shared context. Unorganised captures remain findable and can be filed later. Draft state, upload state and synced state must be distinct.

## 6. Files, photographs and knowledge

Core requirements:

- Folders/subfolders; bulk upload; phone file picker/camera integration as supported; laptop drag/drop or picker.
- Rename, move, tags, descriptions, thumbnails and safe previews for explicitly supported formats.
- Proposed starting previews: common raster images, PDFs and plain text; other formats store/download safely with a clear unsupported-preview label. No promise of rendering every office/archive/media format.
- Record original filename, MIME/type validation, byte size, checksum where practical, uploader, upload time, version and storage location.
- Approved/received/reviewing/used statuses when relevant. Status labels are not automatic verification.
- Replacement/version history without silently overwriting an approved/final file.
- Explicit file references so one file can relate to several tasks/items.
- Upload progress, pending, failed/retry and verified remote completion; interrupted uploads must not appear fully available.
- Selective offline download and storage-usage control. Large collections must not auto-download to both phones.
- Preserve folder organisation and references in exports. A list of links to inaccessible cloud objects is not a full file backup.
- Recoverable deletion and missing-file detection. Define how version history, offline copies and trash affect storage consumption.
- Supported size/type limits must be visible and justified; never silently discard files.

Google storage: Hassan reports Google Pro with approximately 5 TB. This is unverified. Inspect actual entitlement only with authorised access. Verify ownership, sharing, API scopes, revocation, quotas and long-term access. Do not store the live database as a shared JSON file in Drive: concurrent offline edits require a real sync design. Do not turn private files into public 'anyone with link' downloads. Provider-side deletion outside Sidekick may bypass app approval; document that boundary and detect missing files where practical.

Search initially covers accessible record titles, filenames, tags and note text. Full document content search requires a separate extraction/indexing implementation and supported-format list. Never claim full PDF/scan search when only filenames are indexed. Apply the same permission filters to snippets and index entries.

## 7. Clients, leads, projects and business records

One organisation/contact can relate to both companies without duplicate records. Store business name, contacts, useful links, address/location if entered, status, relationship types, responsible user and follow-up date. No client access initially.

Lead pipeline: approached → discussion → proposal → agreed/client → paused/lost/archive, with editable stages where practical. Preserve discussions/attachments when converting a lead to a client. Capture call/meeting notes and important message screenshots manually; automatic message access is out of scope until separately approved.

Client timeline connects requirements, files, agreements, evidence, tasks, decisions, changes and payment entries. Reusable templates should support WebRift onboarding and website delivery; 7 Waves remains a flexible planning space, not a duplicate operational backend.

Projects: description, owner, participants, status, milestones, deliverables, deadline, next action, related records and files. Tasks/checklists, dependencies and blockers. Waiting reasons include client material, decision, approval and payment. Completing a prerequisite makes dependent work actionable; do not silently complete dependent tasks. Detect/avoid dependency cycles.

Changes/approvals: requested change, source/evidence, package coverage, proposed added charge if any, decision-maker, decision time and impact on agreed deadlines. Do not automatically charge a client or change an agreement from a suggestion. Save promises such as deliverables/revisions as explicit records linked to agreement evidence and tasks. Completed work and approved work are different states.

Templates are copied/versioned so editing a template does not rewrite an existing project's commitments. Archive completed work without deleting its history. Flag active projects with no next action or overdue milestones.

## 8. Package and money tracking

Manual internal tracking; not payment collection or financial/legal advice. No automatic late fees or interest calculations unless the owner explicitly defines an authorised rule later.

Package catalogue: description, inclusions, list price, billing frequency and version. Per-client agreement snapshot: actual negotiated price, inclusions, start/end dates, deposit, recurring schedule and exceptions. Never prepopulate old prices from conversation memory as current contracts; users enter/approve the real values.

Money model must separate obligation from payment: expected charge/installment, recorded payment, allocation to charge(s), adjustment/reversal and evidence. Support deposits, partial payments, balances, recurring monthly obligations, due/overdue/paid states and recorded receipts. Proposed default currency ZAR; store currency per amount and never sum incompatible currencies silently. Use exact decimal/minor-unit arithmetic, not floating point for balances.

Each payment has amount, currency, effective date, reference/method, actor, entered time, allocations and optional proof. Corrections preserve the prior entry using adjustment/reversal or another auditable approach; editing a client balance directly without a ledger is unacceptable. Attached proof and confirmed receipt are distinct. Do not auto-confirm from an image or AI suggestion.

Avoid duplicate postings on retries/offline replay using durable operation identifiers. Conflicting financial edits must be reviewed, not silently last-write-wins. Recurring charges create distinct periods with stable IDs, preserve past history, handle month-end dates and timezone boundaries and avoid replay duplicates. Editing a package changes future obligations only according to an explicit effective date.

Views: expected vs recorded receipts, amounts due soon, overdue amounts, per-client history, deposits/balances and optional expenses/subscriptions. Do not label these tax/accounting statements. Every aggregate must drill into contributing entries and respect privacy filters.

## 9. Tasks, calendar and collaboration

Tasks: title, instructions, accountable assignee, creator, participants, priority, status, due date/time, subtasks, related files/items, comments, mentions, estimate and optional actual effort. Both can assign work to either user. Views: mine, theirs, all shared, overdue, waiting, list/board, company/project filters.

Calendar: day/week/month; meetings, scheduled focus/work, deadlines and recurring obligations. Keep a task's due date distinct from its scheduled work block. Moving a work session must not move the deadline. Show private scheduled events to the other user as Busy/time range only; this must be a separately safe projection, not the full private event returned with its title hidden by CSS.

Date model: explicit all-day dates versus timed events, timezone-aware instants, display timezone, recurring-series definition and per-occurrence exceptions. Proposed default Africa/Johannesburg. Test short months, year changes, device timezone changes and recurrence edits.

Handover: completed work, waiting on, next action, help needed. Meetings: agenda, notes, decisions and user-selected task creation. Every meaningful shared change has actor, server receipt time and record version; preserve device-created time separately when offline. Activity attribution is not surveillance of keystrokes or proof someone worked.

## 10. Study, focus and private progress

Stopwatch, countdown and configurable focus/break cycles. Persist session timestamps so backgrounding/restarting the app does not reset elapsed time. A proposed initial rule is one active timer per user, reconciled across devices; document handling of offline simultaneous sessions and forgotten timers.

Session records: owner, start/end, paused segments, linked task/topic (private where applicable), optional completion note, manually confirmed completion and manual corrections. Clearly distinguish measured timer duration, manually entered duration and completed work. Running a timer is not evidence of study.

Subjects/topics, assignments, exams, revision tasks, personal projects and weekly targets. Shared study sessions may have a common schedule, with each participant's private tasks/materials separate.

Only limited private projections are shared by default: Busy slots, duration and completion status. No task/subject titles, notes, filenames, screen activity or individual private edits. The shared record must not carry internal private IDs usable to fetch hidden content. Manual sharing of more detail requires explicit action. Study reports obey these boundaries.

## 11. Notifications and reports

Background notification requirement: important notifications while the Android app is not open, with device permission and platform restrictions acknowledged. Distinguish normal app closure, swiping away, OS kill, force-stop, offline and battery restrictions in tests. Do not promise delivery while force-stopped or without connectivity. Use native local reminders for suitable on-device schedules and server-driven push for remote shared updates; actual implementation must be proven.

An authoritative in-app inbox persists missed updates independently of push delivery. Separate states: event recorded, push attempted/accepted by provider where observable, notification read, item handled. Do not label provider acceptance 'read' or guarantee device display. Each user's read/unread state is independent.

Both receive important shared updates: creation/assignment, mentions, material deadline changes, blockers, completion, shared deletion requests/decisions and configured payment/renewal reminders. Group low-value edits; do not push every keystroke. Proposed default: actor sees the activity/inbox but does not receive a redundant self-generated push; document this default for review. Include preferences, quiet hours, snooze, mark-read and deep links that recheck permission.

Private detailed alerts go only to owner. The other user sees only agreed redacted activity/projections. Marketer private-deletion notices to Hassan have actor, fixed broad category and time only. Never put private text into OS notification payloads, logs or lock-screen previews without owner-controlled preference. All remote notification triggers run in trusted backend code; no server sending credentials on devices.

Offline event replay, repeated workers and multiple devices must not generate repeated logical notifications. Editing/cancelling a deadline invalidates superseded reminders. Inbox records need stable IDs and action resolution, not silent disappearance. Propose retention/export rules; no unapproved automatic destruction of important history.

Weekly reports are opened on demand, not emailed. Show completed/upcoming/overdue work, stalled projects, outstanding money and study summaries. Derive from recorded facts; no AI needed. Respect private visibility and state exactly which period/timezone and data freshness are shown.

## 12. Deletion, evidence and audit history

Shared lifecycle: active → deletion requested → approved soft-deleted/trash or rejected → restored or owner-confirmed permanent deletion. Request includes actor, target and reason. Target remains available before approval. Pending requests do not grant the requester authority to delete content, clear evidence or bypass with a folder deletion.

Only Hassan approves shared deletion/permanent destruction. Concurrent edit or new child attachment after a request must require revalidation/renewed approval of the actual affected content. Define folder cascading effects and file-link behaviour: removing one reference must not destroy a file still used elsewhere. Archiving is separate from deletion and must not bypass access/financial history.

Private lifecycle: owner can trash/restore/delete their private items; marketer actions produce redacted notices to Hassan. Proposed default: notify on trash and permanent removal as distinct actions to avoid implying content still exists. Private permanent deletion and deletion of accounts/backups require a documented retention and recovery policy. Hassan's own private deletion details remain private.

Shared audit history records meaningful changes, deletion requests/decisions, restoration and financial adjustments. Users cannot silently rewrite the audit by editing normal records. Equal shared editing must not become an erasure bypass: clearing a note, replacing an attachment or removing evidence creates recoverable revisions preserving original content/bytes. Only Hassan can approve purging shared revisions or original evidence. Proposed policy: normal destructive edits remain editable by both, but version history and original linked bytes cannot be removed by the marketer. Show material destructive changes in the activity feed; deleting a record shell is not the only action that can lose information. This is an app-enforced history, not an assertion that a cloud administrator can never alter infrastructure. Permanent removal of content may leave minimal non-content audit metadata; define that explicitly.

Evidence: supported file or source link, description, date, uploader and separate reviewed/verified-by-user state. Never claim a screenshot proves payment just because it was uploaded. Removing/changing evidence must be logged; financial corrections use auditable reversals rather than deleting the ledger. External file-provider deletions are a known boundary to detect/report.

## 13. Offline, sync and failure behaviour

Define and test an offline capability matrix rather than an 'offline supported' badge:

| Feature | Required offline behaviour |
|---|---|
| Previously synced accessible records | Read and edit supported fields locally |
| Notes/tasks/calendar drafts | Create, save and queue changes |
| New file/photo | Queue durable upload with clear pending status |
| Selected downloaded files | Open locally; undownloaded files show unavailable |
| Focus timer | Runs/persists locally |
| Shared updates | Delivered to the other person after server sync, not magically while both offline |
| Login/new device/account recovery | May require internet; communicate clearly |
| Shared deletion approval/permanent deletion | Proposed online authoritative action; never appear server-complete offline |
| Financial additions | Queue as pending, confirm/reconcile after server acceptance |

Use a durable outbox, operation IDs, acknowledgements, retries with limits/backoff, item versions and explicit error states. Distinguish local saved, uploading, pending server acceptance, synced, conflict and failed. Never label an edit synced before acknowledgement. Restart/crash must preserve queued changes. Replaying an operation cannot duplicate tasks, money, uploads or notifications.

Merge independent edits where safe. When two users change the same field, preserve both candidates and require resolution where meaningful. Rich-text collaborative editing is optional complexity: a locked/versioned editor with conflict copies is acceptable if explicit; silent last-write-wins data loss is not. Financial records, approval state and deletion require stricter authoritative validation. Preserve tombstones long enough for old offline clients not to resurrect deleted content; define retention/device rejoin behaviour.

Permission revocation cannot remotely erase bytes already downloaded by a disconnected device. Explain this limit and implement best-effort cache removal on reconnect/logout. No claim of instantaneous offline revocation.

## 14. Search, templates, briefing and productivity extras

Global search across accessible notes, client names, filenames, tags and tasks; filters by space, date, owner, type and status. Include archive/trash only when requested and permitted. Offline search covers local available data and labels its limited scope.

Reusable templates for client onboarding, website delivery, meetings, marketing campaigns, study plans and blank trackers. Template changes do not rewrite existing records. Custom labels/fields and saved views should not require developer edits for ordinary organisation.

Needs-attention briefing identifies missing next actions, overdue deadlines, unapproved work, missing client assets and outstanding recorded amounts. Every statement links to underlying records. No invented urgency or AI-generated balance calculations. Workload views distinguish estimates, scheduled time and recorded actual effort.

Marketing planning includes ideas, asset collections, captions, assigned review and planned dates; recording a publishing date does not automatically publish externally. Renewal tracking covers entered domains, hosting, subscriptions and agreements. No invented renewal dates from guesses.

## 15. Optional AI after core acceptance

AI is deferred. Preserve an extension point, not nonfunctional AI buttons. Later functions: selected-note summaries, suggested tasks from meeting notes, and questions over selected supported documents with source references.

No mandatory paid provider, embedded private API key or assumption that consumer subscriptions pay for runtime calls. Verify actual no-cost limits. If no free allowance/local model is available, AI is unavailable with an honest message; core features continue. No auto-upgrade/charges. Local inference has compute, power and availability constraints; do not market it as resource-free.

AI suggestions must not directly change payments, evidence verification, permissions, deadlines or commitments, delete items or send messages. User reviews a proposed diff before saving. Retrieval must enforce access before content reaches the model. Do not send the marketer's private material to Hassan's local model as a supposed private workflow. Document processing consent and data destination are required.

## 16. Cost, storage and maintenance constraints

Start near zero incremental service cost for two people, excluding existing subscriptions, connectivity, electricity, hardware and development effort. This is a goal, not a promise. No fixed monthly budget has been approved. Ask before enabling billing or paid upgrades, and show what the upgrade buys. Usage alerts are not hard cost caps.

Verify large-file storage, transfer, database operations, functions/scheduling, push sending infrastructure, authentication, backups/restore, logs and Android build/distribution costs. Set sensible quotas/rate limits and show storage usage. Avoid subscriptions for features achievable simply. No SMS/email fee dependency when pop-ups/inbox meet the requirement.

No permanent claim that free tiers remain unchanged. Provide provider exit/export paths. Backups are not just sync: an accidental deletion propagating everywhere is not recoverable without history/backup. Protect signing keys and credentials. APK updates require the same signing identity and safe schema migration; loss of signing material is a release risk. Key custody belongs to the project owner, not an agent's transient workspace.

## 17. Visual design requirements — later polish, good foundations now

User wants an aesthetically very pleasing final application, with detailed styling deferred. Do not spend the first release on elaborate branding or animation while sync/privacy remain unproven. Use design tokens, reusable components, responsive layout, consistent typography/spacing, clear statuses, keyboard access on laptop and usable Android touch targets. Avoid placeholder controls masquerading as completed functionality.

Later visual stage: approved moodboard/mockups, coordinated light/dark themes if selected, clear hierarchy, polished file galleries/calendar/boards, restrained motion respecting reduced-motion preferences, attractive empty/loading/error states, and consistent Android/browser experience. Exact colour palette/logo/visual direction remains unselected. Do not impose WebRift blue as an agreed Sidekick brand.

## 18. Delivery stages and review gates

All listed product modules are the intended destination; stages are not permission to silently omit later requirements. Maintain a visible scope matrix.

### Stage 0 — design and feasibility

Architecture decision, data model/permissions, sync/conflict protocol, storage privacy/cost check, signed APK build path and small background notification/offline proofs. Show unresolved choices and obtain design approval before a large implementation. Use no real client data for a disposable prototype.

### Stage 1 — secure vertical slice

Two invited identities; shared/private spaces; a client record, note, task assignment and evidence file; real persisted backend; browser plus signed Android build; API-level private access rejection; shared change inbox/push; offline task/note replay; version/conflict preservation; deletion approval path. Demonstrate between two identities on two devices. Must pass before broad feature expansion.

### Stage 2 — complete organisation

File library/gallery/versioning/selective offline files, robust quick capture, search, client/project pipeline, templates, dependencies, comments, approvals, change requests and evidence timeline. Include migration of representative existing folders/CSV records with preview, validation, duplicate detection and rollback/recovery. Never bulk-import real data without a reviewed import plan.

### Stage 3 — planning, money and study

Calendar/recurrence, today/week views, package snapshots and auditable payment tracking, reminders, renewal/marketing planning, focus/study features, private Busy/session projections and redacted deletion audit. Add on-demand weekly review.

### Stage 4 — reliability and real-device acceptance

Backups AND restoration, data exports, security/access tests, offline conflict/crash recovery, notification matrix, update/migration tests, quota errors and realistic dataset performance. Stage 4 checks also run continuously; this is final acceptance rather than the first time tests occur.

### Stage 5 — aesthetic polish

Review approved visual direction, polish full flows on phone/laptop, accessibility and performance checks. Do not change permissions/workflow semantics merely for visuals.

### Stage 6 — optional assistance

Only after core acceptance and a verified no-paid-dependency approach; AI extensions separately evaluated. Not a launch blocker.

At each stage return: commit/version; implemented requirement IDs; exact local and deployed test commands/results; screenshots or recording using fictional data; signed APK/download provenance if applicable; known defects; usage/cost status; setup/recovery instructions; next stage. Reviewer fixes must update tests and requirement coverage, not just screenshots.

## 19. Acceptance scenarios — evidence required

A1 Identity: non-invited user cannot enter; each user has a distinct stable identity and personal read state.
A2 Shared work: marketer assigns a task; Hassan sees the same persisted record, actor and instructions on browser/Android.
A3 Private access: neither can retrieve another's private note/file via guessed IDs, API, search, preview, export or shared backup path. Shared projections contain only approved metadata.
A4 Busy/session privacy: counterpart sees Busy times and permitted session summary; no hidden title/subject fields in responses/push payloads.
A5 Shared deletion: marketer cannot directly delete, cascade-delete, remove shared access by a shared-to-private move, purge revisions or permanently erase shared data. Hassan approval is revalidated against current target/version; reject/restore work.
A6 Private deletion: Hassan receives fixed-category redacted notice for marketer deletion; no content leak. Marketer sees a transparent explanation of this policy.
A7 Notifications: test foreground, background, normal closure, offline/reconnect, denied permission, battery restrictions and force-stop separately on real phones. Missed push remains in inbox; one user's read doesn't clear the other's.
A8 Reminder updates: changing/cancelling deadline prevents stale reminders; worker retries and two devices do not multiply logical alerts.
A9 Offline: create/edit, restart device/app, switch accounts/logout safely, reconnect and verify queued work persists exactly once. Independent edits merge or preserve both; conflicting field values are not silently lost.
A10 Money: deposit R500 on charge R1,700 gives R1,200 outstanding; another R200 gives R1,000. Replay does not add duplicate money. Reverse the second entry and balance returns to R1,200 with history preserved. These are synthetic test amounts, not client data.
A11 Recurrence: monthly obligations, month-end dates, timezone changes and edited future schedules produce correct distinct periods without changing settled history.
A12 Files: upload/interrupt/retry, rename, version, link in two records, download offline, recover trash and export original bytes/structure; no false completed upload or reference-based premature deletion.
A13 Timer: background/restart preserves elapsed time; manual adjustments are labelled; overlapping devices do not silently double-count.
A14 Reports/search: results agree with underlying accessible records, exclude private content and distinguish expected/received amounts and offline data freshness.
A15 Restore: restore a representative backup into an isolated environment and verify files, relationships, permissions, ledger and history. Backup format and encryption/key recovery are documented.
A16 APK update: signed update installs over previous version, preserves data/session/pending work, handles schema migrations safely; browser and old/new clients don't corrupt shared data.
A17 Cost/offline limits: quota exhaustion, unavailable storage and unavailable optional AI show actionable messages, preserve pending data and never silently start billing.
A18 UI: critical flows usable by touch/keyboard with labelled controls, visible focus, legible contrast, usable errors and no private information in shared empty/search/notification states.

Proposed scale for profiling, not a promise: 2 users, 100 business records, 100 projects, 5,000 tasks, 2,000 notes and 10,000 file metadata records, with a mix of small files and representative larger uploads. Record actual device/storage behaviour and tested upload sizes. Paginate and lazy-load; do not download the full file library for every dashboard visit. Agree measurable response/latency targets after an actual baseline, rather than inventing benchmark results.

## 20. Completion standard, ratings and failure reporting

Desired final experience: at least 9/10 on an agreed human usability/visual rubric; this is a target, not a current score. There is no implemented Sidekick to rate yet. 'All tests pass' is necessary but not sufficient. Hard failures in privacy, financial duplication, data loss or deletion authority block release regardless of appearance or average score.

Score separately: ease of capture/retrieval, cross-device consistency, offline reliability, notification usefulness, privacy correctness, financial correctness, visual quality and maintenance/cost transparency. Provide measured scenarios, failures and sample sizes. Do not use invented success probabilities or claim 100% uptime/zero future bugs.

Feature status labels: Not started; Implemented; Automated-test verified; Real-browser verified; Real-Android verified; Blocked; Accepted by owner. Use a matrix mapping every requirement to stage, code area, tests, evidence and known limitations. Mocked push is not device delivery; a hidden tab is not access control; a timer is not proof of work; a cloud file link is not a tested backup.

## 21. Remaining decisions and safe defaults

- Marketer's name/email, actual Google entitlement, phone models/Android versions, chosen authentication and provider setup require real input at the relevant stage. Do not invent them.
- Exact stack, hosting and storage are architecture choices to verify. No Sidekick repository exists yet; agree name/visibility before creation.
- File caps, backup frequency/retention, recovery-key custody, notification quiet hours and reminder lead times require explicit documented defaults and review. Proposed: no automatic permanent purge before owner policy is set.
- Private data's protection against infrastructure owners must be resolved before real uploads. Do not substitute cosmetic hiding.
- Changes to paid plans, external messages, public deployment/download visibility and real-data imports require the appropriate owner authorisation. Do reversible local development and safe read-only checks without repeated unnecessary permission loops.

## 22. First instruction Hassan can send with this file

“Build Sidekick according to this specification. Start with the architecture/feasibility decision and a traceable staged plan. Do not claim the whole app is finished after making screens. Preserve the privacy, deletion, offline and money rules. Deliver a real browser application and signed Android APK through tested stages, with evidence and a clear account of what remains unverified. Keep costs near zero, ask before enabling anything paid, and leave AI for later. I will send your work to another assistant for review and fixes.”
