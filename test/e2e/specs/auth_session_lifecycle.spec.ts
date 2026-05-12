// Journey: unauthenticated visit → login → authenticated visit to /login → logout.
// Catalog rows covered: A1 (gate redirects to /login), A2 (authenticated /login redirects
// away), A6 (logout via avatar menu clears the session). A7 (hydration spinner) is not
// asserted here — it is a transient state that Playwright cannot observe reliably without
// intercepting /api/auth/me, which would defeat the purpose of an integration test.
//
// Note on A1's "restore original path after login": the current `RequireDemoUser` gate
// in App.tsx does not pass `location.state.from` when redirecting, so the path is not
// preserved across login today. The catalog describes intended behavior; this spec
// covers only the parts that are actually implemented.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("auth session lifecycle", () => {
  test("unauth redirect → login → authenticated redirect → logout", async ({
    page,
    context,
  }) => {
    const tenant = await seedTenant("auth");
    await applyPreset(tenant.id, "users_basic");
    const leadEmail = userEmail(tenant.id, "lead");

    // A1 — Unauthenticated visit to a protected route redirects to /login.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);

    // The /api/auth/me endpoint should report no user when no cookie is present.
    const unauthMe = await page.request.get("/api/auth/me");
    expect(unauthMe.status()).toBe(401);

    // Log in via the dev-login bypass; cookie is set in the shared request context.
    await loginAs(page, leadEmail);

    // A2 — Authenticated visit to /login redirects away (default target /home).
    await page.goto("/login");
    await expect(page).toHaveURL(/\/home$/);

    // /api/auth/me now confirms the session.
    const authedMe = await page.request.get("/api/auth/me");
    expect(authedMe.status()).toBe(200);
    expect((await authedMe.json()).user.email).toBe(leadEmail);

    // A6 — Logout via the avatar menu's "Kijelentkezés" item.
    await page.getByRole("button", { name: "Felhasználói menü" }).click();
    await page.getByRole("menuitem", { name: /Kijelentkezés/ }).click();

    // After logout, the app navigates to /login and the session cookie is invalidated.
    await expect(page).toHaveURL(/\/login$/);
    const postLogoutMe = await page.request.get("/api/auth/me");
    expect(postLogoutMe.status()).toBe(401);

    // Re-visiting a protected route stays unauthenticated.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);

    // Sanity: the context's cookies no longer carry an active session cookie.
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === "noma_session");
    // The backend may issue a cleared cookie (empty value, expired); either absent or
    // empty-valued is acceptable here. What matters is that /auth/me returns 401, which
    // we've already asserted.
    if (sessionCookie) {
      expect(sessionCookie.value).toBe("");
    }
  });
});
