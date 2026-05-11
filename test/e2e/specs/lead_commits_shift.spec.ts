// Journey: lead opens /shift-summary on a READY_TO_COMMIT-equivalent shift, fills
// referent name + role, draws a signature on the pad, and submits. The signature image
// PUT and commit POST both succeed; DB shifts row becomes COMMITTED and a row is
// recorded in shift_signatures. Catalog rows covered: J3 (initial load renders rows),
// J6 (signature pad), J7 (required referent fields), J8 (empty signature blocks submit),
// J9 (commit happy path).

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { promoteShiftToReadyToCommit } from "../helpers/shifts";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("lead commits shift", () => {
  test("fills referent + signature → DB COMMITTED + signature row exists", async ({
    page,
  }) => {
    const tenant = await seedTenant("commit-shift");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "shift_ready_to_commit");
    // Flip the shift status to READY_TO_COMMIT — the backend's signature-upload
    // handler requires it, but the preset can't insert participants on a frozen shift,
    // so the transition is a separate UPDATE.
    await promoteShiftToReadyToCommit(tenant.id);

    const shift = await dbOne<{ id: string }>(
      "SELECT id FROM shifts WHERE tenant_id = $1",
      [tenant.id],
    );

    await loginAs(page, userEmail(tenant.id, "lead"));
    // Use the URL-param entry point (catalog J1) — the no-arg /shift-summary needs
    // currentShift to satisfy hasActiveShiftAccess, which excludes READY_TO_COMMIT.
    await page.goto(`/shifts/${shift!.id}/summary`);
    const commitBtn = page.getByRole("button", {
      name: "Műszak véglegesítése",
    });
    await expect(commitBtn).toBeVisible();
    // J7 / J8 — the button is gated by `canSubmit = name && role && !signatureEmpty`.
    // With only the referent filled in, the button stays disabled (the page's toast
    // about a missing signature is only emitted via the handler's defensive check, and
    // the disabled button keeps that path unreachable through normal UI).
    await page.getByLabel("Név").fill("E2E Witness");
    await page.getByLabel("Beosztás").fill("Épületgondnok");
    await expect(commitBtn).toBeDisabled();

    // J6 — draw a non-empty stroke on the signature canvas. signature_pad listens for
    // pointer events; Playwright's mouse APIs synthesise pointer events on Chromium.
    // Per plan §10 a single non-empty stroke is enough.
    //
    // The `endStroke` listener (line 164 of ShiftSummaryPage.tsx) flips
    // `isSignatureEmpty` to false on pointerup, which enables the submit button. Under
    // load this state update can lag behind the `mouse.up` call, so we poll the button
    // state with a retry-stroke loop instead of asserting once — a single stroke is
    // sometimes rejected by signature_pad's velocity filter when the synthesised
    // pointer events arrive without enough motion between samples.
    const canvas = page.locator("canvas").first();
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

    // J9 — submit; the page PUTs the signature image then POSTs commit. After commit,
    // the page navigates away (to /pending-worksheets or /). DB has COMMITTED + row in
    // shift_signatures.
    await page
      .getByRole("button", { name: "Műszak véglegesítése" })
      .click();

    await expect
      .poll(
        async () => {
          const row = await dbOne<{ status: string }>(
            "SELECT status FROM shifts WHERE tenant_id = $1",
            [tenant.id],
          );
          return row?.status;
        },
        { timeout: 10_000 },
      )
      .toBe("COMMITTED");

    const signature = await dbOne<{
      reference_person_name: string;
      reference_person_role: string;
      signature_image_url: string;
    }>(
      "SELECT reference_person_name, reference_person_role, signature_image_url FROM shift_signatures WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(signature).not.toBeNull();
    expect(signature!.reference_person_name).toBe("E2E Witness");
    expect(signature!.reference_person_role).toBe("Épületgondnok");
    expect(signature!.signature_image_url).toBeTruthy();
  });
});
