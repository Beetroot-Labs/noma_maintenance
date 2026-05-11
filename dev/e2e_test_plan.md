# E2E test plan — main app

Decisions and conventions for the end-to-end test suite. Companion to `dev/feature_catalog.md` (which lists *what* to test).

## 1. Framework & tooling

- **Test runner:** Playwright (TypeScript). Multi-context support is required for invitation / SSE / multi-user flows.
- **DB assertions:** `pg` (node-postgres) from inside the test process. Same connection URL as the backend uses.
- **Test location:** `test/e2e/` at the repo root (sibling to `backend/`, `frontend/`).
- **Naming:** journey-based, e.g. `auth_session_lifecycle.spec.ts`, `lead_creates_shift.spec.ts`. See §18 for the full roster. Each spec lists the catalog row IDs it covers in a header comment so failures still map back to `feature_catalog.md`.

## 2. Auth bypass

- New backend route `GET /auth/dev-login?email=<email>` that issues a session cookie for the given user.
- Gated by env var `ENABLE_DEV_LOGIN=true`. **Never** enabled in production.
- Returns 404 if disabled, 400 if `ENABLE_DEV_LOGIN=true` but the email doesn't match a seeded user.
- Playwright helper: `loginAs(page, email)` calls the route, asserts the cookie, returns the user record from the DB.

## 3. Backend in tests

- Real backend process spawned per worker, pointed at a testcontainers Postgres 17 (port assigned dynamically).
- `MemStorage` is wired in by setting `STORAGE_BACKEND=mem` env var. Photos and signatures live in process memory; no GCS creds needed.
- Backend is built once at suite startup (`cargo build --release --features test-bypass`) — feature gate ensures the dev-login route only compiles in.

## 4. Test data isolation

- **Strategy: fresh tenant per test.** Every test starts by inserting a new `tenants` row and seeding inside it.
- SQL presets live in `test/e2e/presets/*.sql` — composable building blocks:
  - `preset_users_basic.sql` — one admin, one lead, two technicians
  - `preset_building_with_10_devices.sql` — one building + 10 devices with locations and barcodes
  - `preset_active_shift_in_progress.sql` — a lead + tech shift, status IN_PROGRESS
  - etc.
- Presets take `:tenant_id` as a parameter (psql-style). The Node helper `applyPreset(tenantId, name)` substitutes and executes.
- No `pg_restore` baseline — tenants are cheap. Tables are *not* truncated between tests; isolation comes from `tenant_id` filtering, which the schema already enforces everywhere.

## 5. Storage

- Backend uses the `Storage` trait seam (`backend/src/storage.rs`).
- Production wires `GcsStorage`; tests wire `MemStorage` via the `STORAGE_BACKEND=mem` env var.
- No code changes needed in tests beyond that env flag.

## 6. IndexedDB access

- Dev-only file (`frontend/apps/main/src/lib/e2eHooks.ts`) gated by `import.meta.env.VITE_E2E === 'true'` attaches helpers to `window.__noma_e2e`:
  - `getCachedBuildingSnapshot(buildingId)`
  - `getOutboxItems()`
  - `clearAllStorage()`
- Tests use `page.evaluate(() => window.__noma_e2e.getCachedBuildingSnapshot(...))` to read.
- The hook file is the single place that imports IndexedDB internals; tests never speak to IndexedDB directly.

## 7. Offline / network mode

- `await context.setOffline(true)` to disable network. Effect: `fetch` rejects with `TypeError` (the same code path the app already detects as "backend nem elérhető"); `navigator.onLine === false`; `EventSource` closes.
- `await context.setOffline(false)` to restore. Outbox resumes flushing on its own schedule.
- For surgical failures (only one endpoint fails): `page.route('**/api/specific-endpoint', route => route.abort())`.
- Service worker: confirm in the first offline test that the PWA's SW does not intercept `/api` requests in a way that breaks `setOffline`. If it does, register the SW only outside the e2e env.

## 8. SSE timing

- Default wait for SSE-delivered state changes: **8 seconds**, via `expect.poll(...).toEqual(...)` with `timeout: 8_000`.
- Never use fixed `waitForTimeout()` — always poll on a condition.

## 9. Camera / barcode scanner

- Stub the camera stream with Playwright's `--use-fake-device-for-media-stream` flag plus `--use-file-for-fake-video-capture=<path-to-image-or-video>`.
- Seed real barcode photos under `test/e2e/fixtures/barcodes/*.png` (or `.y4m` for video).
- Each preset's seeded barcodes match a fixture file so the camera tests can drive a "scan" by switching the fake video source.
- For tests that only need to verify the scanner UI but not actually decode a barcode: open `/new-maintenance`, switch to manual entry, type the barcode. Manual entry is functionally equivalent for most tests.

## 10. Signature pad

- Non-empty stroke is enough. Drive with Playwright pointer events:
  ```ts
  await canvas.dispatchEvent('pointerdown', { ... });
  await canvas.dispatchEvent('pointermove', { ... });
  await canvas.dispatchEvent('pointerup');
  ```
- No pixel-diff assertion. Just verify the "Műszak véglegesítése" button enables and the commit succeeds.

## 11. Photo upload

- No backend-side resize.
- Test fixtures: `test/e2e/fixtures/photos/*.jpg`, modest size (under 1 MB).
- Per-photo cap: 10 MB (server-enforced). One test should verify the boundary.
- No max count per maintenance.

## 12. Folder layout

```
test/e2e/
  playwright.config.ts
  global-setup.ts        # builds backend, boots testcontainers, applies migrations
  fixtures/
    barcodes/
    photos/
    signature.png
  helpers/
    auth.ts              # loginAs(page, email)
    db.ts                # pg pool, dbQuery, dbExpect
    tenant.ts            # seedTenant, applyPreset
    outbox.ts            # waitForOutboxFlush, getOutboxItems
    snapshot.ts          # getCachedBuildingSnapshot
  presets/
    users_basic.sql
    building_with_10_devices.sql
    active_shift_in_progress.sql
    ...
  specs/
    a1_unauthenticated_redirect.spec.ts
    b1_logo_navigates_home.spec.ts
    c5_accept_invitation.spec.ts
    ...
```

## 13. CI

- Run on every PR via GitHub Actions.
- `retries: 1` in CI (`retries: 0` locally) to absorb infra jitter without masking regressions.
- One Playwright worker per CPU core; `fullyParallel: true`.
- Trace + screenshot on first retry: `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`.
- Cache the Rust release build and `node_modules` between CI runs.

## 14. Flake policy

- A test failing **≥1 in 20 runs** without a code change is quarantined: `test.skip` with a `TODO(flake): ...` comment + tracking ticket.
- Root-cause fixes go before new-test work; we don't accumulate quarantined tests.
- Use web-first Playwright assertions everywhere (`await expect(locator).toBeVisible()`, not `expect(await locator.isVisible()).toBe(true)`).
- Replace any fixed `waitForTimeout()` with `expect.poll`. Search the repo for `waitForTimeout` periodically.

## 15. Behavior decisions captured

These were ambiguous in `feature_catalog.md`; resolved during planning so test cases encode the right contract.

| ID | Decision |
|---|---|
| **K7** | `/api/shifts/pending` returns ALL `READY_TO_COMMIT` shifts in the tenant, not just where current user is lead. |
| **M4** | Worksheet PDF download — skip these tests for now (feature not implemented). |
| **J11** | Orphan signature blob — known issue. Plan: fold signature upload into the commit handler. Skip this test concern for now. |
| **E12** | Client filtering of the lead from invite candidates is good enough. Backend may or may not also exclude — tests should not assert on backend behavior here. |
| **H10** | On "Összes Munka" tab, clicking another user's work today does nothing. This is a bug, but keep the behavior for now and test for it. Reverse it when fixed. |
| **T4** | Live updates on `/admin/shifts` and `/pending-worksheets` should use SSE eventually, but do not touch production code for that now. Test the current 30s-poll behavior. |
| **F8** | Non-NoMa barcode scan: a snackbar is shown. Test that. |
| **B11** | `prefers-reduced-motion` — not in scope. |
| **Day boundary** | `todaysWorks` vs `pastWorks` — irrelevant: **`pastWorks` will be dropped entirely**. Don't write tests assuming the split. |
| **Cancelled shift** | UI does not really cancel; it deletes as if the shift never existed. Test against that (no row visible in admin past, etc.). |
| **Committed shift on /home** | After commit, `currentShift` goes to `null`. Test the "Nincs aktív műszak" card appearing. |
| **Removed-mid-shift** | Removing a participant drops their outbox (rude, will be fixed later — but test current behavior). |
| **Declined participant** | Should NOT see shift details. (Currently does — security audit H2. Test for the intended behavior; that test will fail until H2 is fixed.) |
| **Concurrent tabs** | Behavior undefined. Leave as TODO; do not write tests. |
| **Field max lengths** | No limit today (notes, "Egyéb ok", issue number). Tests should not assert on a cap. |
| **Issue number format** | Non-empty string is enough. No pattern validation. |
| **Photo cap** | No count limit. 10 MB per photo limit (server-enforced). One boundary test. |
| **Idempotency cleanup** | No TTL on `processed_mutations` yet. Will fix later. Tests don't need to clean up. |
| **Outbox cleanup** | Outbox should be cleaned up on building-cache load. **NEW FEATURE** — needs implementing before tests can rely on it. |

## 16. Known caveats / things to revisit

- **Service worker** behavior under `context.setOffline(true)` — verify on first offline test.
- **Outbox retry policy** — audit `outboxSyncEngine.ts` for backoff schedule and max retries before writing offline / sync tests; tests need to know whether to expect "marked error after N retries" or "infinite retry with backoff."
- **Idempotency TTL** — no cleanup yet, so tests will leak `processed_mutations` rows. Fine for now (fresh tenant per test isolates).
- **Outbox cleanup on building-cache load** — decided but not implemented. Should land before the outbox/cache tests are written.

## 17. References

- `dev/feature_catalog.md` — what to test (BDD-style feature list)
- `dev/test_implementation_notes.md` — backend integration test coverage map
- `dev/security_audit.md` — H1, H2 findings that interact with role tests

## 18. Spec sizing & journey roster

### 18.1 Sizing rule

One spec = **one user journey**. A journey is a coherent intent that shares: one preset, one (or few coordinated) login(s), one starting page, a sequence of interactions a real user would do back-to-back. Inside that journey, multiple catalog rows are covered as steps and assertions — they are *not* split into separate specs.

Cost model: per-test marginal cost is dominated by login + preset + navigation (~1-3s each). Once on the page, asserting ten things is roughly as cheap as asserting one. So the expensive boundary is "new login / new preset / new starting URL," not "new assertion."

**Heuristic — naming as a splitting signal:**
- If you can't give the spec a single coherent name without an "and" connecting unrelated concepts, the journey is too big. Split it.
- A name like `lead_creates_shift_and_invites_technicians_and_starts_maintenance` is three journeys. Three specs.
- A name like `commit_failure_handling` is fine: one intent, even though several sub-assertions live inside.

**Rules of thumb:**
- 5-15 catalog rows per spec is healthy. < 3 → paying setup for too little. > 20 → failure messages stop being useful.
- Split when *setup* diverges (different role, different preset, different network state, different page state), not when *assertion* diverges.
- Pure visual/CSS rows (B2, B11) belong in unit/visual-regression tests, not e2e. Drop them from the e2e suite.

### 18.2 Journey roster — spine first (D / E / G / J), then auth

For each journey: spec name → catalog rows → preset → role(s) → notes.

#### Phase 1 — Auth scaffolding

| Spec | Catalog rows | Preset | Role(s) | Notes |
|---|---|---|---|---|
| `auth_session_lifecycle` | A1, A2, A6, A7 | users_basic | technician | Unauth `/home` → redirect → login → restore intended path → logout → back to `/login`. |

A3-A5 (Google sign-in failure modes) are skipped — `/auth/google` requires real Google credentials and is bypassed in test by `/auth/dev-login`. Cover them at unit level if at all.

#### Phase 2 — Shift creation (D)

| Spec | Catalog rows | Preset | Role(s) | Notes |
|---|---|---|---|---|
| `lead_creates_shift` | D1, D2, D3, D4, D5, D8 | users_basic + building_with_10_devices | lead | Happy path: login → `/shifts/start` → autoload buildings → create → land on `/shifts/current` with self as sole participant. Asserts on DB row + IndexedDB snapshot. |
| `shift_creation_backend_error` | D7 | users_basic + building_with_10_devices | lead | `page.route` aborts `POST /api/shifts`; assert error alert. |

D6 (missing tenant id) skipped — anomalous client state not reachable from a normal session.

#### Phase 3 — Shift detail & participants (E + C invite half)

| Spec | Catalog rows | Preset | Role(s) | Notes |
|---|---|---|---|---|
| `shift_invite_accept_flow` | C3, C4 (INVITED), C5, C7, E2-E6, E20 | users_basic + shift_invited (lead + 1 technician INVITED) | technician (primary) + lead (second context) | Technician sees invite on `/home`, accepts, IndexedDB cache builds, lands on `/shifts/current`. Lead's context sees SSE `participants-updated`. |
| `shift_invite_decline_flow` | C4 (DECLINED), C6, C7 | users_basic + shift_invited | technician | Decline path; verify status flips in DB. |
| `lead_manages_participants` | E8, E9, E10, E11, E12, E13 | users_basic + shift_with_declined_and_active | lead | Add via dialog, remove a non-lead participant (READY_TO_START), reinvite a DECLINED one. |
| `add_participant_offline_blocked` | E14 | users_basic + shift_ready_to_start | lead | `context.setOffline(true)` before opening dialog; assert toast. |
| `lead_cancels_shift` | E15 | users_basic + shift_ready_to_start | lead | Cancel → DB row reflects deletion (per §15 cancelled = "as if never existed"). |
| `reload_building_cache` | E16 | users_basic + active_shift_in_progress | technician | Menu action; assert IndexedDB snapshot rebuilt via `getCachedBuildingSnapshot` hook. |
| `lead_requests_shift_close` | E17, E18 | users_basic + active_shift_in_progress (2 participants) | lead | Close-request → status flips, waiting banner appears while other participant hasn't confirmed. |
| `lead_starts_shift_summary` | E19 | users_basic + shift_ready_to_commit (all CLOSE_CONFIRMED) | lead | Summary button visible; navigates to `/shift-summary`. |

#### Phase 4 — Maintenance execution (G)

| Spec | Catalog rows | Preset | Role(s) | Notes |
|---|---|---|---|---|
| `complete_routine_maintenance` | F11, G4 (ROUTINE), G8, G9, G10, G12 | users_basic + active_shift_in_progress | technician | Manual entry → maintenance detail → notes + photo → complete. DB: work row FINISHED. |
| `complete_service_maintenance` | G4 (SERVICE), G5, G6, G7, G13 | users_basic + active_shift_in_progress | technician | Service branch with issue number, follow-up reasons (incl. OTHER → free text), validation messages. |
| `abort_maintenance` | G14 | users_basic + active_shift_in_progress + in_progress_work | technician | DB: work row ABORTED. |
| `maintenance_post_edit` | G15, G16 | users_basic + active_shift_in_progress + completed_work | technician (executor) | Edit after completion; "Legutóbb módosítva" tile appears. |
| `maintenance_read_only_for_non_executor` | G2 | users_basic + active_shift_in_progress + in_progress_work_by_other | technician (non-executor) | All inputs disabled; no Complete/Abort. |
| `maintenance_validation_blocks_complete` | G13 | users_basic + active_shift_in_progress | technician | Try to complete with missing photo / missing followup reason; assert helper text. Could fold into routine/service specs; standalone for clarity. |

F2-F4 (camera open / error / flashlight) are deferred — covered by `--use-fake-device-for-media-stream` setup but secondary to spine. F6-F9 (real scan paths) need the same setup and slot in once a `camera_scan_happy_path` spec is added. Initial spine uses manual entry (F11) instead.

#### Phase 5 — Commit (J)

| Spec | Catalog rows | Preset | Role(s) | Notes |
|---|---|---|---|---|
| `lead_commits_shift` | J3, J6, J7, J8, J9 | users_basic + shift_ready_to_commit + maintenance rows | lead | Open `/shift-summary` → empty-submit blocked → fill referent + draw signature → commit → DB row COMMITTED + signature_image_url present + `currentShift` becomes null on `/home` (per §15 decision). |
| `commit_upload_failure` | J10 | same as above | lead | `page.route` aborts `PUT /signature-image`; assert error toast + commit not attempted. |

J11 (commit fails after upload succeeded) skipped per §15 — orphan signature is a known issue, planned fix folds upload into commit.

#### Phase 6 — Offline & sync (deferred until prerequisites land)

| Spec | Catalog rows | Prerequisite |
|---|---|---|
| `maintenance_offline_then_drain` | S1, S2, G12 offline variant | SW behavior verified under `setOffline(true)`; outbox retry policy audited; outbox-cleanup-on-cache-load implemented (§15). |
| `commit_offline_then_drain` | S1, S2, J9 offline variant | same as above |
| `sync_error_surface` | S3, H6, H7 | outbox retry policy audited (need to know when it gives up) |

Do not write these until §16 caveats are resolved.

### 18.3 Out-of-spine — to schedule after spine is green

- **B / V — navigation & role gates** — drawer visibility, admin↔technician toggle, role-gated route redirects. One spec per role lens.
- **C8, C9, K** — pending worksheets card + page. Tenant-scoped per §15.
- **H** — maintenance dashboard tabs, sync indicators, Σ counter.
- **F2-F10** — full scanner suite (needs fake video capture wired in).
- **I** — device detail page (technician).
- **L/M/N** — admin shifts/maintenance views.
- **O/P** — admin user CRUD (admin role only for create/edit).
- **Q/R** — admin device list + detail.

### 18.4 Spine spec count

~17 specs to cover the must-not-break tier (D + E + G + J + foundational auth). At roughly 1-3s per spec setup + assertions, full spine should run in well under 2 minutes once stable.
