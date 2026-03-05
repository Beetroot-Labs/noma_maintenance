# Development Roadmap

## Phase 0: Shared Sync Core (Thin Foundation)
[Details](./0_shared_sync_core.md)

## Phase 1: Shift Skeleton (End-to-End, no maintenance details)
- DB: `shifts`, `shift_participants`, status enums
- API: create shift, invite users, accept invite, cache-ready ack, start shift
- UI: lead invite screen + participant invite/accept flow
- Push: invitation notification wired
- Offline-by-slice scope:
  - queue participant acknowledgements when offline
  - persist selected shift/building snapshot locally after start
- Done when: one full `invite -> all cache ready -> start shift` works, and reconnect can flush pending acknowledgements

## Phase 2: Shift Closing & Commit
- API/UI: close request, participant close confirmations, ready-to-commit gate
- Summary generation endpoint + basic summary screen
- Signature capture + store in GCS
- Commit action + immutability enforcement
- Push: close-request notification
- Offline-by-slice scope:
  - close confirmations queue when offline
  - summary/commit steps clearly guarded as online-required
- Done when: one started shift can be closed and committed end-to-end, including delayed confirmation replay

## Phase 3: Maintenance Work Core
- DB/API: `maintenance_works`, one active maintenance/user rule
- UI: start by device list and barcode scan
- DeviceDetails maintenance mode with:
  - note
  - malfunction description
  - abort / finish
- Offline-by-slice scope:
  - start/abort/finish/note are local-first and outbox-backed
  - one-active-maintenance invariants enforced locally and server-side
- Done when: technician can complete one full maintenance cycle offline and later sync without duplicates

## Phase 4: Photo Workflow
- DB/API: `maintenance_photos`
- UI: attach photo + capture note
- Validation rules:
  - finish requires at least one photo
  - malfunction requires description + malfunction photo
- Sync: offline outbox for maintenance photos
- Done when: maintenance completion rules enforced and offline photo uploads replay reliably after reconnect

## Phase 5: Multi-User Live Coordination
- Real-time updates (SSE/WebSocket) for shift/participant/maintenance status
- Auto-redirect all participants on shift start/close
- Better conflict handling and retry UX
- Offline constraint: fallback polling + local state continuity if real-time channel drops
- Done when: all participants see consistent state transitions online, and recover cleanly after reconnect

## Phase 6: Audit, Reporting, Hardening
- Shift summary format finalization (PDF/export)
- Access-control checks by role in all endpoints
- Observability, admin diagnostics, backfill scripts
- E2E tests for state machine transitions
- Offline-focused tests:
  - airplane-mode scenarios
  - reconnect + replay ordering
  - duplicate replay idempotency
- Done when: operations can trust data, including offline-reconciled shifts across all slices
