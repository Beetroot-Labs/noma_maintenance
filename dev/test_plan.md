# Test Plan — User Flows & Critical Features

A working list of the user flows and feature areas worth covering, with notes on what to assert and where the highest-value coverage sits.

## Typical user flows

### 1. Lead creates a shift
The path most affected by the ACCEPTED-state removal — verify Option B's invariants hold.

- Online happy path: cache prep finishes → shift is created → lead lands on `/shifts/current` as `CACHE_READY`
- Cache prep fails (kill the network mid-`rebuildBuildingSnapshot`): no shift gets created on the server (key win of Option B)
- Shift creation fails after cache prep succeeds: cache is left in IndexedDB but no shift exists; verify next attempt isn't broken
- Building list is empty: button stays disabled, no crash

### 2. Invite + accept flow
- Lead invites a technician → invitee sees the shift on `/home` as `INVITED` with Accept/Decline buttons
- Invitee taps Accept → cache prep runs → status flips to `CACHE_READY` → can navigate into the shift
- Invitee taps Decline → status flips to `DECLINED`, shift disappears from their `/home`
- Re-invite a previously-declined user → they should see the invite again as `INVITED` (the simplified ON CONFLICT path)

### 3. Concurrent participants joining
- Two invitees accept at roughly the same time → both end up `CACHE_READY`, neither stomps the other, SSE pushes both updates to the lead
- Lead sees the participant table update in real time (via the SSE channel)

### 4. Maintenance work — the offline core
- Start maintenance on a device while online → finish with photo + notes → confirm sync
- Start maintenance offline → app should let you finish, queue to outbox, sync on reconnect
- Try to start a second concurrent maintenance as the same user → should be blocked (unique partial index)
- Try to start maintenance on a device that someone else is already working on → blocked
- `SERVICE` kind without an issue number → can't finish (DB check constraint + UI validation)
- Followup-required without selecting reasons → can't finish; "Egyéb" reason without text → can't finish
- Photo missing on `ROUTINE` finish → blocked; on followup-required, photo not required (verify UI logic matches)

### 5. Shift close / commit
- Lead requests close → all participants see `CLOSE_REQUESTED`
- Each participant confirms close → status flips to `CLOSE_CONFIRMED`
- After last confirmation, shift moves to `READY_TO_COMMIT` — **⚠ known bug**: lead currently has no UI path to commit from there
- Try to edit a maintenance after the shift is committed → DB trigger should reject (good integration-test target)

### 6. Reconnect and replay
- Queue several maintenance mutations offline → reconnect → outbox replays them in order with idempotency intact (re-running the same `X-Mutation-Id` returns the cached response)
- Same mutation replayed twice (e.g., user retries) → no duplicate row

### 7. Auth / multi-tenancy
- User from tenant A cannot see/touch shifts, devices, or maintenance from tenant B (every backend query filters by `tenant_id` — easy to break, worth a parameterized test)
- Logged-out user on a protected route → redirect to login
- Session expiry mid-action → graceful failure, not a hung outbox

### 8. Role-based gates
- Technician tries to hit `/admin/*` endpoints → 403
- Technician tries to create a shift → 403 (`require_lead_or_admin`)
- Declined participant tries to hit `/shifts/{id}/waiting-room` or SSE — **⚠ currently allowed** (known bug); a good test once it's fixed

## Critical features — highest-value coverage

| Area | Why it matters |
|---|---|
| Shift state machine transitions | DB triggers enforce immutability of frozen shifts — regressions here corrupt audit data |
| Outbox replay + idempotency | Field technicians depend on this; silent data loss is the worst possible outcome |
| One-active-maintenance invariants | Enforced in UI and via unique partial index — divergence between them is a real bug source |
| Tenant isolation | Multi-tenant SaaS — a leak across tenants is a serious incident |
| SSE participant updates | New "live coordination" layer; easy to silently drop messages |
| `READY_TO_COMMIT` lead UX | Already known broken — anything tested here will catch the fix when it lands |
| Migration safety | This PR's migration is not idempotent (`DROP COLUMN` would error on re-run); consider `IF EXISTS` |

## Two highest-leverage test additions

If only two test efforts are funded, prioritize these:

1. **Integration test for the shift state machine** — start → invite → join → maintenance → close → commit, against a real Postgres (covers triggers, idempotency, multi-actor coordination)
2. **Outbox replay test** — simulate network drops mid-sync; assert ordering, idempotency, and no duplicate rows
