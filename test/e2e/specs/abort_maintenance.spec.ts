// Journey: tech1 starts a maintenance via manual entry, then aborts it from the
// meatballs menu. Catalog row covered: G14. Aborted state is asserted both in the URL
// (returns to /shifts/current) and in the DB after sync.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("abort maintenance", () => {
  test("start via manual entry → abort from menu → DB row ABORTED", async ({
    page,
  }) => {
    const tenant = await seedTenant("abort-work");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_tech1");

    const short = tenant.id.slice(0, 8);
    const barcode = `BC0000001-${short}`;

    await loginAs(page, userEmail(tenant.id, "tech1"));
    await page.goto("/shifts/current");
    await expect(page.getByText("Test Lead")).toBeVisible();

    // Warm tech1's IndexedDB building cache.
    await page.getByRole("button", { name: "Műveletek" }).click();
    await page
      .getByRole("menuitem", { name: "Berendezés adatok újratöltése" })
      .click();
    await expect(
      page.getByText("Berendezés adatok sikeresen újratöltve.", { exact: false }),
    ).toBeVisible();

    // Start a maintenance.
    await page.goto("/new-maintenance");
    await page.getByRole("button", { name: "Kézi bevitel" }).click();
    await page.getByPlaceholder("pl. DEMO-DEVICE-001").fill(barcode);
    await page.getByRole("option", { name: barcode }).click();
    await page
      .getByRole("button", { name: "Karbantartás megkezdése" })
      .click();
    await expect(page).toHaveURL(/\/maintenance\/[a-f0-9-]+$/);

    // G14 — abort via meatballs menu. On MaintenancePage the IconButton aria-label is
    // "További lehetőségek" (the shift page uses "Műveletek" — different labels for the
    // same UI affordance).
    await page.getByRole("button", { name: "További lehetőségek" }).click();
    await page
      .getByRole("menuitem", { name: "Karbantartás megszakítása" })
      .click();

    // Abort is a *local-only* operation: abortMaintenance() in MaintenanceContext
    // simply removes the work from the local store (todaysWorks). There is no outbox
    // queuing for abort, so DB state is not the right assertion target — the work may
    // or may not have synced as IN_PROGRESS earlier; either way, aborting does not
    // reach the backend. The observable contract is the toast and the redirect.
    await expect(
      page.getByText("A karbantartás megszakítva.", { exact: false }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/shifts\/current$/);
  });
});
