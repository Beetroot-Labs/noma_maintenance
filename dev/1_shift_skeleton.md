# Phase 1: Shift Skeleton (Invite -> Cache Ready -> Start)

## Goal
Deliver one full multi-user shift bootstrap flow end-to-end: lead invites participants, participants accept and cache building data, lead starts shift when everyone is ready.

## Scope A: Shift Creation + Invite
- DB:
  - Use `shifts` with initial `status = INVITING`.
  - Use `shift_participants` rows with `status = INVITED`.
- API:
  - `POST /api/shifts` (lead creates shift for one building)
  - `POST /api/shifts/{shiftId}/participants` (invite users)
  - permission rules:
    - creator must be `LEAD_TECHNICIAN` or `ADMIN`
    - invite targets must be non-`VIEWER`
    - all users must belong to same tenant
- UI:
  - lead flow to select building and select participants
  - invite summary view with participant statuses
- Push:
  - invitation notification to each invited participant.

### Done When
- Lead can create one shift and invite multiple users.
- Invited users receive pending invitation state in app (push or fetch fallback).

## Scope B: Participant Accept + Cache-Ready ACK
- API:
  - `POST /api/shifts/{shiftId}/accept`
  - `POST /api/shifts/{shiftId}/cache-ready`
  - idempotent by `X-Mutation-Id` for offline replay safety
- Behavior:
  - participant marks accepted first
  - app caches selected building data
  - only after successful local cache, send cache-ready ACK
- Offline:
  - if offline after local cache, enqueue ACK in outbox and retry later
  - server state eventually converges to `CACHE_READY`
- UI:
  - participant sees invitation card with `Accept` action and caching progress
  - lead sees live/refreshable participant status list.

### Done When
- Participant can accept and become `CACHE_READY`.
- Offline ACK replay works and does not duplicate side effects.

## Scope C: Start Shift Gate
- API:
  - `POST /api/shifts/{shiftId}/start`
- Rule:
  - allowed only if every non-declined participant is `CACHE_READY`
  - transition `shifts.status`: `INVITING|READY_TO_START -> IN_PROGRESS`
  - set `started_at`
- UI:
  - lead sees disabled/enabled `Start shift` button based on readiness gate
  - all participants are redirected to maintenance overview after start.

### Done When
- Lead cannot start early.
- Lead can start immediately after all required participants are cache-ready.
- All participants land on the in-progress shift overview.

## Scope D: Baseline Reliability and Guards
- Enforce tenant isolation on all shift endpoints.
- Enforce valid state transitions in backend.
- Return standardized sync-friendly errors (`error`, `code`, `retryable`).
- Add basic audit fields in responses (`invited_at`, `accepted_at`, `cache_ready_at`, `started_at`).

### Done When
- Invalid transitions are rejected with clear error codes.
- Repeated client retries are safe and deterministic.

## Exit Criteria
- One real scenario works: `create -> invite -> accept -> cache-ready -> start`.
- Offline participant ACKs replay correctly after reconnect.
- No duplicate participant state transitions from retries.
- Lead sees accurate readiness and can start exactly when gate is satisfied.
