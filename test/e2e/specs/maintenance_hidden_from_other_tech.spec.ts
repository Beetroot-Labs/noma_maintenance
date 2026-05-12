// Journey: tech1 has an IN_PROGRESS maintenance row in the DB (seeded by preset). tech2,
// a co-participant of the same shift, navigates directly to /maintenance/:id by URL.
// Tech2 should NOT see tech1's maintenance — the local IDB-backed page treats the work
// as not found and shows the G1 fallback.
//
// Catalog row covered: G1 (work not found from this user's perspective). The user's
// stricter contract (tech2 should not see tech1's maintenance) is satisfied because
// MaintenancePage reads from local IDB only; tech2's IDB never received the work.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("maintenance hidden from other tech", () => {
  test("tech2 visiting tech1's maintenance URL sees 'A munka nem található'", async ({
    page,
  }) => {
    const tenant = await seedTenant("hidden-work");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_tech1_and_tech2");
    await applyPreset(tenant.id, "in_progress_work_by_tech1");

    const work = await dbOne<{ id: string }>(
      "SELECT id FROM maintenance_works WHERE tenant_id = $1",
      [tenant.id],
    );

    await loginAs(page, userEmail(tenant.id, "tech2"));
    await page.goto(`/maintenance/${work!.id}`);

    await expect(page.getByText("A munka nem található")).toBeVisible();
    // No complete/abort affordance for non-executors.
    await expect(
      page.getByRole("button", { name: "Karbantartás befejezése" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Karbantartás megszakítása" }),
    ).toHaveCount(0);
  });
});
