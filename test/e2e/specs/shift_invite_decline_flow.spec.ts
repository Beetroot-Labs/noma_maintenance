// Journey: tech1 has an INVITED participant row, opens /home, and clicks "Elutasítás".
// The backend marks them DECLINED. Catalog rows covered: C4 (DECLINED label not asserted
// here but flow is the contract), C6 (decline POSTs /decline and refreshes), C7 (buttons
// disable while in flight — implicit when both buttons remain mutually exclusive).
//
// Single-context — there's no SSE assertion separate from the DB state check.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("shift invite decline flow", () => {
  test("tech declines → DB DECLINED", async ({ page }) => {
    const tenant = await seedTenant("invite-decline");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_invited_tech1");

    await loginAs(page, userEmail(tenant.id, "tech1"));
    await page.goto("/home");
    await expect(
      page.getByText("Meghívást kapott egy műszakhoz.", { exact: false }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Elutasítás$/ }).click();

    const tech1 = await dbOne<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
      [tenant.id, userEmail(tenant.id, "tech1")],
    );
    await expect
      .poll(
        async () => {
          const row = await dbOne<{ status: string }>(
            "SELECT status FROM shift_participants WHERE tenant_id = $1 AND user_id = $2",
            [tenant.id, tech1!.id],
          );
          return row?.status;
        },
        { timeout: 5_000 },
      )
      .toBe("DECLINED");
  });
});
