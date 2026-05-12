// Journey: lead clicks "Műszak lezárása" on /shifts/current, confirms the dialog, and
// the shift transitions to CLOSE_REQUESTED with the waiting banner visible because tech1
// has not yet CLOSE_CONFIRMED. Catalog rows covered: E17 (request close), E18 (banner
// while waiting for participant confirmations).

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("lead requests shift close", () => {
  test("close-request → status flips, waiting banner appears", async ({ page }) => {
    const tenant = await seedTenant("close-req");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_tech1");

    await loginAs(page, userEmail(tenant.id, "lead"));
    await page.goto("/shifts/current");

    // The button text "Műszak lezárása" also matches the dialog title — disambiguate
    // by role=button. The button is rendered before the dialog opens, so this resolves.
    await page.getByRole("button", { name: "Műszak lezárása" }).click();

    // Confirm in the dialog.
    await page.getByRole("button", { name: "Igen, lezárom" }).click();

    // E17 — DB reflects CLOSE_REQUESTED.
    await expect
      .poll(
        async () => {
          const row = await dbOne<{ status: string }>(
            "SELECT status FROM shifts WHERE tenant_id = $1",
            [tenant.id],
          );
          return row?.status;
        },
        { timeout: 5_000 },
      )
      .toBe("CLOSE_REQUESTED");

    // E18 — waiting banner is visible because tech1 has not yet CLOSE_CONFIRMED.
    await expect(
      page.getByText("A műszak lezárása folyamatban van.", { exact: false }),
    ).toBeVisible();
  });
});
