// Journey: lead opens /shifts/start, the backend rejects POST /api/shifts with a 500,
// and the page surfaces the backend's error message without navigating or persisting.
// Catalog row covered: D7. Separated from the happy-path spec because the setup diverges
// (page.route to intercept the create call).

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbQuery } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("shift creation — backend error", () => {
  test("rejected POST /api/shifts surfaces error alert and does not create a shift", async ({
    page,
  }) => {
    const tenant = await seedTenant("create-shift-err");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    const leadEmail = userEmail(tenant.id, "lead");

    await loginAs(page, leadEmail);

    // Intercept only the POST. /api/shifts is also used as GET /api/shifts/current and
    // GET /api/shifts/pending elsewhere, but the bare /api/shifts endpoint accepts POST.
    const backendErrorMessage = "Próba: szerverhiba";
    await page.route("**/api/shifts", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: backendErrorMessage }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/shifts/start");
    await expect(page.getByLabel("Épület kiválasztása")).toHaveValue(/Test Building/);

    await page
      .getByRole("button", { name: "Műszak létrehozása" })
      .click();

    // Stays on /shifts/start — no navigation.
    await expect(page).toHaveURL(/\/shifts\/start$/);

    // The MUI Alert renders the backend's error string verbatim.
    await expect(page.getByRole("alert")).toContainText(backendErrorMessage);

    // No shift row was persisted.
    const shifts = await dbQuery<{ id: string }>(
      "SELECT id FROM shifts WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(shifts).toHaveLength(0);

    // The submit button is re-enabled so the user can retry.
    await expect(
      page.getByRole("button", { name: "Műszak létrehozása" }),
    ).toBeEnabled();
  });
});
