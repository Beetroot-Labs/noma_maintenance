// Journey: tech1 starts a maintenance, completes it (routine, with photo), then
// navigates back to /maintenance/:work_id, opens the meatballs menu, picks "Utólagos
// szerkesztés", modifies the notes, and saves. The "Legutóbb módosítva" tile appears.
//
// Catalog rows covered: G15 (post-edit happy path), G16 (last-edited timestamp tile).
// This spec necessarily covers the start + complete flow too as scaffolding; the
// dedicated `complete_routine_maintenance` spec is the one that asserts on the
// complete-flow contract.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

const PHOTO_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
  "photos",
  "sample.jpg",
);

test.describe("maintenance post-edit", () => {
  test("after completion, executor edits notes → Legutóbb módosítva tile renders", async ({
    page,
  }) => {
    const tenant = await seedTenant("post-edit");
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

    // Start + complete a routine maintenance.
    await page.goto("/new-maintenance");
    await page.getByRole("button", { name: "Kézi bevitel" }).click();
    await page.getByPlaceholder("pl. DEMO-DEVICE-001").fill(barcode);
    await page.getByRole("option", { name: barcode }).click();
    await page
      .getByRole("button", { name: "Karbantartás megkezdése" })
      .click();
    await expect(page).toHaveURL(/\/maintenance\/[a-f0-9-]+$/);
    const workUrl = page.url();

    await page.getByPlaceholder(/megfigyeléseket/).fill("Original notes.");
    await page.locator("input#photo-input").setInputFiles(PHOTO_PATH);
    await page.getByRole("button", { name: "Fotó mentése" }).click();
    await page
      .getByRole("button", { name: "Karbantartás befejezése" })
      .click();
    await expect(page).toHaveURL(/\/shifts\/current$/);

    // MaintenanceContext persists state to IDB with a 300ms debounce. page.goto below
    // is a full reload, so the persisted state must include the completed status before
    // we navigate, otherwise the rehydrated work is still "in-progress" and the menu's
    // "Utólagos szerkesztés" option (gated on status === "completed") is absent.
    const tech1 = await dbOne<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
      [tenant.id, userEmail(tenant.id, "tech1")],
    );
    await expect
      .poll(
        async () => {
          const state = (await page.evaluate(
            ({ tid, uid }) => window.__noma_e2e!.getMaintenanceState(tid, uid),
            { tid: tenant.id, uid: tech1!.id },
          )) as { todaysWorks?: { status: string }[] } | null;
          return state?.todaysWorks?.map((w) => w.status) ?? null;
        },
        { timeout: 5_000 },
      )
      .toEqual(["completed"]);

    // Navigate back to the maintenance detail and post-edit the notes.
    await page.goto(workUrl);
    // The maintenance page rehydrates from IDB on mount; wait for the work card to be
    // rendered before opening the menu (the menu's content depends on derived state
    // that requires the work to be loaded).
    await expect(page.getByText("Megjegyzések")).toBeVisible();
    await page
      .getByRole("button", { name: "További lehetőségek" })
      .click();
    await page.getByRole("menuitem", { name: "Utólagos szerkesztés" }).click();

    await page
      .getByPlaceholder(/megfigyeléseket/)
      .fill("Edited notes after completion.");
    await page
      .getByRole("button", { name: "Elmentem a módosításokat" })
      .click();

    // G16 — "Legutóbb módosítva" tile appears after an edit.
    await expect(
      page.getByText("Legutóbb módosítva", { exact: false }),
    ).toBeVisible();
  });
});
