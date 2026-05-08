# Backend Test Plan

A behavior-focused test plan derived from `dev/backend_behavior.md`. The principle throughout: **test the contract, not the implementation.** Each test names a behavior the system must exhibit so that if a future refactor changes how that behavior is implemented (different SQL, different module structure, different transaction shape), the test still passes as long as the behavior holds.

## Test infrastructure

### Stack
- **Framework:** `cargo test` with the `sqlx::test` macro. Each test gets a fresh, schema-loaded Postgres database, isolated from sibling tests, and rolled back at end.
- **HTTP layer:** Use `axum::Router::oneshot` (or `tower::ServiceExt::oneshot`) to drive the real router with real handlers. No mocked handlers, no mocked DB.
- **GCS:** Stub the storage layer at the seam — provide a `Storage` trait implementation that records calls in memory rather than hitting GCS. (This is a system boundary; mocking it is consistent with the AGENTS.md rules.) For tests that don't need photos, leave `state.storage = None` and assert the **503** path.
- **Google JWKS:** For `/auth/google` tests, serve a fake JWKS from a local `httptest` server, sign tokens with a known RSA key, and point `state.client` at it. (Same rationale: external boundary.)

### Fixtures and helpers
Two small helper modules used everywhere:

1. `seed.rs` — builders for tenants, users, buildings, locations, devices, barcodes, shifts, maintenance works. Each builder returns a typed handle (`SeededShift { id, tenant_id, lead_id }`) so the test body is high-signal.
2. `client.rs` — wraps `Router::oneshot` so a test reads as `client.as_user(&u).post("/api/shifts").body(json!({...})).send().await` rather than 20 lines of axum boilerplate. Sets the session cookie and a fresh `X-Mutation-Id` header automatically (override per call when testing idempotency).

### Schema loading
Load `database/setup.sql` once per test DB via a small migrator helper. (Long-term, split into numbered `backend/migrations/` files and use `sqlx::migrate!()`. For now, a one-shot `pool.execute(include_str!("../../../database/setup.sql"))` is fine.)

### What we are NOT testing
- Static file serving (axum/`tower-http` plumbing).
- The `health-check` endpoint (one-line constant).
- Field serialization formats — leave to integration testing once we have it.
- DB connection failure paths (exhaustively) — one test asserting the "no db pool" → **503** branch is enough.

---

## Test plan by area

For brevity, "**Given**" describes the world before the call, "**When**" is the call, "**Then**" is what must be true after. Most tests are a few setup lines and one or two assertions.

### A. Authentication & sessions

#### A1. `POST /api/auth/google`
| Test | Given | When | Then |
|---|---|---|---|
| A1.1 happy path: existing linked user | A user with a `GOOGLE` `auth_identity` | POST with a token whose `sub` matches | 200; response carries the user; `Set-Cookie` contains the session cookie; `sessions` row inserted; `users.last_login_at` and `auth_identities.last_used_at` bumped |
| A1.2 first-time login, email matches existing user | A user exists with the email but no `GOOGLE` identity | POST with a verified Google token for that email | 200; new `auth_identities` row inserted with `provider=GOOGLE` |
| A1.3 email matches user but linked to different `sub` | User has a `GOOGLE` identity with `sub=A` | POST with a token whose `sub=B` | 403 with "already linked to a different Google account" |
| A1.4 no user with this email | No row in `users` for that email | POST | 403 with "no user with this email exists"; no auto-provisioning |
| A1.5 inactive user | User exists but `is_active = FALSE` | POST | 403 with "user account is inactive" |
| A1.6 `email_verified = false` | Token has `email_verified: false` | POST | 401 |
| A1.7 hosted-domain mismatch | `GOOGLE_HOSTED_DOMAIN=floomatik.com`, token `hd=other.com` | POST | 403 |
| A1.8 hosted-domain match | Same setup | POST with matching `hd` | 200 |
| A1.9 invalid token signature | JWKS doesn't contain the kid | POST | 401 |
| A1.10 wrong audience | Token `aud` not in configured client IDs | POST | 401 |

#### A2. `GET /api/auth/me`
| Test | Description |
|---|---|
| A2.1 | Valid session → 200 with user payload |
| A2.2 | No cookie → 401 |
| A2.3 | Revoked session → 401 |
| A2.4 | Expired session → 401 |
| A2.5 | User flipped to `is_active=false` mid-session → 401 |

#### A3. `POST /api/auth/logout`
| Test | Description |
|---|---|
| A3.1 | With valid cookie → 204; `sessions.revoked_at` set; cookie expired in response |
| A3.2 | With no cookie → 204; expired cookie still set |
| A3.3 | Already revoked → 204; no double revoke |
| A3.4 | Subsequent `/auth/me` with the same cookie → 401 |

### B. Tenancy isolation (cross-cutting)

This is **the highest-value area to over-cover**, because a tenant leak is a serious incident. One parameterized test per state-changing endpoint:

| Test | Pattern |
|---|---|
| B1.* | For every `GET` that takes a `{shift_id}`, `{device_id}`, etc.: seed an entity in tenant B; call as a user from tenant A; assert **403** (not 404, not 200) |
| B2.* | For every mutation endpoint: seed a target entity in tenant B; call as user from tenant A with a valid `X-Mutation-Id`; assert **403** and that **no row was written or modified** |
| B3 | Two users in different tenants both POST `/shifts` with the same building UUID (one valid, one cross-tenant) — only the valid call succeeds |
| B4 | Two users in different tenants use the same `X-Mutation-Id` against the same endpoint → both calls execute (idempotency is per-tenant) |

Roll these into a single test module that loops a small inventory of endpoints rather than hand-writing 30 nearly-identical tests.

### C. Role-based gates

| Test | Description |
|---|---|
| C1.1 | Technician POSTs `/shifts` → 403 (`require_lead_or_admin`) |
| C1.2 | Technician GETs `/admin/users` → 403 |
| C1.3 | Technician GETs `/shifts/pending` → 403 |
| C1.4 | Technician GETs `/shifts/{id}/maintenance-summary` → 403 |
| C1.5 | Lead and Admin succeed where Technician fails — same calls, expect 200/204 |
| C1.6 | Viewer role → same as Technician (no special endpoints) |

### D. Mutation idempotency

| Test | Description |
|---|---|
| D1 | Missing `X-Mutation-Id` on every write endpoint → 400 |
| D2 | Empty / whitespace-only `X-Mutation-Id` → 400 |
| D3 | `X-Mutation-Id` length 129 chars → 400 |
| D4 | Same `X-Mutation-Id` replayed: response is byte-for-byte equal to the first call. Pick at least one representative endpoint per "shape" — JSON-body sync (maintenance work), photo upload (binary body), no-content (logout/decline) |
| D5 | Replay does not re-run the side effect: e.g., `assign_labeling_device_barcode` replayed does not deactivate the active barcode a second time |
| D6 | Same `X-Mutation-Id` against two different endpoints both succeed (per-endpoint scoping) |
| D7 | Replay after the underlying entity has changed still returns the cached old response (the contract: idempotency wins over freshness) |

### E. Shift lifecycle — happy paths and key transitions

#### E1. `POST /api/shifts` (lead creates shift)
| Test | Description |
|---|---|
| E1.1 | Happy path: shift inserted with `status=IN_PROGRESS`; lead inserted as participant `CACHE_READY` with `cache_ready_at` set |
| E1.2 | Building from another tenant → 403 |
| E1.3 | Technician role → 403 |
| E1.4 | Building UUID well-formed but doesn't exist → 403 |
| E1.5 | DB pool absent → 503 |

#### E2. `POST /api/shifts/{id}/participants` (invite)
| Test | Description |
|---|---|
| E2.1 | Lead invites a tenant user → 204; `shift_participants` row inserted as `INVITED`; SSE event emitted |
| E2.2 | Non-lead participant tries to invite → 403 |
| E2.3 | User from another tenant invited → 400 ("not eligible") |
| E2.4 | Re-invite a previously-`DECLINED` user → row returns to `INVITED`, `invited_at` is bumped, all later timestamps cleared |
| E2.5 | Re-invite an already-`INVITED` or `CACHE_READY` user → no-op (existing row + timestamps preserved); call still succeeds. ON CONFLICT clause only resets DECLINED rows; every other status flows through the ELSE branch unchanged. |
| E2.6 | Invite into a frozen shift (e.g., `READY_TO_COMMIT`) → fails (currently surfaces as 500; document the contract) |
| E2.7 | After invite, `refresh_shift_ready_state_tx` puts shift back to `INVITING` if it had moved to `READY_TO_START` |

#### E3. `DELETE /api/shifts/{id}/participants/{user_id}`
| Test | Description |
|---|---|
| E3.1 | Happy path: participant removed; SSE fires |
| E3.2 | Non-lead caller → 403 |
| E3.3 | Try to remove the lead themselves → 400 |
| E3.4 | Removing the last `INVITED` participant transitions shift `INVITING → READY_TO_START` |

#### E4. `POST /shifts/{id}/join-ready`
| Test | Description |
|---|---|
| E4.1 | `INVITED` caller → 204; status becomes `CACHE_READY`; `cache_ready_at` set |
| E4.2 | `CACHE_READY` caller → 204 (idempotent within the call body, regardless of mutation-id replay) |
| E4.3 | `DECLINED` caller → 403 |
| E4.4 | `CLOSE_CONFIRMED` caller → 403 |
| E4.5 | Caller is not a participant at all → 403 |
| E4.6 | Last `INVITED` participant transitioning → shift moves `INVITING → READY_TO_START` |
| E4.7 | After ACCEPTED removal: a row whose status is the (no-longer-allowed) `ACCEPTED` would be a data corruption case; not a test target |

#### E5. `POST /shifts/{id}/decline`
| Test | Description |
|---|---|
| E5.1 | `INVITED` caller → 204; status becomes `DECLINED` |
| E5.2 | `CACHE_READY` caller → 403 |
| E5.3 | After decline, shift state recomputed: if no `INVITED` left, shift moves to `READY_TO_START` |
| E5.4 | Declining is not idempotent at the *behavior* level — replay returns the cached 204; verify a second distinct mutation-id rejects with 403 (status no longer `INVITED`) |

#### E6. `POST /shifts/{id}/close-request`
| Test | Description |
|---|---|
| E6.1 | Lead + shift `IN_PROGRESS` → 204; status `CLOSE_REQUESTED`; `close_requested_at` set; SSE fires |
| E6.2 | Non-lead → 403 |
| E6.3 | Shift not `IN_PROGRESS` → rejected (400 or 403) |

#### E7. `POST /shifts/{id}/close-confirm`
| Test | Description |
|---|---|
| E7.1 | Participant in `CACHE_READY` on `CLOSE_REQUESTED` shift → 204; `CLOSE_CONFIRMED`; SSE |
| E7.2 | Last non-confirmed participant confirms → shift moves to `READY_TO_COMMIT` |
| E7.3 | All-but-one confirm → shift stays `CLOSE_REQUESTED` |
| E7.4 | Confirming on a `READY_TO_COMMIT` shift (late confirm) → still 204 |
| E7.5 | `DECLINED` participant tries to confirm → 403 (and does not affect state machine) |

#### E8. `POST /shifts/{id}/commit`
| Test | Description |
|---|---|
| E8.1 | Lead + `READY_TO_COMMIT` → 204; status `COMMITTED`; `committed_at` set |
| E8.2 | Non-lead → 403 |
| E8.3 | Shift not `READY_TO_COMMIT` → 400/403 |
| E8.4 | After commit, any subsequent mutation to the shift's participants/maintenance/photos is rejected at the trigger layer |

#### E9. `POST /shifts/{id}/cancel`
| Test | Description |
|---|---|
| E9.1 | Lead cancels `IN_PROGRESS` shift → 204; status `CANCELLED` |
| E9.2 | Lead cancels `INVITING` → 204 |
| E9.3 | Cancel on `COMMITTED` → 400/403 |
| E9.4 | Cancel on already-`CANCELLED` → 400/403 |
| E9.5 | After cancel: any participant mutation rejected |

#### E10. `PUT /shifts/{id}/signature-image`
| Test | Description |
|---|---|
| E10.1 | Happy path: bytes upload, row upserted with name + role + JSON |
| E10.2 | Empty `reference_person_name` (whitespace only) → 400 (CHECK constraint should not surface as 500; if it does, document and fix) |
| E10.3 | After commit/cancel: 400/403 (or trigger-rejected) |
| E10.4 | Storage not configured → 503 |

#### E11. `GET /shifts/current`
| Test | Description |
|---|---|
| E11.1 | Caller has no active shift → `{ shift: null }` |
| E11.2 | Caller is `INVITED` on `INVITING` shift → returned |
| E11.3 | Caller is `CACHE_READY` on `IN_PROGRESS` → returned |
| E11.4 | Caller is `CLOSE_CONFIRMED` on `CLOSE_REQUESTED`, not lead → filtered out |
| E11.5 | Caller is `CLOSE_CONFIRMED` on `CLOSE_REQUESTED`, **is** lead → returned |
| E11.6 | Caller is `DECLINED` → never returned |
| E11.7 | Shift in `READY_TO_COMMIT` → **excluded** (encodes the known bug; this test will need to flip when the bug is fixed) |
| E11.8 | Multiple eligible shifts → picks the most recent active over older ones |

#### E12. `GET /shifts/{id}/waiting-room`
| Test | Description |
|---|---|
| E12.1 | Participant gets the roster |
| E12.2 | Caller from another tenant → 403 ("shift not found for current tenant") |
| E12.3 | Caller is not a participant → 403 |
| E12.4 | **Caller is `DECLINED`** → currently returns 200 with the roster (encodes known bug; test will flip when fixed) |
| E12.5 | After ACCEPTED removal: `accepted_at` is **not** in the response payload |

#### E13. `GET /shifts/{id}/events` (SSE)
| Test | Description |
|---|---|
| E13.1 | Subscriber gets a `participants-updated` event after a participant change in another connection |
| E13.2 | DECLINED participant can still subscribe (encodes known bug) |
| E13.3 | Caller is not a participant → 403 |
| E13.4 | Two subscribers both receive the same event |

### F. Maintenance work

#### F1. `POST /maintenance/works/{work_id}/sync` — validation
One test per validation rule (each is a 400):
- F1.1 invalid status string
- F1.2 invalid kind
- F1.3 unknown follow-up reason
- F1.4 follow-up required + empty reasons
- F1.5 follow-up not required + reasons present
- F1.6 OTHER without other-text
- F1.7 other-text without OTHER
- F1.8 SERVICE without issue number
- F1.9 SERVICE with whitespace-only issue number → 400 (issue_number must be non-empty after trim)

#### F2. Authorization & state
| Test | Description |
|---|---|
| F2.1 | Caller not a participant of the shift → 403 |
| F2.2 | Shift in `INVITING` → 403 ("only allowed while shift is active") |
| F2.3 | Shift in `IN_PROGRESS` → allowed |
| F2.4 | Shift in `CLOSE_REQUESTED` → allowed |
| F2.5 | Shift in `READY_TO_COMMIT` → allowed |
| F2.6 | Shift in `COMMITTED` → rejected (handler check fires first) |
| F2.7 | Shift in `CANCELLED` → rejected |
| F2.8 | Device from another tenant → 403 |

#### F3. Persistence and invariants
| Test | Description |
|---|---|
| F3.1 | First call inserts a row with all fields populated |
| F3.2 | Second call by same maintainer with same `work_id` updates fields (e.g., status, note) |
| F3.3 | Different maintainer using the same `work_id` → 403 ("belongs to another tenant or maintainer") |
| F3.4 | Two simultaneous `IN_PROGRESS` works for the same maintainer (different `work_id`) → 409 |
| F3.5 | Two simultaneous `IN_PROGRESS` works for the same device by different maintainers → 409 |
| F3.6 | Set status `FINISHED` without `finished_at` → CHECK violation surfaces (currently 500; document) |
| F3.7 | Status `FINISHED` flips the work out of `IN_PROGRESS`, allowing the next `IN_PROGRESS` to succeed |

#### F4. `PUT /maintenance/works/{work_id}/photos/{photo_id}`
| Test | Description |
|---|---|
| F4.1 | Happy path: bytes upload, row inserted, derived `photo_url` matches expected pattern |
| F4.2 | Empty body → 400 |
| F4.3 | 16 MiB body → 400 |
| F4.4 | Unknown content type → 400 |
| F4.5 | Work not owned by caller → 403 |
| F4.6 | Work belongs to a frozen shift → rejected (trigger or handler) |
| F4.7 | `photo_type=MALFUNCTION` → stored as such; default is `MAINTENANCE` |
| F4.8 | Replay with same `(work_id, photo_id)` and mutation_id → identical response, no second GCS upload (assert via the storage stub call counter) |

### G. Labeling (devices, locations, barcodes)

#### G1. Building cache
| Test | Description |
|---|---|
| G1.1 | Building in tenant returns shape `{ building, locations, devices }`; devices include `barcode_history` |
| G1.2 | A device with no active barcode has `code: null` but full history |
| G1.3 | A device with photo has derived `device_photo_url` like `/api/labeling/devices/{id}/photo` |
| G1.4 | Building in another tenant → 403 |

#### G2. `POST /labeling/devices`
| Test | Description |
|---|---|
| G2.1 | Happy path with `existingLocationId` → 201 |
| G2.2 | Happy path with new `location` → 201; new location row inserted |
| G2.3 | Both `existingLocationId` and `location` → 400 |
| G2.4 | Neither → 400 |
| G2.5 | Empty location object → 400 |
| G2.6 | Existing location belongs to a different building → 400 |
| G2.7 | Empty `kind` → 400 |
| G2.8 | Invalid `kind` (not in enum) → 400 ("invalid device kind") |
| G2.9 | Duplicate `sourceDeviceCode` for the tenant → 409 |
| G2.10 | Optional `barcode` already used by another device → 409 |
| G2.11 | Optional `barcode` not previously used → barcode row created |
| G2.12 | Optional `barcode` previously deactivated for a *different* device → 409 (same conflict as an active code; at create-device time the new device is brand new so reactivation is unreachable) |

#### G3. `POST /labeling/devices/{id}/barcode`
| Test | Description |
|---|---|
| G3.1 | First barcode → inserted |
| G3.2 | Replace existing barcode → old one deactivated (`deactivated_at` set), new active |
| G3.3 | Same code re-assigned to same device → no-op (no duplicate insert, no deactivation) |
| G3.4 | Code already on another device → 409 |
| G3.5 | Empty/whitespace code → 400 |

#### G4. `POST /labeling/devices/{src}/barcode-correction`
| Test | Description |
|---|---|
| G4.1 | source==target → 400 |
| G4.2 | Source has no barcode → 409 |
| G4.3 | Target has 2+ barcodes AND maintenance history → 409 |
| G4.4 | Target eligible (no barcode, no history) → barcode + photo move; 0 maintenance moved |
| G4.5 | Target eligible with maintenance history but ≤1 barcode → barcode moves; maintenance does NOT move |
| G4.6 | Source has maintenance, target has none → maintenance count = source count moved |
| G4.7 | Source and target both have an active code → codes are swapped |
| G4.8 | Source and target had identical active codes → no swap; only one row |
| G4.9 | Photo was on source → moves to target, source has `device_photo_url=NULL` |
| G4.10 | Concurrent `IN_PROGRESS` maintenance on target during the move → 409 |
| G4.11 | Source's shift is frozen → 409 ("frozen shifts cannot be reassigned") |

#### G5. Device photo lifecycle
| Test | Description |
|---|---|
| G5.1 | PUT then GET → bytes round-trip with the recorded content type |
| G5.2 | DELETE then GET → 403 |
| G5.3 | DELETE on a device with no photo → 204 |
| G5.4 | PUT with body > 15 MiB → 400 |
| G5.5 | PUT with `Content-Type: application/json` → 400 (not a recognized image type) |

#### G6. `POST /labeling/buildings/{id}/locations`
| Test | Description |
|---|---|
| G6.1 | Happy path → 201 |
| G6.2 | All four fields empty → 400 |
| G6.3 | Building from another tenant → 403 |

#### G7. `PATCH /labeling/devices/{id}/details`
| Test | Description |
|---|---|
| G7.1 | Updates device fields and the linked location |
| G7.2 | Empty kind → 400 |
| G7.3 | Duplicate sourceDeviceCode → 409 |
| G7.4 | `isMaintainable` omitted → existing value preserved |

### H. Admin endpoints

These are largely read-only; cover them with smoke tests rather than exhaustive matrices.

| Test | Description |
|---|---|
| H1 | `GET /admin/shifts` returns shifts for tenant only; counts exclude `DECLINED` participants |
| H2 | `GET /admin/shifts/{id}` payload does **not** include `accepted_at` (post-migration) |
| H3 | `POST /admin/users` requires `require_admin`; duplicate email within tenant → 409/400 (DB unique constraint) |
| H4 | `PATCH /admin/users/{id}` flipping `is_active=false` invalidates that user's existing sessions (via `/auth/me` returning 401 on the next call) |
| H5 | `GET /admin/maintenances/{id}` returns 403 for cross-tenant id |
| H6 | `GET /users/invite-candidates` excludes the caller, excludes inactive users |

### I. Database trigger behavior

These tests live closer to the schema than to handlers. Use a small "raw SQL" test module that bypasses the HTTP layer to assert trigger behavior directly. This catches regressions when handler code starts allowing things the DB still forbids.

| Test | Description |
|---|---|
| I1 | INSERT `shift_participants` into a `READY_TO_COMMIT` shift → trigger raises |
| I2 | UPDATE `shift_participants.status` on a `COMMITTED` shift → raises |
| I3 | DELETE `shift_participants` row from a `CANCELLED` shift → raises |
| I4 | INSERT `maintenance_works` into a frozen shift → raises |
| I5 | INSERT `maintenance_photos` for a work whose shift is frozen → raises |
| I6 | UPDATE `shifts` to change `building_id` after `READY_TO_COMMIT` → raises |
| I7 | UPDATE `shifts` setting `report_url` for the first time on a `COMMITTED` shift → succeeds |
| I8 | UPDATE `shifts` setting `report_url` on a `COMMITTED` shift that already has a `report_url` → raises |
| I9 | Unique partial index `maintenance_works_one_active_per_user` blocks two `IN_PROGRESS` rows for the same user (asserts at the DB layer, not the handler — this is the safety net behind F3.4) |
| I10 | Same for `_per_device` |
| I11 | Unique partial index `barcodes_one_active_per_device_idx` blocks two active barcodes for one device |

### J. Idempotency replay edge cases (cross-cutting)

A small focused module to keep these in one place rather than re-asserting across every endpoint:

| Test | Description |
|---|---|
| J1 | First call returns 200 with body B. Second call (same key) returns identical body B even after the underlying entity has been modified by another call |
| J2 | First call returns a 4xx error. Replay does NOT return a cached response — only successful calls write to `processed_mutations`. Replaying with the original (still-bad) body returns the same 400; replaying the same key with corrected body succeeds. (Caching only successes avoids retry-lockout on transient 5xxs.) |
| J3 | Concurrent calls with the same `X-Mutation-Id`: only one wins; the other gets either the cached response or a serializable conflict mapped to 5xx (document the chosen behavior; today the unique constraint on `processed_mutations` is what enforces this) |
| J4 | A call that returns a non-JSON body (e.g., 204 NO_CONTENT from logout/decline) — replay still returns 204 (asserts the body=None branch of `replay_processed_mutation_response`) |

### K. Shift event hub (SSE plumbing)

These are unit-style tests against the `ShiftEventHub` rather than HTTP integration:

| Test | Description |
|---|---|
| K1 | `subscribe` then `publish_participants_updated` → receiver gets one message with `event_type=participants-updated` |
| K2 | Two subscribers on the same shift_id both receive the event |
| K3 | Subscriber on a different shift_id does not receive it |
| K4 | `subscribe` after a publish receives nothing (broadcast does not buffer) |
| K5 | Slow subscriber that lags past channel capacity → receives a synthetic catch-up event (the `BroadcastStreamRecvError::Lagged` branch) |

### L. Performance / pagination — out of scope for the first pass

Note for follow-up: the admin list endpoints don't appear to paginate. As tenant data grows, this becomes a real problem. Worth flagging in a separate test plan once pagination ships.

---

## Recommended ordering

Prioritized by **incident risk × test cost**:

1. **B (tenancy isolation)** + **C (role gates)** + **D (idempotency)** — small, parameterized, catch the worst classes of bugs cheaply. ~30 tests total.
2. **E (shift lifecycle)** — the core state machine and its invariants. ~35 tests.
3. **I (DB trigger behavior)** — the safety net under everything; cheap to write directly.
4. **F (maintenance work)** — second-largest behavior surface. ~25 tests.
5. **G (labeling)** — important but lower-stakes than shifts; some of the rules (barcode correction) are subtle and worth careful coverage.
6. **A (auth)** — write the happy paths early but defer the JWKS/JWT branches behind a test fixture investment.
7. **H (admin)** — smoke tests after the rest is green.
8. **K (SSE hub)** — quick wins, run last.

A reasonable first PR target: A1.1 + A2.* + A3.* + B + C + D + E1–E5 + F1 + I — roughly 80 tests, all small, no GCS or JWKS investment yet.
