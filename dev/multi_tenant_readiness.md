# Multi-Tenant Readiness — TODO

What it would take for `noma_maintenance` to function as a real multi-tenant SaaS that companies other than NoMa can sign up for and use. Today the data model is multi-tenant-shaped (every table has `tenant_id`), but the application around it is single-tenant and hard-coded to NoMa's domain, branding, language, and operational model.

This is a survey, not a sprint plan — items vary from one-day fixes to multi-month efforts. They're grouped by area and rough-sized as **S** (≤ 1 week), **M** (1–4 weeks), **L** (1–3 months).

---

## 1. Tenant lifecycle

There is no way to create or manage tenants today. The `tenants` table holds only `id`, `name`, `created_at` — no contact info, billing, plan, status, or settings.

- [ ] **L** Self-serve sign-up flow: a company can register, become a tenant, become its own admin, and onboard their first users without engineering involvement.
- [ ] **M** Tenant table extension: add `slug` (URL-friendly), `display_name`, `legal_entity_name`, `address`, `country`, `default_locale`, `timezone`, `status` (active / suspended / cancelled), `plan_id`, `created_by`, `trial_ends_at`.
- [ ] **M** Tenant settings endpoints: `GET/PATCH /tenant` for the tenant admin to update display name, address, contact info, default locale, branding (see §6).
- [ ] **S** Tenant suspension flow: an admin / billing process can flip `status=suspended` and all endpoints return 402/403 with a clear message until reactivation.
- [ ] **S** Tenant deletion + GDPR erasure: hard-delete on request, with confirmation and 30-day grace period.
- [ ] **M** Super-admin role distinct from tenant `ADMIN`: cross-tenant visibility for support, suspended-tenant access, impersonation. Should NOT exist in the same `users` table to avoid privilege escalation; consider a separate `staff_users` or external identity.

## 2. User onboarding & authentication

Today a user can only log in with Google after an admin has manually inserted a row matching their email. There is no invite flow, no password login (the schema has it, no endpoints do), no email verification, no password reset.

- [ ] **M** Email-invite flow: admin enters email + role → system sends an invitation email with a single-use signed link → invitee clicks → they verify the email and either (a) sign in with Google or (b) set a password. Backed by a new `invitations` table with `token_hash`, `expires_at`, `accepted_at`.
- [ ] **M** Password authentication: implement the `PASSWORD` provider (already in the schema): registration, login, change-password, forgot-password (token-based reset email).
- [ ] **M** Email verification for password accounts.
- [ ] **L** Optional MFA (TOTP), at least for admins.
- [ ] **S** "Log out all devices" — list and revoke active sessions per user.
- [ ] **S** Per-tenant Google domain restriction: replace the global `GOOGLE_HOSTED_DOMAIN` env var with a per-tenant allow-list stored on the tenant row. Today this single env var prevents serving multiple unrelated companies.
- [ ] **S** Allow Google login from any domain by default — the current restriction is a single-tenant assumption.
- [ ] **M** SSO / SAML for enterprise tenants (likely later, but worth designing the auth provider abstraction so it can be added without rewriting).
- [ ] **S** Session token entropy: replace `Uuid::new_v4()` with a CSRNG-derived 256-bit secret. UUIDv4 is acceptable but a dedicated random secret is the safer industry default.

## 3. Roles & permissions

Schema has `ADMIN`, `LEAD_TECHNICIAN`, `TECHNICIAN`, `VIEWER`. `VIEWER` has no privileges anywhere. `require_admin` exists in code but is unused — admin-only endpoints currently require only `lead_or_admin`.

- [ ] **S** Wire `require_admin` to the truly admin-only endpoints (user create/update, tenant settings).
- [ ] **S** Define what `VIEWER` actually means and enforce it (read-only across the app, used for stakeholders / auditors).
- [ ] **M** Tenant-owner role distinct from admin: only the owner can change billing, delete the tenant, transfer ownership.
- [ ] **L** Custom-role / per-permission system if any tenant asks. Premature today.

## 4. Multi-tenancy hardening

The data model is multi-tenant. The runtime has gaps.

- [ ] **S** Verify every endpoint filters by `tenant_id` — use the parameterized cross-tenant test suite from `dev/backend_test_plan.md` §B as a regression net.
- [ ] **S** Per-tenant rate limiting (currently none). Even a basic `tower::limit::RateLimitLayer` per IP + per session prevents one tenant from saturating the service.
- [ ] **M** Per-tenant resource quotas (max users, devices, shifts/month) tied to plan.
- [ ] **M** Tenant-scoped feature flags so paid plans get features free plans don't.
- [ ] **L** Optional dedicated database / schema per tenant for enterprise customers requiring data isolation.

## 5. Internationalization & localization (i18n / l10n)

Almost every user-visible string is Hungarian, hard-coded into TSX. There is no i18n framework anywhere in the frontend (`grep -r i18n` in `frontend/apps/` returns nothing).

- [ ] **L** Introduce an i18n library (e.g. `react-i18next`, `formatjs`, or `lingui`). Externalize every Hungarian string in the `main` and `labeling` apps into translation files. Initial languages: HU, EN.
- [ ] **M** Localize date/time/number formatting (currently uses Hungarian conventions implicitly).
- [ ] **S** Per-user language preference persisted on the user row; per-tenant default locale.
- [ ] **M** Localize backend error messages — today they're a mix of English and English-only, but they reach the UI as toasts. Either keep them as stable codes and translate in the UI (preferred) or send localized strings keyed to `Accept-Language`.
- [ ] **S** Currency: confirm whether anything needs to display monetary amounts (shift cost, parts, etc.). If yes, design a `currency` column on tenants and use a money library.
- [ ] **M** Right-to-left support if any future language requires it (not urgent).

## 6. Branding & white-labeling

Today "Noma" is baked in: logo files, the cookie name (`noma_session`), package names (`@noma/*`), favicon, app titles, theme colors.

- [ ] **M** Per-tenant branding: logo, favicon, primary color, app display name, login background. Stored on the tenant row, served from GCS.
- [ ] **S** Rename `noma_session` cookie to a generic name (`session` or product-neutral), or make it tenant-aware.
- [ ] **S** Replace all hard-coded "Noma" strings in user-visible UI with the tenant's display name.
- [ ] **M** Per-tenant custom subdomain (`acme.example.com`) + per-tenant TLS via a wildcard cert or ACME-on-demand. Cookie domain handling needs care.
- [ ] **S** Make package names (`@noma/shared`, `@noma/frontend-main`) generic, or accept that they're internal-only.
- [ ] **S** Replace product name in PR templates, README, AGENTS.md once a real product name is chosen.

## 7. Domain assumptions baked into the model

The HVAC domain and Hungarian operational context are hard-coded in places that would block any other industry or country.

- [ ] **L** `device_kind` enum is HVAC-only (`WINDOW_AIR_CONDITIONER`, `VRV_INDOOR_UNIT`, ...). For non-HVAC tenants this is meaningless. Either generalize to `device_kind TEXT` with a tenant-defined catalog, or accept that this is an HVAC-vertical product.
- [ ] **L** `tender_classification` enum is Hungarian/EU procurement-specific (e.g. `WINDOW_AIR_CONDITIONER_UP_TO_2_5_KW`). Other countries have different classification schemes. Same options as above.
- [ ] **M** `maintenance_followup_reason` enum is fairly generic; review per-tenant customizability.
- [ ] **S** "Igénylési szám" (issue number) format is currently free-text but the tooltip example is `Q123456` — Noma-specific. Make the placeholder + helper text per-tenant.
- [ ] **M** Shift report PDF template (when built — see §10) needs to reflect tenant locale, currency, date format, and possibly local legal requirements (e.g. EU contractor reports).

## 8. Email & notifications

There is no email infrastructure anywhere in the codebase (`grep` for smtp/sendgrid/mailgun returns nothing).

- [ ] **M** Email service integration (Resend / Postmark / SES). Templated emails with per-tenant branding.
- [ ] **S** Transactional emails: invite, password reset, email verification, account locked, billing receipts, monthly summaries.
- [ ] **M** In-app notification center (already a half-built `NotificationProvider` component on the frontend).
- [ ] **M** Push notifications (mentioned in roadmap Phase 1 as "Push: invitation notification wired" — verify status). Web Push for PWA + APNs/FCM if a native app is ever built.
- [ ] **S** Per-user notification preferences (email vs push vs in-app, per category).
- [ ] **S** Unsubscribe links (legal requirement in most jurisdictions).

## 9. Billing & plans

None today.

- [ ] **L** Stripe (or equivalent) integration: customer ID on the tenant, subscription, invoices, webhooks for plan changes / payment failures.
- [ ] **M** Plan model: `plans` table with feature flags, quotas, prices.
- [ ] **M** In-app billing portal: see plan, upgrade/downgrade, view invoices, update payment method.
- [ ] **S** Trial period logic: `trial_ends_at` on tenants, lockout when expired without paid plan.
- [ ] **S** Suspended-tenant UX: graceful read-only mode + "your subscription expired" banner.

## 10. Reporting & exports

Phase 6 of the roadmap mentions PDF reports — not done.

- [ ] **L** Shift-report PDF generation (server-side rendering with a real PDF library, not a screenshot). Per-tenant branding, signature embedded, locale-aware.
- [ ] **M** CSV/Excel exports of shifts, maintenance works, devices for analytics.
- [ ] **M** GDPR data export per user: complete dump of personal data on request.
- [ ] **L** Reporting dashboard for admins: maintenance throughput, technician utilization, device fault rates.

## 11. Audit logging

There is no audit log table. Some `created_by` / `*_at` columns capture the most recent state but not history.

- [ ] **M** `audit_events` table: `tenant_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `before` / `after` JSONB, `created_at`, `request_id`. Wired through every mutating handler.
- [ ] **S** Admin UI to browse the audit log.
- [ ] **S** Retention policy per plan.

## 12. Security hardening

- [ ] **S** Force `cookie_secure = true` in production (currently defaults `false` and depends on env).
- [ ] **S** Tighten CORS — `CorsLayer::new().allow_origin(Any)` in `main.rs` is too permissive. Lock to the configured frontend origin(s).
- [ ] **S** Add Content-Security-Policy, `X-Frame-Options: DENY` (already covered by Strict-Transport-Security on responses, but add CSP), `X-Content-Type-Options: nosniff`.
- [ ] **S** CSRF protection: SameSite=Lax cookie helps but doesn't cover all cases. Consider double-submit token for write endpoints if cookies remain the auth mechanism.
- [ ] **M** Per-tenant API keys / OAuth clients for programmatic access (some customers will want this).
- [ ] **M** Penetration test / external security review.
- [ ] **S** Dependency-vulnerability scanning (`cargo audit` for backend, `npm audit` + Dependabot for frontend) wired into CI.
- [ ] **S** Secret rotation playbook (Google client secret, GCS service-account, DB password).
- [ ] **M** Encrypt sensitive PII at rest (phone numbers, addresses) — at least document the threat model and decide.

## 13. Observability & operations

- [ ] **S** Structured logging (currently `simple_logger` text output). Move to JSON logs with request IDs.
- [ ] **M** Metrics — Prometheus or OTel — at minimum: requests-per-endpoint, latency histograms, error rates, DB pool stats, SSE subscriber counts per shift.
- [ ] **M** Distributed tracing for the request → DB → GCS path.
- [ ] **M** Error reporting: Sentry / Honeybadger for backend AND frontend.
- [ ] **S** Uptime monitoring (Statuspage / BetterStack / Pingdom hitting `/api/health-check`).
- [ ] **S** Database backups: automated daily + tested restore. Currently the codebase is silent on this.
- [ ] **M** Disaster recovery runbook + RPO/RTO targets.
- [ ] **M** Multi-region or at least documented data-residency posture for EU customers (GDPR).

## 14. CI/CD & development workflow

There is no `.github/` directory — no CI, no automated tests, no preview deployments.

- [ ] **S** GitHub Actions workflow: `cargo build`, `cargo test`, `cargo clippy`, `cargo audit`, `npm run build` for both apps, `npm test`, `npm audit`.
- [ ] **S** Deploy workflow: push-to-main → staging; tag → production.
- [ ] **M** A staging environment that matches production.
- [ ] **S** Test database in CI (Postgres service container) so the tests in `backend_test_plan.md` actually run.
- [ ] **S** PR preview deployments (frontend at minimum).
- [ ] **S** Migration runner: split `database/setup.sql` into numbered files under `backend/migrations/` and use `sqlx::migrate!()`. Currently every new schema change is an ad-hoc `migrate_*.sql`.

## 15. Public API & integrations

Today there's no documented external API; the REST endpoints are designed for the first-party frontend.

- [ ] **M** OpenAPI / Swagger specification generated from the source (e.g. `utoipa` for axum).
- [ ] **M** Per-tenant API keys with scoped permissions.
- [ ] **L** Webhooks: tenants can subscribe to events (shift committed, maintenance finished, device added) for their own automation.
- [ ] **L** Zapier / Make.com integration for non-technical customers.

## 16. Legal & compliance

- [ ] **S** Terms of Service.
- [ ] **S** Privacy Policy (GDPR-compliant, since EU).
- [ ] **S** Cookie consent banner (EU).
- [ ] **M** Data Processing Agreement (DPA) template for B2B customers.
- [ ] **M** Subprocessor list (GCS, Google OAuth, email provider, Stripe, etc.) — required by GDPR.
- [ ] **M** Right to erasure + right to data portability — implementable once §1 deletion and §10 exports exist.
- [ ] **M** Records-of-processing-activities (Art. 30 GDPR) documentation.
- [ ] **M** SOC 2 / ISO 27001 — only if enterprise customers demand it. Long lead time when needed.

## 17. Customer-facing surface area

- [ ] **M** Marketing/landing site at the root domain. Today the root serves the app, which is a non-starter for unauthenticated visitors.
- [ ] **S** Pricing page.
- [ ] **S** "Request a demo" / lead-capture form.
- [ ] **M** Help center / knowledge base.
- [ ] **S** In-app help widget (Intercom / Crisp / Help Scout).
- [ ] **M** Onboarding wizard for the first user of a new tenant: company info, first building, first device, invite teammates.
- [ ] **S** Sample-data option so a new tenant can explore without setting up real devices.

## 18. Mobile

The PWA is the only mobile-class experience today. Field technicians work in basements with no signal — native apps offer better offline/camera reliability.

- [ ] **L** Native iOS app (or Capacitor wrapper as a halfway step).
- [ ] **L** Native Android app.
- [ ] **S** Make sure the PWA install / iOS-add-to-homescreen flow is solid in the meantime.

## 19. Known existing bugs to resolve before launching to non-NoMa users

From `dev/dev_notes.md` and the prior review:

- [ ] **S** Lead is stranded at `READY_TO_COMMIT` — `/api/shifts/current` filters that status out, so the lead can't commit from the UI.
- [ ] **S** `DECLINED` participants can still hit `/shifts/{id}/waiting-room` and the SSE stream — leaks data.
- [ ] **S** Several DB CHECK / trigger violations surface as **500 INTERNAL** because handlers don't map them to **400/409**. Catalog and fix at least the user-reachable ones.
- [ ] **S** Backend tests don't exist — implementing `dev/backend_test_plan.md` is a prerequisite to confidently shipping any of the above.

---

## Recommended phasing

Roughly the order in which work would unblock real customers:

1. **Foundations (P0)**: §14 CI + §11 audit log + §19 bug fixes + §12 security hardening basics. Without these you can't safely ship any new tenant.
2. **Multi-tenant minimum viable (P0)**: §1 tenant lifecycle (manual onboarding via super-admin is OK initially) + §2 invite flow + §6 cookie/branding cleanups + §4 cross-tenant test net + §15 OpenAPI spec.
3. **Self-serve readiness (P1)**: §1 self-serve sign-up + §9 billing + §17 marketing site + §16 legal docs + §10 PDF reports.
4. **International readiness (P1)**: §5 i18n + §7 domain abstractions + §13 observability for production scale.
5. **Enterprise-readiness (P2)**: §2 SSO + §11 audit retention + §15 webhooks + §16 SOC 2.

A reasonable single-quarter MVP scope: items 1 and 2. That gets you from "only NoMa can use this" to "we can manually onboard a second pilot customer."
