// Journey: lead opens /shifts/current, opens the actions menu, picks "Műszak megszakítása",
// confirms the dialog, and lands on /home with the shift row deleted. Catalog row covered:
// E15. Aligned with plan §15 "Cancelled shift = as if it never existed" — the backend
// DELETEs the shift row rather than transitioning to CANCELLED.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbQuery } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("lead cancels shift", () => {
  test("confirms dialog → /home, shift row deleted", async ({ page }) => {
    const tenant = await seedTenant("cancel-shift");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_lead_only");

    await loginAs(page, userEmail(tenant.id, "lead"));
    await page.goto("/shifts/current");
    await expect(page).toHaveURL(/\/shifts\/current$/);
    // The "Műveletek" IconButton renders before the waiting-room payload arrives, but
    // the cancel menu item (gated by isShiftLead) is only present after the payload
    // resolves. Wait for a payload-dependent element first.
    await expect(page.getByText("Test Lead")).toBeVisible();

    await page.getByRole("button", { name: "Műveletek" }).click();
    await page.getByRole("menuitem", { name: "Műszak megszakítása" }).click();

    // Confirm in the dialog.
    await page.getByRole("button", { name: "Igen, megszakítom" }).click();

    // Lands on /home.
    await expect(page).toHaveURL(/\/home$/);

    // Plan §15: cancel deletes the row entirely.
    const shifts = await dbQuery<{ id: string }>(
      "SELECT id FROM shifts WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(shifts).toHaveLength(0);
  });
});
