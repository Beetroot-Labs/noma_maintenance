// Smoke test for the e2e scaffolding itself: boot the backend, seed a tenant + user,
// log in via the dev-login bypass, and confirm /api/auth/me returns the expected
// session. If this passes, the framework is ready for real test cases.

import { expect, test } from "@playwright/test";

import { dbQuery } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { loginAs } from "../helpers/auth";
import { userEmail } from "../helpers/users";

test.describe("smoke / dev-login bypass", () => {
  test("logged-in user surfaces in /api/auth/me", async ({ page }) => {
    const tenant = await seedTenant("smoke");
    await applyPreset(tenant.id, "users_basic");

    // sanity-check the preset
    const [{ count }] = await dbQuery<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(Number(count)).toBe(4);

    const email = userEmail(tenant.id, "lead");

    await loginAs(page, email);

    const me = await page.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe(email);
    expect(body.user.role).toBe("LEAD_TECHNICIAN");
    expect(body.user.tenant_id).toBe(tenant.id);
  });
});
