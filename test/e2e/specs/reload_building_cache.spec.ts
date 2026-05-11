// Journey: any participant opens /shifts/current, picks "Berendezés adatok újratöltése"
// from the actions menu, and the IndexedDB building snapshot is populated. Catalog row
// covered: E16. The preset seeds the shift directly in DB so the snapshot has not been
// pre-populated by any UI flow — proving the menu action does rebuild it.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("reload building cache", () => {
  test("menu action populates IndexedDB snapshot via /api/labeling/buildings/:id/cache", async ({
    page,
  }) => {
    const tenant = await seedTenant("reload-cache");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_lead_only");

    const building = await dbOne<{ id: string }>(
      "SELECT id FROM buildings WHERE tenant_id = $1",
      [tenant.id],
    );

    await loginAs(page, userEmail(tenant.id, "lead"));
    await page.goto("/shifts/current");
    // Wait for the waiting-room payload to land — the participants list renders with the
    // lead's name once it does. Opening the menu before this point shows a partially
    // populated menu.
    await expect(page.getByText("Test Lead")).toBeVisible();

    // Reload via the menu. The post-condition assertion below is the load-bearing
    // check; an explicit pre-condition "cache is empty" assertion was tried earlier but
    // produced flaky "Execution context was destroyed" errors when the shift detail
    // page re-rendered after the initial waiting-room fetch resolved.
    await page.getByRole("button", { name: "Műveletek" }).click();
    await page
      .getByRole("menuitem", { name: "Berendezés adatok újratöltése" })
      .click();

    await expect(
      page.getByText("Berendezés adatok sikeresen újratöltve.", { exact: false }),
    ).toBeVisible();

    // After the action, the cache is populated with the building + its 10 devices.
    // expect.poll re-runs page.evaluate if a transient re-render destroys the context.
    await expect
      .poll(
        async () => {
          const snapshot = (await page.evaluate(
            ({ tenantId, buildingId }) =>
              window.__noma_e2e!.getCachedBuildingSnapshot(tenantId, buildingId),
            { tenantId: tenant.id, buildingId: building!.id },
          )) as { building: { id: string }; devices: unknown[] } | null;
          if (!snapshot) return null;
          return {
            buildingId: snapshot.building.id,
            deviceCount: snapshot.devices.length,
          };
        },
        { timeout: 5_000 },
      )
      .toEqual({ buildingId: building!.id, deviceCount: 10 });
  });
});
