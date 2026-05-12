# Backend Behavior Reference

A description of every HTTP endpoint exposed by the Rust backend: what it does, who is allowed to call it, what inputs it accepts, what it returns on success, and what it returns / does on failure or in edge cases. Written as documentation, not as a code walkthrough — the goal is that someone reading this should be able to predict the system's behavior without opening `*.rs`.

## Cross-cutting behavior

These rules apply to almost every endpoint and are worth understanding before reading the per-endpoint sections.

### Authentication
- Sessions are cookie-based. The cookie name defaults to `noma_session` (configurable via `SESSION_COOKIE_NAME`).
- The cookie holds a random opaque token; the server stores its SHA-256 hash in the `sessions` table.
- A session is valid only if: the hash exists, `revoked_at` is NULL, `expires_at` is in the future, and the owning user is `is_active = TRUE`.
- Any endpoint that calls `require_session_user` returns **401 UNAUTHORIZED** if the cookie is missing or invalid.
- The login endpoint (`POST /auth/google`) is the sole way to obtain a session. Logging out (`POST /auth/logout`) marks the session `revoked_at = NOW()` and emits an expired-cookie header.

### Tenancy
- Every domain table has a `tenant_id`. Every query filters by the caller's `tenant_id`. Cross-tenant access is impossible by construction: a request whose user belongs to tenant A asking for an entity from tenant B receives a **403 FORBIDDEN** with a "not found for current tenant" message — never the entity, and never a 404 that would leak existence.

### Roles
- Three role gates exist in code: `ADMIN`, `LEAD_TECHNICIAN`, and "anyone with a session." A `VIEWER` role exists in the schema but no endpoint grants it specific privileges today (it behaves like a session-only user).
- `require_lead_or_admin`: returns **403** unless role is `ADMIN` or `LEAD_TECHNICIAN`. Used by shift creation, summary access, and admin user creation.
- `require_admin`: defined but currently unused (admin-only endpoints rely on `require_lead_or_admin`).

### Mutation idempotency
- Every write endpoint requires the header `X-Mutation-Id` (string ≤ 128 chars). Missing or empty header → **400 BAD_REQUEST** ("missing X-Mutation-Id header"). Length > 128 → **400** ("X-Mutation-Id is too long").
- Each endpoint defines an `endpoint_key` (e.g. `MAINTENANCE_WORK_SYNC:<work_id>`). The `(tenant_id, endpoint_key, mutation_id)` triple is recorded in `processed_mutations` along with the response status and JSON body.
- Replay: if the same `(tenant_id, endpoint_key, mutation_id)` is seen again, the recorded response is returned **byte-for-byte** — the underlying logic does not run a second time. This is what makes the offline outbox safe: clients can retry freely.
- The mutation ID is scoped per endpoint, so two different endpoints can use the same `X-Mutation-Id` without collision.

### Frozen-shift triggers
The DB enforces, via `BEFORE` triggers, that:
- A shift in status `READY_TO_COMMIT`, `COMMITTED`, or `CANCELLED` is "frozen."
- Frozen shifts cannot be `DELETE`d, and most field updates are rejected. `READY_TO_COMMIT` allows the transition to `COMMITTED` and certain commit-related field changes; `COMMITTED` allows only the one-time setting of `report_url`. `CANCELLED` is fully immutable.
- Participants, signature, maintenance works, and maintenance photos all have parallel triggers preventing INSERT/UPDATE/DELETE on frozen shifts. Errors raised by these triggers surface to the API as **500 INTERNAL** unless the handler maps them — the barcode-correction handler maps "frozen shift" trigger messages to **409 CONFLICT** explicitly.

### SSE for shift events
- `GET /api/shifts/{shift_id}/events` opens a Server-Sent Events stream that emits a `participants-updated` event whenever the participants of that shift change (join, decline, add, remove, close-confirm).
- The hub is per-process and in-memory. Multi-instance deployments would not see each other's events.
- Stream emits keep-alives to prevent idle disconnect.

### Static file serving
- The backend also serves the two frontend SPAs as static files (`/`, `/labeling-app/...`). Not part of the REST API and not covered below.

### Error response shape
Every API error returns JSON `{ "error": "<message>", "code": "<CODE>", "retryable": <bool> }`. `retryable: true` is reserved for `SERVICE_UNAVAILABLE` and `INTERNAL`. All others are `false`.

---

## Authentication endpoints

### `POST /api/auth/google`
**Purpose:** Exchange a Google ID token for a server session.

**Auth:** None (this is how you get a session).

**Body:** `{ "credential": "<google_id_token>" }`

**Success (200):** Sets the session cookie and returns `{ "user": { "id", "tenant_id", "full_name", "email", "role" } }`.

**Behavior & edge cases:**
- The token is verified against Google's JWKS at `https://www.googleapis.com/oauth2/v3/certs`. Algorithm must be RS256; key must be `kty: RSA`, `use: sig`. Audience must match one of the configured `google_client_ids`. Issuer must be `accounts.google.com` or `https://accounts.google.com`. **401** otherwise.
- If `email_verified` is missing or false → **401**.
- If `GOOGLE_HOSTED_DOMAIN` is configured and the token's `hd` claim doesn't match → **403**.
- If the Google `sub` is already linked to a user → that user logs in directly.
- If the Google `sub` is not linked but a user with the same email exists, the Google identity is linked to that user, then login proceeds.
- If the email matches a user that is already linked to a *different* Google `sub` → **403** ("this user is already linked to a different Google account").
- If no user with the email exists → **403** ("no user with this email exists"). The system does not auto-provision users from Google login — they must be created via the admin endpoint first.
- If the user is `is_active = FALSE` → **403** ("user account is inactive").
- On success: `users.last_login_at` and `auth_identities.last_used_at` are bumped to `NOW()`. A new row in `sessions` is inserted with the SHA-256 of a random UUID and an `expires_at` of `NOW() + SESSION_DURATION_DAYS` (default 30).
- Database not configured → **503**. Auth not configured → **503**.

### `GET /api/auth/me`
**Purpose:** Return the current user.

**Auth:** Session required.

**Success (200):** Same `{ user: {...} }` shape as login.

**Edge cases:** **401** if no/invalid session. Does not refresh `last_login_at`.

### `POST /api/auth/logout`
**Purpose:** Invalidate the current session.

**Auth:** None required (idempotent).

**Success (204):** Sets an expired cookie. Updates `sessions.revoked_at = NOW()` for the matching token hash if one is present and not already revoked.

**Edge cases:** No session cookie → still 204 with the expiring cookie header set. Already-revoked session → still 204; no second revoke happens.

---

## Shift lifecycle

### `POST /api/shifts`
**Purpose:** Lead creates a new shift for a building.

**Auth:** Session + `require_lead_or_admin`.

**Body:** `{ "building_id": "<uuid>" }`. Requires `X-Mutation-Id`.

**Success:** Returns `{ "shift_id": "<uuid>" }`.

**Behavior:**
- Building must exist within the caller's tenant. Otherwise **403** ("building not found for current tenant").
- Inserts a new shift row with `status = 'IN_PROGRESS'` and `started_at = NOW()`.
- Inserts the lead as the first `shift_participants` row with `status = 'CACHE_READY'` and `cache_ready_at = NOW()`. (Post the ACCEPTED-state removal: the client is responsible for completing the building cache snapshot before calling this endpoint.)
- Wrapped in a single transaction.

**Edge cases:** Technician role → **403**. Building UUID well-formed but doesn't exist or belongs to another tenant → **403**. DB down → **503**.

### `GET /api/shifts/current`
**Purpose:** Return the caller's active shift, if any.

**Auth:** Session.

**Success:** `{ shift: null }` or `{ shift: { id, status, building_id, building_name, lead_user_name, lead_user_phone, my_participant_status } }`.

**Behavior:**
- Returns the most recent shift where the caller is a participant whose status is `INVITED`, `CACHE_READY`, or `CLOSE_CONFIRMED`, and the shift status is one of `INVITING`, `READY_TO_START`, `IN_PROGRESS`, `CLOSE_REQUESTED`. **`READY_TO_COMMIT` is excluded** — this is the source of the known "lead can't commit from UI" bug.
- A participant who is `CLOSE_CONFIRMED` on a `CLOSE_REQUESTED` shift is filtered out unless they are the lead. (Closes that are no longer the participant's concern stop showing up.)
- Order: prefer `IN_PROGRESS`/`CLOSE_REQUESTED` over earlier statuses, then by `created_at DESC`.
- `DECLINED` participants never see the shift.

### `GET /api/shifts/pending`
**Purpose:** For leads/admins, list shifts they led that are awaiting commit (so they can find unsigned worksheets).

**Auth:** Session + `require_lead_or_admin`.

**Success:** Array of pending shifts: `[ { shift_id, building_name, started_at, close_requested_at } ]`.

**Behavior:** Only shifts in status `READY_TO_COMMIT` led by the caller are returned.

### `POST /api/shifts/{shift_id}/participants`
**Purpose:** Lead invites a user to their shift.

**Auth:** Session. The caller must be the lead of the target shift.

**Body:** `{ "user_id": "<uuid>" }`. Requires `X-Mutation-Id`.

**Success (204).**

**Behavior:**
- Shift must exist within tenant and be in `INVITING`, `READY_TO_START`, or `IN_PROGRESS` (the user can be added even after the shift has started). **403** otherwise.
- Caller must be the lead. Otherwise **403** ("only the shift lead can add participants").
- The candidate user must be eligible — must exist in the same tenant, not be the lead themselves, etc. **400** if not eligible.
- Insert is `ON CONFLICT (shift_id, user_id) DO UPDATE`: if the user previously declined, their row is reset to `INVITED` with cleared timestamps. Otherwise the existing row is left alone.
- After the change, `refresh_shift_ready_state_tx` recomputes whether the shift moves between `INVITING` ↔ `READY_TO_START` based on remaining `INVITED` participants.
- Triggers an SSE `participants-updated` event.
- DB triggers reject the insert if the shift is frozen (`READY_TO_COMMIT` / `COMMITTED` / `CANCELLED`); the handler does not specifically map this, so it surfaces as **500**.

### `DELETE /api/shifts/{shift_id}/participants/{participant_user_id}`
**Purpose:** Lead removes an invited or active participant.

**Auth:** Session. Caller must be the lead.

**Behavior:**
- Same shift-state and lead checks as `POST /participants`.
- Cannot remove the lead themselves: returns **400/403** if `participant_user_id == lead_user_id`.
- Removes the row, calls `refresh_shift_ready_state_tx`, fires SSE.
- Frozen-shift trigger may surface as **500**.

### `POST /api/shifts/{shift_id}/join-ready`
**Purpose:** Participant signals "I have downloaded the building cache and am ready."

**Auth:** Session.

**Body:** Empty. Requires `X-Mutation-Id`.

**Success (204).**

**Behavior:**
- Looks up the caller's participant row. Only an `INVITED` participant can transition to `CACHE_READY`. (Post the ACCEPTED-state removal — `ACCEPTED` is no longer accepted as a precondition.) `CACHE_READY` callers are no-ops (idempotent).
- If no participant row exists, status is `DECLINED`, or status is `CLOSE_CONFIRMED` → **403** ("shift participant not found or not eligible to join").
- Sets `cache_ready_at = NOW()` if previously NULL.
- After: `refresh_shift_ready_state_tx` recomputes shift status; SSE fires.
- Frozen-shift trigger surfaces as **500**.

### `POST /api/shifts/{shift_id}/decline`
**Purpose:** Participant declines an invitation.

**Auth:** Session.

**Body:** Empty. Requires `X-Mutation-Id`.

**Success (204).**

**Behavior:**
- Only `INVITED` participants can decline. (Post-removal: `ACCEPTED` is no longer a valid precondition either.)
- A `CACHE_READY` or `CLOSE_CONFIRMED` participant cannot decline → **403** ("shift invitation not found for current user").
- Sets `status = 'DECLINED'`, recomputes shift state, fires SSE.

### `POST /api/shifts/{shift_id}/close-request`
**Purpose:** Lead asks all participants to confirm the shift is done.

**Auth:** Session. Caller must be the lead.

**Body:** Empty. Requires `X-Mutation-Id`.

**Behavior:**
- Shift must be `IN_PROGRESS`. **400/403** otherwise.
- Sets `status = 'CLOSE_REQUESTED'`, `close_requested_at = NOW()`.
- Triggers SSE so participants see the request immediately.

### `POST /api/shifts/{shift_id}/close-confirm`
**Purpose:** Participant confirms close.

**Auth:** Session.

**Body:** Empty. Requires `X-Mutation-Id`.

**Behavior:**
- Shift must be in `CLOSE_REQUESTED` or `READY_TO_COMMIT` (so a late confirm is still accepted).
- Caller's participant row transitions to `CLOSE_CONFIRMED`.
- After: `refresh_shift_close_state_tx` recomputes — when no non-DECLINED participant remains in any state other than `CLOSE_CONFIRMED`, the shift transitions to `READY_TO_COMMIT`.
- SSE fires.

### `POST /api/shifts/{shift_id}/commit`
**Purpose:** Lead finalizes a `READY_TO_COMMIT` shift.

**Auth:** Session. Caller must be the lead.

**Body:** Empty. Requires `X-Mutation-Id`.

**Behavior:**
- Shift must be `READY_TO_COMMIT`. **400/403** otherwise.
- Sets `status = 'COMMITTED'`, `committed_at = NOW()`.
- After commit, the shift becomes deeply immutable (DB triggers); only `report_url` may be set once afterwards.

### `PUT /api/shifts/{shift_id}/signature-image`
**Purpose:** Lead uploads the customer's signature image and the signature metadata.

**Auth:** Session. Caller must be the lead.

**Body:** Image bytes. Query/headers carry signature JSON, reference person name, role.

**Behavior:**
- Shift must not be `COMMITTED` or `CANCELLED`.
- Stores the bytes in GCS at `{shift_signature_prefix}/{tenant_id}/{shift_id}.png` (or similar).
- Upserts `shift_signatures` with the URL, JSON, and metadata. Reference person name and role are NOT NULL and trimmed to non-empty (DB CHECK constraint).
- DB trigger forbids modifying the signature row of a finalized shift.

### `POST /api/shifts/{shift_id}/cancel`
**Purpose:** Lead cancels a non-committed shift.

**Auth:** Session. Caller must be the lead.

**Body:** Empty. Requires `X-Mutation-Id`.

**Behavior:**
- Cannot cancel a `COMMITTED` or already `CANCELLED` shift → **400/403**.
- Sets `status = 'CANCELLED'`. Frozen from now on.

### `GET /api/shifts/{shift_id}/waiting-room`
**Purpose:** During the invite/start phase, return the participant roster.

**Auth:** Session.

**Behavior:**
- Shift must exist within tenant. **403** otherwise.
- The caller must have a row in `shift_participants` for this shift — **but the row's status is not checked**. **A `DECLINED` participant can still call this endpoint** (this is a known bug from `dev/dev_notes.md`).
- Returns shift metadata + participant list `[ { user_id, full_name, email, phone_number, status, invited_at, cache_ready_at } ]`.
- After the ACCEPTED-state removal, `accepted_at` is no longer in the response.

### `GET /api/shifts/{shift_id}/events`
**Purpose:** SSE stream of participant-updated events.

**Auth:** Session.

**Behavior:**
- Same as waiting-room: existence in `shift_participants` is checked, status is not. **DECLINED participants can subscribe**.
- Stream sends a `participants-updated` event whenever the shift's participants change, plus periodic keep-alives.
- Lagged subscribers receive a synthetic `participants-updated` to nudge them back into sync.

### `GET /api/shifts/{shift_id}/maintenance-summary`
**Purpose:** Pre-commit summary view for the lead.

**Auth:** Session + `require_lead_or_admin`.

**Behavior:**
- Returns shift summary with maintenance counts, participant statuses, etc.

---

## Maintenance work (technician-facing)

### `POST /api/maintenance/works/{work_id}/sync`
**Purpose:** Create or update a maintenance work record. Designed for offline-first usage: the client generates the `work_id` UUID locally and the same call upserts.

**Auth:** Session.

**Body:** `{ shift_id, device_id, status, kind?, issue_number?, started_at, finished_at?, aborted_at?, malfunction_description?, followup_service_required?, followup_service_reasons?, followup_service_reason_other?, note? }`. Requires `X-Mutation-Id`.

**Success:** `{ id, status }`.

**Validation (returns 400 BAD_REQUEST):**
- `status` not one of `IN_PROGRESS`, `FINISHED`, `ABORTED` (case-insensitive).
- `kind` (defaults to `ROUTINE`) not one of `ROUTINE`, `SERVICE`.
- Each `followup_service_reasons` value must be one of the eight enum values.
- `followup_service_required = true` but no reasons provided.
- `followup_service_required = false` but reasons provided.
- `OTHER` in reasons but `followup_service_reason_other` empty.
- `followup_service_reason_other` provided but `OTHER` not in reasons.
- `kind = SERVICE` but no `issue_number`.

**Authorization & state:**
- Caller must be a participant of the shift (any participant status) → otherwise **403**.
- Shift must be `IN_PROGRESS`, `CLOSE_REQUESTED`, or `READY_TO_COMMIT` (the only states where new maintenance is permitted) — otherwise **403** ("maintenance sync is only allowed while shift is active").
- Device must exist in the tenant → **403** otherwise.

**Persistence:**
- Upserts `maintenance_works` by `id`. The `ON CONFLICT` updates only fire if the existing row's `tenant_id` and `maintainer_user_id` match the request — i.e. one user cannot overwrite another user's work using the same UUID. Mismatch → **403** ("maintenance work belongs to another tenant or maintainer").
- Database CHECK constraints enforce: `FINISHED` requires `finished_at`, `ABORTED` requires `aborted_at`, `SERVICE` requires non-empty trimmed `issue_number`, follow-up rules duplicated from app validation. Violations surface as **500** unless the handler maps them.
- Unique partial index `maintenance_works_one_active_per_user` (one `IN_PROGRESS` per maintainer) and `maintenance_works_one_active_per_device` (one `IN_PROGRESS` per device) — violations are mapped to **409 CONFLICT** ("maintenance work conflicts with another active maintenance").
- Frozen-shift trigger on the table will reject INSERTs/UPDATEs into frozen shifts; surfaces as **500**.
- Idempotent via `MAINTENANCE_WORK_SYNC:<work_id>` mutation key.

### `PUT /api/maintenance/works/{work_id}/photos/{photo_id}`
**Purpose:** Upload (or re-upload) a photo for a maintenance work. Client provides both UUIDs.

**Auth:** Session.

**Headers:** `Content-Type` must be a recognized image type. `X-Mutation-Id` required.

**Query:** `capture_note?`, `captured_at?` (RFC3339), `photo_type?` (`MAINTENANCE` default, `MALFUNCTION`).

**Body:** Image bytes, must be > 0 and ≤ 15 MiB.

**Behavior:**
- Validates body size and content type → **400** if invalid.
- The maintenance work must exist for this `(tenant_id, work_id, maintainer_user_id)` — only the maintainer who owns the work can upload its photos. **403** otherwise.
- Calls the same shift-active gate as the work sync endpoint.
- Uploads bytes to GCS; stores object name in `maintenance_photos.photo_url`.
- Upserts the row by `photo_id` (same tenant guard on conflict update).
- Idempotent via `MAINTENANCE_PHOTO_UPSERT:<work_id>:<photo_id>` mutation key.

---

## Labeling (device registration)

### `GET /api/labeling/buildings`
**Purpose:** List buildings for the labeling UI.

**Auth:** Session.

**Returns:** `[ { id, name, address } ]`, ordered by name.

### `GET /api/labeling/buildings/{building_id}/cache`
**Purpose:** Bulk download of everything needed to label devices in one building offline (this is the building cache the shift flow also depends on).

**Auth:** Session.

**Returns:** `{ building, locations: [...], devices: [...] }`. Devices include `barcode_history` (every barcode ever assigned, not just the active one), counts (`barcode_count`, `maintenance_work_count`), and a derived photo URL (`/api/labeling/devices/{id}/photo`) when present.

**Edge cases:** Building not in tenant → **403**.

### `POST /api/labeling/devices`
**Purpose:** Register a new device, optionally creating a new location and assigning a barcode at the same time.

**Auth:** Session.

**Body:** `{ buildingId, existingLocationId?, location?, kind, brand?, model?, serialNumber?, sourceDeviceCode?, additionalInfo?, barcode? }`. (camelCase fields; serde renames.)

**Validation:**
- Building must be in tenant → **403**.
- Empty/whitespace `kind` → **400**.
- Both `existingLocationId` and `location` provided → **400**.
- `existingLocationId` provided but doesn't belong to the building → **400**.
- `location` provided but all four fields are empty → **400** ("location details are required").
- Neither location source provided → **400**.

**Persistence:**
- Inserts the device. If `kind` doesn't match the `device_kind` enum, surfaces as **400** ("invalid device kind").
- If `sourceDeviceCode` is set and already used by another device in the tenant → **409** ("source device code is already used by another device") via the unique partial index.
- If `barcode` provided: errors **409** if the barcode already belongs to a different device. Otherwise upserts the barcode record (re-activates a previously deactivated row for the same code).
- `X-Mutation-Id` is **not** required here (this is one of the few endpoints without idempotency).

**Returns:** **201 CREATED** with `{ device_id, location_id }`.

### `POST /api/labeling/buildings/{building_id}/locations`
**Purpose:** Create a new site location.

**Auth:** Session.

**Body:** `{ floor?, wing?, room?, locationDescription? }`.

**Validation:** All four fields empty → **400**. Building not in tenant → **403**.

**Returns:** **201** with `{ location_id }`.

### `POST /api/labeling/devices/{device_id}/barcode`
**Purpose:** Assign or re-assign a barcode to a device. If the device already has an active barcode, the old one is deactivated.

**Auth:** Session. `X-Mutation-Id` required.

**Body:** `{ "code": "<string>" }`.

**Behavior:**
- Empty/whitespace code → **400** ("barcode is required").
- Device not in tenant → **403**.
- Code already belongs to a different device → **409** ("barcode has already been used and cannot be reassigned"). (The same code re-assigned to the same device is a no-op.)
- Deactivates any other active barcode on the device (sets `deactivated_at = NOW()`).
- Upserts the new code (`ON CONFLICT (tenant_id, code)`); if the same code was previously deactivated for this device, it is reactivated.

### `POST /api/labeling/devices/{source_device_id}/barcode-correction`
**Purpose:** Move the barcode (and, conditionally, maintenance history) from one device to another. Used to fix data-entry mistakes.

**Auth:** Session. `X-Mutation-Id` required.

**Body:** `{ "targetDeviceId": "<uuid>" }`.

**Behavior:**
- `source == target` → **400**.
- Either device not in tenant → **403**.
- Source must have ≥1 barcode ever assigned and ≥1 active barcode (otherwise **409**).
- Target must satisfy: barcode_count ≤ 1 OR maintenance_work_count == 0 (anything else is too "full" to correct into) → **409**.
- Deactivates active barcodes on both devices. Re-issues the source's active code to the target. If the target had its own active code AND it was different from the source's, that code is re-issued to the source (effectively a swap). If the codes were equal, no swap is performed.
- If the source had a `device_photo_url`, it is moved to the target and cleared from the source.
- Maintenance works are moved from source to target only if source had history AND target had none. Otherwise zero are moved.
- The unique-active-per-user/device indexes can fire during the move → **409** ("maintenance works could not be reassigned because of an active maintenance conflict").
- Frozen-shift trigger messages on `maintenance_works` get mapped to **409** ("maintenance works of frozen shifts cannot be reassigned").

### `PUT /api/labeling/devices/{device_id}/photo`
**Purpose:** Upload a photo for a device.

**Auth:** Session. `X-Mutation-Id` required.

**Body:** Image bytes, > 0, ≤ 15 MiB. `Content-Type` must be a recognized image type.

**Behavior:** Device in tenant → **403** otherwise. Object stored in GCS; `devices.device_photo_url` set to the object name. Idempotent.

### `GET /api/labeling/devices/{device_id}/photo`
**Purpose:** Stream the device photo bytes.

**Auth:** Session.

**Behavior:** Returns the image with the recorded content type. **403** if device or photo doesn't exist for this tenant.

### `DELETE /api/labeling/devices/{device_id}/photo`
**Purpose:** Remove the photo (idempotent).

**Auth:** Session. `X-Mutation-Id` required.

**Behavior:**
- If no photo URL is recorded, returns **204** without contacting GCS (recorded as a processed mutation).
- Otherwise deletes the GCS object, then sets `device_photo_url = NULL`. Returns **204**.

### `PATCH /api/labeling/devices/{device_id}/details`
**Purpose:** Update device fields and (in the same transaction) the device's location.

**Auth:** Session. `X-Mutation-Id` required.

**Body:** `{ kind, brand?, model?, serialNumber?, sourceDeviceCode?, additionalInfo?, isMaintainable?, floor?, wing?, room?, locationDescription? }`.

**Behavior:** Same kind/sourceDeviceCode mapping as `POST /labeling/devices`. **400** for empty/invalid kind, **409** for duplicate source code. The location is updated in place using the device's current `location_id` — the location is not re-pointed to a different building.

---

## Admin endpoints (`/api/admin/*`)

All of these require a session. Some require `require_lead_or_admin`. None today specifically check `ADMIN`-only.

### `GET /api/admin/shifts`
List shifts for the tenant with metadata: id, building name, lead, status, started/closed/committed timestamps, participant counts (excluding `DECLINED`), maintenance counts, etc.

### `GET /api/admin/shifts/{shift_id}`
Detailed view: shift metadata + participant rows (`user_id, full_name, role, status, invited_at, cache_ready_at, close_confirmed_at` — `accepted_at` no longer included after the recent migration) + maintenance rows.

### `GET /api/admin/buildings`
List buildings for the tenant.

### `GET /api/admin/users` (and `POST` for create)
List/create users in the tenant. The POST handler requires `require_lead_or_admin`; takes `{ full_name, email, phone_number?, role }`. Constraints: email unique within tenant; role must match the `user_role` enum.

### `GET /api/admin/users/{user_id}`, `PATCH /api/admin/users/{user_id}`
Detail / update. PATCH lets admins update name, phone, role, `is_active` flag.

### `GET /api/admin/devices`, `GET /api/admin/devices/{device_id}`
List/get devices with their building name, location, barcode, kind, etc.

### `GET /api/admin/maintenances/{maintenance_id}` and `GET /api/admin/shifts/{shift_id}/maintenances/{maintenance_id}`
Two paths to the same maintenance detail view (the second is a legacy/redirect path).

### `GET /api/admin/shifts/{shift_id}/maintenances/{maintenance_id}/photos/{photo_id}`
Streams a maintenance photo from GCS for admin review.

### `GET /api/users/invite-candidates`
For the lead's invite picker: list users in the tenant who can be invited to a shift (excludes the caller themselves, excludes DECLINED-only / inactive users by the underlying SQL).

---

## Health

### `GET /api/health-check`
Returns plain text `OK`. No auth, no DB call. Useful for load balancer probes.

---

## Behaviors not visible from any single endpoint

- **`refresh_shift_ready_state_tx`** runs after participant changes. If no `INVITED` participant remains, the shift transitions `INVITING → READY_TO_START`. If an `INVITED` participant is added back, it transitions in the other direction. (Only fires for shifts currently in `INVITING`/`READY_TO_START`.)
- **`refresh_shift_close_state_tx`** runs after close confirmations. When every non-DECLINED participant is `CLOSE_CONFIRMED`, the shift moves to `READY_TO_COMMIT`. (Only fires for shifts in `CLOSE_REQUESTED`/`READY_TO_COMMIT`.)
- **DB triggers** silently enforce the immutability of frozen shifts and propagate "frozen shift" exceptions to the caller. Most handlers do not catch and remap these — barcode correction is the exception.
- **Photo size limit:** 15 MiB at the handler level; the global axum body limit is 20 MiB.
