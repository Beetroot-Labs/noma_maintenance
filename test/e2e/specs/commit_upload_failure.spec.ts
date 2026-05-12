// Journey: lead fills the shift summary and draws a signature, but the PUT
// /signature-image is intercepted and fails. Catalog row covered: J10. The page surfaces
// the error and the shift is NOT committed.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { promoteShiftToReadyToCommit } from "../helpers/shifts";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("commit — upload failure", () => {
  test("PUT /signature-image 500 → error toast, shift not committed", async ({
    page,
  }) => {
    const tenant = await seedTenant("commit-upload-err");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "shift_ready_to_commit");
    await promoteShiftToReadyToCommit(tenant.id);

    const shift = await dbOne<{ id: string }>(
      "SELECT id FROM shifts WHERE tenant_id = $1",
      [tenant.id],
    );

    const errorMessage = "Próba: feltöltés hiba";
    await page.route("**/api/shifts/*/signature-image", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: errorMessage }),
        });
        return;
      }
      await route.continue();
    });

    await loginAs(page, userEmail(tenant.id, "lead"));
    await page.goto(`/shifts/${shift!.id}/summary`);

    await page.getByLabel("Név").fill("E2E Witness");
    await page.getByLabel("Beosztás").fill("Épületgondnok");

    // signature_pad's velocity filter sometimes rejects single synthesised strokes
    // under suite-level load. Use the same retry pattern as lead_commits_shift —
    // draw a stroke, check if the submit button is enabled, redraw if not.
    const canvas = page.locator("canvas").first();
    const commitBtn = page.getByRole("button", {
      name: "Műszak véglegesítése",
    });
    const drawStroke = async () => {
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(box.x + 20 + i * 25, box.y + 20 + i * 10, {
          steps: 4,
        });
      }
      await page.mouse.up();
    };
    await expect
      .poll(
        async () => {
          if (await commitBtn.isEnabled()) return "enabled";
          await drawStroke();
          return "disabled";
        },
        { timeout: 10_000, intervals: [200] },
      )
      .toBe("enabled");

    await commitBtn.click();

    // The error text comes from `readApiErrorMessage` on the response body.
    await expect(
      page.getByText(errorMessage, { exact: false }),
    ).toBeVisible();

    // Shift should still be READY_TO_COMMIT (not COMMITTED) and no signature row.
    const shiftAfter = await dbOne<{ status: string }>(
      "SELECT status FROM shifts WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(shiftAfter!.status).toBe("READY_TO_COMMIT");

    const signature = await dbOne<{ shift_id: string }>(
      "SELECT shift_id FROM shift_signatures WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(signature).toBeNull();
  });
});
