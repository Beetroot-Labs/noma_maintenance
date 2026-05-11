// Journey: lead lands on /shifts/current with the shift already in READY_TO_COMMIT and
// every non-declined participant CLOSE_CONFIRMED. The "Műszak összegzése" button is
// visible and clicking it navigates to /shift-summary. Catalog row covered: E19.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("lead starts shift summary", () => {
  test("READY_TO_COMMIT + all confirmed → Műszak összegzése navigates to /shift-summary", async ({
    page,
  }) => {
    const tenant = await seedTenant("summary-start");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "shift_ready_to_commit");

    await loginAs(page, userEmail(tenant.id, "lead"));
    await page.goto("/shifts/current");

    const summaryButton = page.getByRole("button", { name: "Műszak összegzése" });
    await expect(summaryButton).toBeVisible();
    await summaryButton.click();

    await expect(page).toHaveURL(/\/shift-summary$/);
  });
});
