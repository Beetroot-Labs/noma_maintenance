// Journey: tech1 starts a maintenance, switches to the SERVICE kind, attempts to
// complete without an issue number (validation feedback appears), then fills issue
// number, marks follow-up service required with one reason, and completes. Catalog
// rows covered: G4 SERVICE, G5 (issue number required for service), G6 (follow-up
// reasons), G7 (toggling follow-up changes requirements), G13 (validation feedback).

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbQuery } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("complete service maintenance", () => {
  test("SERVICE kind + issue number + follow-up reason → DB row FINISHED", async ({
    page,
  }) => {
    const tenant = await seedTenant("complete-service");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_tech1");

    const short = tenant.id.slice(0, 8);
    const barcode = `BC0000001-${short}`;

    await loginAs(page, userEmail(tenant.id, "tech1"));
    await page.goto("/shifts/current");
    await expect(page.getByText("Test Lead")).toBeVisible();

    await page.getByRole("button", { name: "Műveletek" }).click();
    await page
      .getByRole("menuitem", { name: "Berendezés adatok újratöltése" })
      .click();
    await expect(
      page.getByText("Berendezés adatok sikeresen újratöltve.", { exact: false }),
    ).toBeVisible();

    await page.goto("/new-maintenance");
    await page.getByRole("button", { name: "Kézi bevitel" }).click();
    await page.getByPlaceholder("pl. DEMO-DEVICE-001").fill(barcode);
    await page.getByRole("option", { name: barcode }).click();
    await page
      .getByRole("button", { name: "Karbantartás megkezdése" })
      .click();
    await expect(page).toHaveURL(/\/maintenance\/[a-f0-9-]+$/);

    // G4 — toggle to SERVICE. The ToggleButton renders the Hungarian label "Szervíz",
    // not the enum string.
    await page.getByRole("button", { name: "Szervíz", exact: true }).click();

    // G5 / G13 — without issue number, the validation helper text should explain.
    await expect(
      page.getByText("Szervíz esetén az igénylési szám megadása kötelező", {
        exact: false,
      }),
    ).toBeVisible();

    // Issue number — the TextField has no <label>; the "Igénylési szám" text is a
    // sibling Typography. Use the placeholder "Q123456" to target the input.
    await page.getByPlaceholder("Q123456").fill("Q123456");

    // G6 — turn on follow-up service. The MUI <Switch> isn't wrapped in a
    // FormControlLabel; its caption "További szervíz szükséges" is a sibling Typography.
    // The page has exactly one role=checkbox affordance (the Switch), so we target it
    // directly.
    await page.getByRole("checkbox").click();
    // Pick the first non-OTHER reason. Labels live in
    // frontend/apps/main/src/types/maintenance.ts — CLEANING renders as "Mosás".
    await page.getByRole("button", { name: "Mosás" }).click();

    // G12 — complete. Photo is not required when follow-up service is required (G11).
    await page
      .getByRole("button", { name: "Karbantartás befejezése" })
      .click();
    await expect(page).toHaveURL(/\/shifts\/current$/);

    await expect
      .poll(
        async () => {
          const rows = await dbQuery<{
            status: string;
            kind: string;
            issue_number: string | null;
            followup_service_required: boolean;
          }>(
            "SELECT status, kind, issue_number, followup_service_required FROM maintenance_works WHERE tenant_id = $1",
            [tenant.id],
          );
          if (rows.length !== 1) return null;
          const row = rows[0];
          return {
            status: row.status,
            kind: row.kind,
            issueNumber: row.issue_number,
            followup: row.followup_service_required,
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({
        status: "FINISHED",
        kind: "SERVICE",
        issueNumber: "Q123456",
        followup: true,
      });
  });
});
