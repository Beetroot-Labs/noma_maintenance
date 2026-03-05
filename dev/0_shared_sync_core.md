# Phase 0: Shared Sync Core (Thin Foundation)

## Goal
Create the shared auth + sync primitives so every later vertical slice can ship with offline behavior without redesigning the core.

## Scope A: Main App Auth Foundation
- Integrate shared `AuthProvider` in main app root.
- Add login screen using Google auth (`/api/auth/google`).
- Protect main app routes.
- Session re-hydration on refresh (`/api/auth/me`).
- Logout flow (`/api/auth/logout`) and local auth-state reset.

### Done When
- Unauthenticated users always land on login.
- Refresh keeps authenticated users in app.
- Logged-out refresh never shows protected pages.

## Scope B: Shared Offline Sync Core
- Standard outbox item format:
  - `id`
  - `mutation_type`
  - `entity_type`
  - `entity_id`
  - `payload_json`
  - `status` (`PENDING`, `IN_PROGRESS`, `FAILED`, `DONE`)
  - `retryable`
  - `attempt_count`, `last_attempt_at`, `last_error`
  - `created_at`, `updated_at`
- Sync runner skeleton:
  - immediate sync on write
  - retry on `online` and app resume
  - periodic retry with backoff
- Shared UI status primitives:
  - pending/retryable/failed counters
  - retry action hook

### Done When
- One mutation type can be queued, synced, retried, and shown in UI status end-to-end.

## Scope C: Backend Idempotency Contract
- Require idempotency key (`mutation_id`) for write endpoints used by offline sync.
- Persist processed mutation IDs server-side.
- Duplicate replay returns same effective result (no duplicate side effects).

### Done When
- Replaying the same mutation does not duplicate rows or state transitions.

## Scope D: Error/Conflict Baseline
- Standard API error shape for sync endpoints.
- Client categorization:
  - retryable: network, `5xx`, `429`
  - non-retryable: business-rule `4xx`
- Surface non-retryable failures clearly for user action.

### Done When
- Failed mutations are visible and actionable, and retry behavior matches error class.

## Exit Criteria
- Main app auth is stable (`login/refresh/logout`).
- Shared outbox + sync runner are in place and reusable.
- Backend idempotency is enforced for at least one mutation endpoint.
- Reconnect scenario is proven: no duplicate writes, clear user feedback.
