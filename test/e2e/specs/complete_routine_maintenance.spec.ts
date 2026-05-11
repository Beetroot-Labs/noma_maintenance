// Journey: tech1 reloads the building cache, starts a maintenance via manual entry,
// fills the notes, uploads a photo, and completes. The work syncs to backend; we poll
// /api/shifts/:id/maintenance-summary until the FINISHED row appears.
//
// Catalog rows covered: F11 (manual entry happy path), G4 (kind toggle — defaults to
// ROUTINE), G8 (notes textarea), G9/G10 (photo upload required for non-followup),
// G12 (complete maintenance happy path).

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbQuery } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

const PHOTO_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
  "photos",
  "sample.jpg",
);

test.describe("complete routine maintenance", () => {
  test("manual entry → notes + photo → complete → backend has FINISHED row", async ({
    page,
  }) => {
    const tenant = await seedTenant("complete-routine");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_tech1");

    const short = tenant.id.slice(0, 8);
    const barcode = `BC0000001-${short}`;

    await loginAs(page, userEmail(tenant.id, "tech1"));
    await page.goto("/shifts/current");
    await expect(page.getByText("Test Lead")).toBeVisible();

    // Populate tech1's IndexedDB building cache (this preset bypasses the UI flow that
    // would have done it on accept-invite/shift-start).
    await page.getByRole("button", { name: "Műveletek" }).click();
    await page
      .getByRole("menuitem", { name: "Berendezés adatok újratöltése" })
      .click();
    await expect(
      page.getByText("Berendezés adatok sikeresen újratöltve.", { exact: false }),
    ).toBeVisible();

    // Start a maintenance via manual entry. /new-maintenance opens the camera scanner
    // dialog by default (F2); we dismiss it via the "Kézi bevitel" header button (F5).
    await page.goto("/new-maintenance");
    await page.getByRole("button", { name: "Kézi bevitel" }).click();

    const barcodeInput = page.getByPlaceholder("pl. DEMO-DEVICE-001");
    await barcodeInput.fill(barcode);
    // The MUI Autocomplete opens a popper that intercepts clicks elsewhere; close it
    // by selecting the matching option (also exercises the subsequence-match path).
    await page.getByRole("option", { name: barcode }).click();
    await page
      .getByRole("button", { name: "Karbantartás megkezdése" })
      .click();

    await expect(page).toHaveURL(/\/maintenance\/[a-f0-9-]+$/);

    // G8 — fill notes. The TextField has no explicit label; placeholder is stable.
    await page
      .getByPlaceholder(/megfigyeléseket/)
      .fill("E2E routine inspection completed.");

    // G9 / G10 — upload a photo. PhotoUpload renders a hidden file input with id
    // photo-input that setInputFiles drives directly; selecting a file opens the
    // "Fotó leírása" description dialog. Description is optional; we just save.
    await page.locator("input#photo-input").setInputFiles(PHOTO_PATH);
    await page.getByRole("button", { name: "Fotó mentése" }).click();

    // G12 — complete.
    await page
      .getByRole("button", { name: "Karbantartás befejezése" })
      .click();

    // Navigates back to /shifts/current after completion.
    await expect(page).toHaveURL(/\/shifts\/current$/);

    // Originally the plan was to poll /api/shifts/:id/maintenance-summary; that endpoint
    // requires lead-or-admin (require_lead_or_admin in backend/src/shifts.rs), so a tech
    // gets 403. Polling DB directly is the practical equivalent — same end-state, but
    // doesn't need a second session.
    await expect
      .poll(
        async () => {
          const rows = await dbQuery<{ status: string }>(
            "SELECT status FROM maintenance_works WHERE tenant_id = $1",
            [tenant.id],
          );
          return rows.map((r) => r.status);
        },
        { timeout: 15_000 },
      )
      .toEqual(["FINISHED"]);
  });
});
