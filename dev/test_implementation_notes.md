# Backend Test Implementation Notes

A reference for the `backend/src/tests/` suite. Reading order: top sections answer common lookups; the session log at the bottom is historical context only.

---

## TL;DR

| | |
|---|---|
| **Status** | 173 tests passing, 0 failing, ~42 s wall clock |
| **Coverage** | All sections of `dev/backend_test_plan.md` except those needing GCS or JWKS fixtures |
| **Run** | `DATABASE_URL=postgres://test:test@localhost:5544/test cargo test --tests` |
| **DB** | `noma_test_pg` Docker container — Postgres 17 on port 5544, user/pass/db `test` |

```
test result: ok. 173 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 41.52s
```

---

## Where to find tests by area

Plan sections map 1:1 to `backend/src/tests/<file>.rs` modules.

| Plan area | Test file | Cases | Notes |
|---|---|---|---|
| A — Auth/session | `auth_session.rs` | 9 | A2.1–A2.5, A3.1–A3.4. **A1 (JWKS) deferred.** |
| B — Tenancy isolation | `tenancy.rs` | (prior) | B1–B4 |
| C — Role gates | `roles.rs` | (prior) | C1.* |
| D — Idempotency | `idempotency.rs` | 7 | D1–D7 |
| E1 — Create shift | `shift_creation.rs` | 5 | |
| E2–E3 — Participants | `shift_participants.rs` | 10 | |
| E4–E5 — Join/decline | `shift_readiness.rs` | 8 | |
| E6–E8 — Close/commit | `shift_closing.rs` | 10 | |
| E9 — Cancel | `shift_cancellation.rs` | 5 | |
| E11–E12 — Queries | `shift_queries.rs` | 9 | |
| **E10, E13 — Signature, SSE-HTTP** | — | — | **Deferred** (Storage seam, streaming client) |
| F1 — Maintenance validation | `maintenance_validation.rs` | 9 | |
| F2 — Maintenance auth/state | `maintenance_authorization.rs` | 8 | |
| F3 — Maintenance persistence | `maintenance_persistence.rs` | 7 | |
| F4 — Maintenance photos | `maintenance_photos.rs` | 6 | **F4.1/F4.7/F4.8 deferred** (Storage seam) |
| G1 — Building cache | `labeling_building_cache.rs` | 4 | |
| G2 — Create device | `labeling_create_device.rs` | 12 | G2.12 reframed (see *Divergences*) |
| G3 — Assign barcode | `labeling_assign_barcode.rs` | 5 | |
| G4 — Barcode correction | `labeling_correct_barcode.rs` | 10 | **G4.10 skipped** (unreachable via API) |
| G5 — Photo lifecycle | `labeling_device_photo.rs` | 5 | **G5.1/G5.2 deferred** (Storage seam) |
| G6 — Create location | `labeling_create_location.rs` | 3 | |
| G7 — Device details | `labeling_update_device_details.rs` | 4 | |
| H — Admin smoke | `admin_smoke.rs` | 7 | H3 split into role-gate + duplicate-email |
| I — DB triggers | `triggers.rs` | 11 | |
| J — Idempotency replay | `idempotency_replay.rs` | 3 | J1≈D7, J3 not deterministic |
| K — SSE hub | `sse_hub.rs` | 5 | Unit-tests; K5 covers receiver-lag, not HTTP layer |
| **L — Pagination** | — | — | **Out of scope** (endpoints don't paginate yet) |

Helpers shared across all files: `helpers.rs`. Module registration: `mod.rs`.

---

## Contract divergences from the plan

Tests below assert what the **code actually does**, not what the plan says. When the team wants the contract to match the plan, change the code and update the test in the same commit. Each diverging test has a `// documents actual behavior` comment in the source.

| Plan said | Code does | Test resolution |
|---|---|---|
| H4: `PATCH /admin/users/{id}` flips `is_active` | Endpoint has no `is_active` field | Flip via SQL; assert next `/auth/me` returns 401. The contract under test is the `is_active = TRUE` clause in `require_session_user`. |
| H6: `/users/invite-candidates` excludes the caller | Source filters only `is_active=FALSE` and `role=VIEWER` | Test asserts the caller IS in the list. (Frontend handles caller-exclusion.) |

---

## What's deferred (in order of unlock value)

Each item lists the unlock cost and what becomes testable.

### 1. Storage trait seam
**Cost:** small refactor. Introduce a `Storage` trait that handlers call instead of `cloud_storage::Object::create/download/delete` directly.
**Unlocks:** F4.1, F4.7, F4.8, G5.1, G5.2, E10.1–E10.4.

### 2. JWKS fake server
**Cost:** ~half a day. Stand up an `httptest`-style server, sign tokens with a known RSA key, point `state.client` at it.
**Unlocks:** A1.1–A1.10 (~10 tests).

### 3. SSE streaming client helper
**Cost:** small. Need a helper that drives an SSE response and reads events chunk-by-chunk.
**Unlocks:** K5 at the HTTP layer (today K5 only asserts the underlying `broadcast::Receiver`'s lag behavior); E13.1–E13.4.

### 4. Pagination tests (L)
**Cost:** out of scope until pagination ships. Admin list endpoints currently return everything.

### Tests skipped on principle (not blocked by infra)

- **G4.10** (concurrent IN_PROGRESS on target during barcode correction). The eligibility gate plus the move-only-when-target-empty rule means the per-device unique-index conflict is unreachable via the API in a single transaction. Already covered at the DB layer by `triggers::i9/i10`.
- **J1** is the same contract as D7 — duplication.
- **J3** (concurrent same-key) is not deterministic with `sqlx::test`'s single-connection-per-test model.

---

## Helpers reference (`tests/helpers.rs`)

### Router builders
- `build_router(pool)` — `state.storage = None`. Use this when testing a 503 storage path or any non-storage endpoint.
- `build_router_with_fake_storage(pool)` — `state.storage = Some(...)` with bogus bucket/prefix strings. Only the *pre*-GCS-call branches reach valid execution; reaching `Object::create` would mean the test is wrong.

### HTTP helpers
- `call(router, req) -> (StatusCode, Bytes)` — drives a `oneshot` and reads the body.
- `make_req(method, path, token, mutation_id, json_body)` — JSON-shaped requests.
- `make_req_raw_mid(...)` — same but lets you pass a malformed mutation_id (whitespace, oversized).

### Seeders (each returns a typed handle)
| Function | Returns | Notes |
|---|---|---|
| `seed_tenant(pool)` | `SeededTenant { id }` | |
| `seed_user(pool, tenant_id, role)` | `SeededUser { id, tenant_id, session_token }` | Inserts row + active session; pass role as string (`"ADMIN"`, `"LEAD_TECHNICIAN"`, etc.) |
| `seed_building(pool, tenant_id)` | `SeededBuilding { id, tenant_id }` | |
| `seed_location(pool, tenant_id, building_id)` | `SeededLocation { id }` | Standalone; use when you don't need a device |
| `seed_device(pool, tenant_id, building_id)` | `SeededDevice { id, tenant_id, location_id }` | Creates fresh location + FAN_COIL device |
| `seed_shift(pool, tenant_id, building_id, lead_id)` | `SeededShift { id, tenant_id, lead_id }` | Always IN_PROGRESS with lead as CACHE_READY |
| `seed_shift_in_state(pool, tenant_id, building_id, lead_id, status)` | `SeededShift` | Inserts as IN_PROGRESS, attaches lead, then UPDATEs to target status — works around participant-trigger ordering |
| `add_participant(pool, tenant_id, shift_id, user_id, status)` | — | Sets `invited_at`/`cache_ready_at`/`close_confirmed_at` consistent with the status |
| `seed_barcode_active(pool, tenant_id, device_id, code)` | — | `code` must be ≤ 18 chars (varchar(18)) |
| `seed_barcode_deactivated(pool, tenant_id, device_id, code)` | — | |
| `seed_maintenance_work(pool, tenant_id, shift_id, device_id, maintainer)` | `Uuid` | Inserts as FINISHED to dodge IN_PROGRESS unique-index pitfalls |

### Assertion helpers
- `shift_status(pool, shift_id) -> Option<String>`
- `participant_status(pool, shift_id, user_id) -> Option<String>`

### Schema gotchas to remember when seeding
- `barcodes.code` is `varchar(18)`. Keep test codes short.
- Frozen-shift triggers (`READY_TO_COMMIT`, `COMMITTED`, `CANCELLED`) reject participant inserts and most maintenance UPDATEs. Use `seed_shift_in_state` for frozen targets.
- The maintenance trigger only fires for `READY_TO_COMMIT`/`COMMITTED` when `report_url IS NOT NULL`; for unambiguous frozen-trigger setups (e.g., I4, G4.11), use `CANCELLED`.

---

## Conventions for adding a new test

1. **One file per behavior area.** If you're adding to an existing file, keep it under ~300 lines; otherwise split.
2. **`#[sqlx::test(migrator = "MIGRATOR")]`** for tests that need a DB; `#[tokio::test]` for pure unit tests (e.g., `sse_hub.rs`).
3. **Each test's name encodes plan-id + behavior**: `g4_5_target_with_maintenance_only_moves_barcode`.
4. **Test the contract, not the implementation.** Assertions reach into the DB only when the response shape doesn't already prove the behavior.
5. **Test actual behavior, comment the divergence.** When the plan and code disagree, write the test against the code and add a `// documents actual behavior` comment with the rationale. Don't write aspirational tests.
6. **Mutation-id endpoints need `Some(&Uuid::new_v4().to_string())` in `make_req`.** Forgetting it → 400 "missing X-Mutation-Id".
7. **Frozen-shift setup pattern**: insert as IN_PROGRESS, attach participants, *then* `UPDATE shifts SET status = ...`. Direct insert into a frozen state will trip participant triggers.

---

## File layout

```
backend/src/tests/
├── helpers.rs                              shared seeders, router builders, request helpers
├── mod.rs                                  module registration
├── admin_smoke.rs                          H1–H6
├── auth_session.rs                         A2.*, A3.*
├── idempotency.rs                          D1–D7
├── idempotency_replay.rs                   J2, J2b, J4
├── labeling_assign_barcode.rs              G3.*
├── labeling_building_cache.rs              G1.*
├── labeling_correct_barcode.rs             G4.* (G4.10 skipped)
├── labeling_create_device.rs               G2.*
├── labeling_create_location.rs             G6.*
├── labeling_device_photo.rs                G5 (partial — pre-GCS only)
├── labeling_update_device_details.rs       G7.*
├── maintenance_authorization.rs            F2.*
├── maintenance_persistence.rs              F3.*
├── maintenance_photos.rs                   F4 (partial — pre-GCS only)
├── maintenance_validation.rs               F1.*
├── roles.rs                                C1.*
├── shift_cancellation.rs                   E9.*
├── shift_closing.rs                        E6–E8
├── shift_creation.rs                       E1.*
├── shift_participants.rs                   E2–E3
├── shift_queries.rs                        E11–E12
├── shift_readiness.rs                      E4–E5
├── sse_hub.rs                              K1–K5
├── tenancy.rs                              B1–B4
└── triggers.rs                             I1–I11
```

---

<details>
<summary><b>Session log (historical — safe to skip)</b></summary>

### Starting state
- 105 tests across 13 files — sections B, C, D, E, F partial, I done in prior sessions.
- Branch: `remove-accepted-participant-state` (relevant for H2 regression test).

### What landed this session
67 new tests across 11 new files. Final count: 172.

### Bugs caught during implementation
- `barcodes.code` is `varchar(18)` — original G2.12 code "DEACTIVATED-ELSEWHERE" was 21 chars. Shortened. Helper docs updated.
- `CreateAdminUserRequest` uses snake_case (`full_name`), not the camelCase serde rename used elsewhere in labeling. Fixed both H3 subtests.
- `ShiftEventMessage` lacks `Debug`; rewrote a `panic!("...{other:?}...")` in K5 with explicit match arms instead of touching `state.rs`.
- One spurious type-annotation issue from `.map(|(b, m, s)| ...)` on a query result — replaced with a direct typed `query_as`.
- Two unused `Uuid` imports — removed.

### Helper additions
- `SeededLocation { id }` and a standalone `seed_location()` (was previously inlined inside `seed_device`).
- `seed_device` now exposes `location_id` so G7 can assert location-row updates without a second query.
- `seed_barcode_active` / `seed_barcode_deactivated` (two named functions read better than one with a boolean).
- `seed_maintenance_work` always inserts FINISHED to avoid the IN_PROGRESS partial-unique pitfalls during setup.

### Why the seven-file G split
A single `labeling.rs` would have been ~1500 lines. Per-area splits keep each file ~150–300 lines and let `cargo test labeling_correct` scope to one area. Matches the existing `shift_*` and `maintenance_*` convention.

</details>
