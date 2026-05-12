// Journey: lead is on /shifts/current with a previously-DECLINED tech1 participant.
// They reinvite tech1, then open the add-participant dialog and invite tech2. Catalog
// rows covered: E8 (reinvite DECLINED), E12 (open add dialog, candidate list loads),
// E13 (submit add → new participant row), E11 (button presence). E9 (remove participant)
// is not covered — it requires shift status READY_TO_START, and the create_shift handler
// in the current code base jumps directly to IN_PROGRESS. E9 would need an artificial
// status seed; deferring until the shift state machine is exercised end-to-end.
// E10 (transient "(újrahívás...)" suffix) is not asserted — too narrow a window for
// stable observation.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne, dbQuery } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("lead manages participants", () => {
  test("reinvite a DECLINED tech, then add a new participant", async ({ page }) => {
    const tenant = await seedTenant("manage-participants");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_declined_participant");

    await loginAs(page, userEmail(tenant.id, "lead"));
    await page.goto("/shifts/current");
    await expect(page).toHaveURL(/\/shifts\/current$/);

    const shift = await dbOne<{ id: string }>(
      "SELECT id FROM shifts WHERE tenant_id = $1",
      [tenant.id],
    );
    const tech1 = await dbOne<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
      [tenant.id, userEmail(tenant.id, "tech1")],
    );
    const tech2 = await dbOne<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
      [tenant.id, userEmail(tenant.id, "tech2")],
    );

    // E8 — reinvite tech1. The IconButton carries aria-label="Résztvevő újrahívása".
    await page.getByRole("button", { name: "Résztvevő újrahívása" }).click();

    await expect
      .poll(
        async () => {
          const row = await dbOne<{ status: string }>(
            "SELECT status FROM shift_participants WHERE tenant_id = $1 AND shift_id = $2 AND user_id = $3",
            [tenant.id, shift!.id, tech1!.id],
          );
          return row?.status;
        },
        { timeout: 5_000 },
      )
      .toBe("INVITED");

    // E12 — open add-participant dialog; the candidate autocomplete is labelled
    // "Felhasználó" and renders options as "<full_name> (<email>)".
    await page.getByRole("button", { name: "Résztvevő hozzáadása" }).click();
    const candidateInput = page.getByRole("combobox", { name: "Felhasználó" });
    await candidateInput.click();
    await candidateInput.fill("Test Tech Two");
    await page
      .getByRole("option", { name: new RegExp(`Test Tech Two`) })
      .click();

    // E13 — submit; new participant row appears.
    await page
      .getByRole("button", { name: /^Hozzáadás$/ })
      .click();

    await expect
      .poll(
        async () => {
          const rows = await dbQuery<{ user_id: string; status: string }>(
            "SELECT user_id, status FROM shift_participants WHERE tenant_id = $1 AND shift_id = $2",
            [tenant.id, shift!.id],
          );
          return rows.map((r) => ({ user_id: r.user_id, status: r.status }));
        },
        { timeout: 5_000 },
      )
      .toContainEqual({ user_id: tech2!.id, status: "INVITED" });
  });
});
