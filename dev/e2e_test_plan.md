# E2E test plan — main app

Decisions and conventions for the end-to-end test suite. Companion to `dev/feature_catalog.md` (which lists *what* to test).

## 1. Framework & tooling

- **Test runner:** Playwright (TypeScript). Multi-context support is required for invitation / SSE / multi-user flows.
- **DB assertions:** `pg` (node-postgres) from inside the test process. Same connection URL as the backend uses.
- **Test location:** `test/e2e/` at the repo root (sibling to `backend/`, `frontend/`).
- **Naming:** `c5_accept_invitation.spec.ts` — files prefixed with the catalog ID (e.g. `c5`, `g13`) so a failing test maps directly to a `feature_catalog.md` section.

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
