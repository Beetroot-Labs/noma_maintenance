# Backend Security Audit

**Date:** 2026-05-08
**Scope:** `backend/` Rust service — `src/main.rs`, `src/auth.rs`, `src/state.rs`, `src/error.rs`, `src/labeling.rs`, `src/maintenance.rs`, `src/shifts.rs`, `src/storage.rs`, `src/sync.rs`, `migrations/0001_setup.sql`, `Cargo.toml`/`Cargo.lock`. Frontend not audited.

---

## TL;DR

**Overall risk level: MEDIUM.** No critical, exploitable-today findings. Tenant isolation and parameterized SQL are clean. The biggest practical exposures are at the edges: open CORS + permissive cookie flags, an SVG/wildcard MIME path that creates stored-XSS, a client-supplied URL field on `commit_shift`, a world-readable GCS service-account temp file, and an unmaintained `cloud-storage` dependency tree.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 4 |
| Medium | 9 |
| Low / Informational | 6 |

**Top actions** (do in this order — each unblocks something on the next line):
1. **M9** — fix world-readable service-account temp file (15 min)
2. **M4** — drop the `image/*` wildcard, allowlist explicit MIME types (15 min)
3. **M5** — server-side compute the canonical signature object name; ignore the client field (30 min)
4. **H1 + M2** — tighten CORS allowlist + cookie flags (`Secure` default, `SameSite=Strict`, `__Host-` prefix) (1 hr)
5. **M1** — install `cargo-audit`, run it, plan the migration off `cloud-storage 0.11.1` (depends on alternative selection — half a day)

---

## Severity index

Click any row to jump to the detailed finding.

| ID | Severity | Title | Location |
|---|---|---|---|
| H1 | High | CORS allows any origin while auth is cookie-based | `main.rs:150-153,282` |
| H2 | High | SSE endpoint authorizes DECLINED/removed participants indefinitely | `shifts.rs:2483-2535` |
| H3 | High | Admin user listing/update filters out `is_active=FALSE` rows entirely | `shifts.rs:498-524, 1037-1057` |
| H4 | High | `state.rs` `set_var` runs after Tokio multi-thread runtime starts | `state.rs:99`, `main.rs:117` |
| M1 | Medium | `cloud-storage 0.11.1` is unmaintained; pulls duplicate `jsonwebtoken 7`, `reqwest 0.11`, legacy `rsa` | `Cargo.lock` |
| M2 | Medium | Session cookie defaults `Secure=false`, uses `SameSite=Lax`, no `__Host-` prefix | `auth.rs:433-445`, `main.rs:181-184` |
| M3 | Medium | Body-size limits enforced *after* full buffering; no rate limiting | `main.rs:113`, photo handlers |
| M4 | Medium | `image/*` MIME wildcard enables stored-XSS via SVG | `storage.rs:13` |
| M5 | Medium | `commit_shift` writes client-supplied `signature_image_url` directly to DB | `shifts.rs:180-184, 2031, 2098` |
| M6 | Medium | Server-built URL fields rendered by frontend — verify no `innerHTML` use | `shifts.rs:1511-1516`, `labeling.rs:296` |
| M7 | Medium | Google JWKS fetched on every login (no caching) | `auth.rs:353-369` |
| M8 | Medium | `auth_identities` not tenant-scoped — one Google identity = one tenant globally | `migrations/0001_setup.sql:35-56` |
| M9 | Medium | Service-account JSON temp file is world-readable | `state.rs:93-99` |
| L1 | Low | Photo download routes data through Rust process (no signed URLs) | `labeling.rs:738-779`, `shifts.rs:1598-1648` |
| L2 | Low | `ApiError::internal` log line may include PII via sqlx error formatting | `error.rs:67-75` |
| L3 | Low | `cancel_shift` hard-deletes instead of state-transition to CANCELLED | `shifts.rs:2691-2772` |
| L4 | Low | `verify_google_id_token` doesn't pin a nonce | `auth.rs:337-401` |
| L5 | Low | "Not found" returns 403 (correct security posture, wrong HTTP semantic) | many handlers |
| L6 | Info | `tests/setup.rs` `unsafe ctor` — sound | `tests/setup.rs` |

---

## High

### H1. CORS allows any origin while auth is cookie-based
**Location:** `src/main.rs:150-153, :282`.

`CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)` is applied to the whole app. Cookie auth uses `SameSite=Lax` (`auth.rs:435`), which blocks cross-site form `POST` but permits top-level navigations and same-site iframes. `allow_credentials` is not set, so the browser won't attach the cookie to cross-origin XHR — this is what saves us today. But the wide-open headers/methods policy makes it easy to mis-deploy and turn this into a credentialed CSRF channel later. There's no CSRF token on state-changing endpoints either.

**Fix:** allowlist the production frontend origins explicitly; replace `Any` with concrete method/header sets; pair with `SameSite=Strict` (M2) or a CSRF double-submit cookie.

### H2. SSE endpoint authorizes DECLINED/removed participants indefinitely
**Location:** `src/shifts.rs:2483-2535` (`subscribe_shift_events`).

Access check is just "row exists in `shift_participants` for `(tenant_id, shift_id, user_id)`." DECLINED users still pass; removed-then-re-added users retain the channel; the broadcast publishes on every membership mutation, so anyone with a stale row sees the participant churn stream. The existing test `e13.2` already encodes this as a known bug.

**Fix:** add `status NOT IN ('DECLINED')` to the access check; consider closing existing receivers when a participant is removed.

### H3. Admin user listing and update both filter out `is_active=FALSE` rows
**Location:** `src/shifts.rs:498-524` (`list_admin_users`), `:1037-1057` (`update_admin_user`).

Both queries hard-filter `is_active = TRUE`. Effect: deactivated users become invisible to admins (can't audit, can't re-activate via the API), and `update_admin_user` *silently fails* on inactive rows — so an admin trying to demote a deactivated user during incident response gets a misleading 403. There's no audit log on role changes either.

**Fix:** expose `is_active` in the listing; let admins query/update inactive users; add an audit log for role changes.

### H4. `state.rs` `set_var` justification is incorrect under multi-threaded Tokio
**Location:** `src/state.rs:99`, called from `main.rs:117-198`.

The comment claims "Safe at startup before worker threads begin handling requests," but `load_storage_config()` runs *inside* `#[tokio::main]` (`main.rs:117`), which has already brought up the multi-thread runtime. The 2024-edition unsafety contract for `std::env::set_var` is precisely about other threads possibly reading `environ` concurrently. In practice nothing else reads `SERVICE_ACCOUNT` at that moment, but the soundness depends on `cloud-storage`'s internals not racing this — a fragile invariant.

**Fix:** either pass the service-account JSON path to the GCS client through its API rather than via env, or compute the temp file in a single-threaded bootstrap before entering `#[tokio::main]`. At minimum, fix the comment.

---

## Medium

### M1. Unmaintained `cloud-storage 0.11.1` pulls in duplicate vulnerable transitive crates
**Location:** `Cargo.lock`.

`cloud-storage 0.11.1` (last release 2022-10) pulls in `jsonwebtoken 7.2.0` and `reqwest 0.11.27` alongside the `9.3.1`/`0.12.x` versions you use directly. `jsonwebtoken 7` predates several algorithm-confusion fixes; `rsa 0.9.x` has had timing-attack disclosures (verify exact resolved version). Even though you don't import the legacy crates yourself, they're compiled in and any code path inside `cloud-storage` that uses them is exposed.

**Fix:** install `cargo-audit` and triage. Strongly consider migrating to `google-cloud-storage` or `object_store` (both maintained), which removes the duplicated chain.

### M2. Session cookie hardening
**Location:** `src/auth.rs:433-445, :274-278`; `main.rs:181-184`.

Defaults: `cookie_secure=false` unless `COOKIE_SECURE=1`; `SameSite=Lax`; no `__Host-` prefix. Misconfigured prod can ship the session cookie over plain HTTP. `SameSite=Lax` allows top-level cross-site GETs to attach the cookie, and there's no subdomain-takeover bound.

**Fix:** default `cookie_secure=true` (require explicit opt-out for dev only), use `SameSite=Strict`, add the `__Host-` prefix.

### M3. Body limits enforced post-buffer; no rate limiting
**Location:** `main.rs:113`; photo/signature handlers in `labeling.rs:668`, `maintenance.rs:402`, `shifts.rs:1951`.

Global `DefaultBodyLimit::max(20 MiB)`. The per-handler 15 MiB / 5 MiB caps trigger *after* `axum::body::Bytes` has fully buffered the request, so an attacker can already pay the memory cost. No rate limiting on any endpoint, including `/auth/google` (which does an outbound JWKS fetch + DB transaction per call — easy DoS amplifier).

**Fix:** route-scoped `DefaultBodyLimit` per endpoint that matches the actual cap; add rate limiting (`tower_governor` or `tower::limit`) at least to `/auth/google` and the photo upload routes; cache JWKS (M7).

### M4. `image/*` content-type wildcard enables stored XSS via SVG
**Location:** `src/storage.rs:13`.

```rust
Some(other) if other.starts_with("image/") => Ok(Cow::Owned(other.to_string())),
```

Any `image/<x>` MIME passes — including `image/svg+xml`, which permits embedded JavaScript. There's no magic-byte sniffing on upload. The download endpoints (`labeling.rs:778`, `shifts.rs:1647`) echo the stored content-type back. Because photos are served from the same origin as the SPA, a stored SVG becomes stored XSS in the admin app context.

**Fix:** drop the wildcard arm; allowlist `jpeg/png/webp/heic/heif` only. On download, set `Content-Disposition: attachment` or a CSP `img-src` lockdown that bans script execution. Consider validating magic bytes on upload.

### M5. `commit_shift` writes a client-supplied `signature_image_url` to the DB (verified)
**Location:** `src/shifts.rs:180-184` (request struct), `:2031` (extraction), `:2098` (bind).

The commit handler trims `payload.signature_image_url` from the request body and writes it directly into `shift_signatures.signature_image_url`. The earlier `upload_shift_signature` endpoint computes the canonical object name deterministically from `(tenant_id, shift_id)` (`shift_signature_object_name`) — but `commit_shift` doesn't recompute or verify it. A compromised technician client can store any URL (including an attacker-controlled HTTPS URL); the eventual report rendering would dereference it.

**Fix:** recompute the canonical object name server-side in `commit_shift` using `shift_signature_object_name(storage, user.tenant_id, shift_id)`; ignore whatever the client sends.

### M6. Server-built URL fields rendered by frontend (Needs Verification)
**Location:** `shifts.rs:1511-1516`, `labeling.rs:296`.

Response URLs like `/api/admin/shifts/{shift}/maintenances/{id}/photos/{photo}` are built server-side using parameterized `FORMAT(... $2::text ...)` — not SQL-injectable. But the values flow through to the frontend; if any frontend code uses `innerHTML` instead of `src=` on these strings, the path becomes a stored-XSS vector. Flagging as "verify the frontend renders these via DOM properties, not raw HTML."

**Fix:** confirm frontend renderers use `src=`/`href=`. No backend change if so.

### M7. JWKS fetched on every login
**Location:** `src/auth.rs:353-369`.

Every Google login does a fresh `GET https://www.googleapis.com/oauth2/v3/certs`. This makes login depend on Google's CDN being reachable, hits Google rate limits under load, and amplifies the auth DoS in M3.

**Fix:** cache JWKS for at least the lifetime of the response's `Cache-Control: max-age` (default 1 hour). Single-flight refresh; no negative caching.

### M8. `auth_identities` not tenant-scoped — one Google identity = one tenant globally (Needs Verification)
**Location:** `migrations/0001_setup.sql:35-56`.

`UNIQUE (provider, provider_subject)` means a single Google subject can be linked to exactly one user across all tenants. The `google_login` handler partially handles the cross-link case (`auth.rs:160-178`) but doesn't disambiguate by tenant. If two tenants legitimately invite the same Google account, the second's INSERT collides.

**Fix:** decide product-side intent. Either document "one Google identity = one tenant" and surface in admin UI, or change to `UNIQUE (tenant_id, provider, provider_subject)`.

### M9. Service-account JSON temp file is world-readable
**Location:** `src/state.rs:93-99`.

```rust
std::fs::write(&temp_file, service_account_json)?;
```

On Linux this defaults to `0644`. `std::env::temp_dir()` typically maps to `/tmp` (world-readable). Any other user on the host (or another container sharing `/tmp`) can read the GCS service-account private key. The filename is just `noma-gcs-service-account-{pid}.json` — enumerable.

**Fix:** use `tempfile::NamedTempFile` (creates `0600`) or `OpenOptions::new().mode(0o600).write(true).create_new(true)`. Better: keep the JSON in memory and pass to the GCS client via API, eliminating the disk hop.

---

## Low / Informational

### L1. Photo download routes data through the Rust process
**Location:** `labeling.rs:738-779`, `shifts.rs:1598-1648`.

Both handlers `Object::download` then echo bytes. Doubles bandwidth and memory. Not a security bug; a denial-of-availability lever.

**Fix:** issue a short-TTL signed URL and 302-redirect. Bonus: removes the stored-content trust boundary discussed in M4 (browser fetches directly).

### L2. `ApiError::internal` log line may include sqlx error context
**Location:** `src/error.rs:67-75`.

`log::error!("{error}")` returns generic text to the client (correct) but logs the full upstream error. Some sqlx error formats include partial query parameters. Confirm production logs aren't capturing PII at error level.

**Fix:** sample production logs once; redact if needed.

### L3. `cancel_shift` hard-deletes instead of state transition to `CANCELLED`
**Location:** `src/shifts.rs:2691-2772`.

The schema defines a `CANCELLED` state with corresponding triggers, but the handler issues `DELETE` and removes maintenance_works rows too. Not a vulnerability, but loses audit trail when a malicious lead cancels a shift. Test `e9.1` already documents this behavior.

**Fix:** soft-delete via status transition; keep maintenance rows for forensics.

### L4. `verify_google_id_token` doesn't pin a nonce
**Location:** `src/auth.rs:337-401`.

Algorithm RS256-pinned, audience/issuer pinned, `email_verified` enforced, `hd` optionally enforced. But no nonce — Google Sign-In recommends nonce as the replay defense. `iat`/`exp` validated by `jsonwebtoken` defaults with default ~60s leeway.

**Fix:** generate a server-side nonce on `/auth/google/init`, store hashed, require it in the ID token. Tighten `validation.leeway` to a small explicit value.

### L5. "Not found" returns 403 instead of 404
**Location:** many handlers (e.g., `labeling.rs:249`, `shifts.rs:1284, 2423`).

Pattern `ok_or_else(|| ApiError::forbidden("X not found for current tenant"))`. Returning 403 for both "doesn't exist" and "exists in another tenant" is the right *security* posture (don't leak existence), but it's the wrong *HTTP* semantic.

**Fix:** return 404 with a generic message. Same security posture, correct semantics.

### L6. `unsafe { ctor::ctor(unsafe) }` in `tests/setup.rs` — sound
**Location:** `src/tests/setup.rs`.

Reviewed: runs pre-main on a single thread, sets `DATABASE_URL` once, intentionally leaks runtime + container handles. Soundness is correct. Comment is accurate.

**Fix:** none.

---

## What checked clean

The agent specifically verified the following are **not** issues:

| Area | Verdict |
|---|---|
| Tenant isolation in handlers | Clean — every `WHERE` on tenant-scoped tables filters on `user.tenant_id` from the session, never from request body/path |
| SQL injection via `QueryBuilder` (admin device listing) | Clean — all `query.push(...)` arguments come from compile-time constants; user values land via `push_bind`; sort key matched against a closed list |
| Session token entropy & lifecycle | Clean — UUID v4 (~122 bits), SHA-256 hashed before storage, expiry + `revoked_at` + `is_active` enforced on every authed call, logout revokes correctly |
| Authorization gaps on shift state-changing endpoints | Clean — row-level checks (lead identity, participant identity) cover the cases not gated by `require_lead_or_admin` |
| Mass assignment via `update_admin_user` / `create_admin_user` | Clean — both require `require_admin`; no privilege self-escalation path |
| Outbound HTTP / SSRF | Clean — only outbound is hardcoded JWKS URL (`auth.rs:355`); no user-controlled outbound URLs |
| Path traversal in object names | Clean — names built from tenant_id + UUIDs only; no user strings interpolated |
| Error message leakage to client | Clean — `ApiError::internal` returns generic text; raw error logged, not echoed |
| Hardcoded secrets | Clean — none in source; `.gitignore` covers `.env*` |
| Trigger coverage of frozen-shift invariants | Clean — `shifts`, `shift_participants`, `shift_signatures`, `maintenance_works`, `maintenance_photos` all covered |

---

## Verification status

- **Verified by spot-checking source:** H1, H3, H4, M4, M5, M9, L6 (all confirmed in this session)
- **Trusted from agent's reading:** H2, M1–M3, M6–M8, L1–L5
- **Flagged "Needs Verification" by agent:** M6 (frontend rendering), M8 (product intent on cross-tenant Google identities)

The "verified" items are safe to act on directly. The "trusted" items should be quickly checked by the implementer before fixing — agent reports occasionally include false positives, especially on dependency claims.

---

## Tooling note

`cargo-audit` is **not installed** on this host. To run an authoritative dependency CVE scan:

```bash
cargo install cargo-audit
cd backend && cargo audit
```

This will resolve M1's specific CVE list.

---

## Recommended remediation order

Grouped by impact-per-effort:

**Quick wins (under 1 hr each):**
1. M9 — `tempfile::NamedTempFile` (or `0o600` mode) for service-account JSON
2. M4 — drop `image/*` wildcard, explicit allowlist
3. M5 — recompute `signature_image_url` server-side in `commit_shift`
4. H4 — fix the misleading comment in `state.rs:99` (and consider moving to in-memory)
5. L5 — switch tenant-scoped 403s to 404 (mechanical change across handlers)

**Medium lifts (a few hours):**
6. H1 + M2 — CORS allowlist + cookie hardening
7. H2 — SSE participant filter (`status <> 'DECLINED'`)
8. H3 — admin listing exposes inactive users + role-change audit log
9. M7 — JWKS caching
10. L4 — login nonce

**Bigger lifts:**
11. M3 — rate limiting + per-route body limits
12. M1 — migrate off `cloud-storage` (this also reduces M9's risk by potentially eliminating the temp file)
13. M8 — schema decision on cross-tenant Google identities
14. L1 — signed URLs for photo downloads
15. L3 — soft-delete for `cancel_shift`
