// Journey: lead opens /shifts/start, picks the auto-selected building, creates a shift,
// and lands on /shifts/current. Catalog rows covered: D1 (lead access), D2 (initial load),
// D3 (building selector with formatted option label), D4 (POST /api/shifts → navigate
// → DB state), D8 (helper text + sole-participant assertion).
//
// D5 (transient "Műszak előkészítése folyamatban..." spinner) is not asserted — the
// window between POST /shifts succeeding and navigate() running is too narrow to observe
// reliably without artificially delaying network calls, and observing it does not protect
// against any regression the DB / URL assertions would miss.
//
// D6 (anomalous user without tenantId) is skipped — that state is not reachable from a
// normal session and is not a realistic regression target.
//
// D7 (backend rejection) lives in shift_creation_backend_error.spec.ts (different setup).

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne, dbQuery } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("lead creates shift", () => {
  test("happy path → shift IN_PROGRESS with lead as sole CACHE_READY participant", async ({
    page,
  }) => {
    const tenant = await seedTenant("create-shift");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    const short = tenant.id.slice(0, 8);
    const leadEmail = userEmail(tenant.id, "lead");
    const expectedBuildingName = `Test Building ${short}`;
    const expectedBuildingAddress = `Test Street 1, ${short} City`;

    await loginAs(page, leadEmail);

    // D1 — lead can access /shifts/start (no redirect away).
    await page.goto("/shifts/start");
    await expect(page).toHaveURL(/\/shifts\/start$/);

    // D2 + D3 — buildings load and the first is auto-selected; the autocomplete renders
    // the option as "<name> (<address>)" via getOptionLabel.
    const buildingInput = page.getByLabel("Épület kiválasztása");
    await expect(buildingInput).toHaveValue(
      `${expectedBuildingName} (${expectedBuildingAddress})`,
    );

    // D8 frontend — helper text explaining the sole-lead-as-participant rule is visible.
    await expect(
      page.getByText("A műszak létrehozásakor csak a műszakvezető kerül a résztvevők közé.", {
        exact: false,
      }),
    ).toBeVisible();

    // D4 — click "Műszak létrehozása" → app posts /api/shifts and navigates.
    await page
      .getByRole("button", { name: "Műszak létrehozása" })
      .click();

    await expect(page).toHaveURL(/\/shifts\/current$/);

    // D4 backend — exactly one shift row for this tenant, IN_PROGRESS, lead is the lead.
    const lead = await dbOne<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
      [tenant.id, leadEmail],
    );
    expect(lead).not.toBeNull();

    const building = await dbOne<{ id: string }>(
      "SELECT id FROM buildings WHERE tenant_id = $1 AND name = $2",
      [tenant.id, expectedBuildingName],
    );
    expect(building).not.toBeNull();

    const shifts = await dbQuery<{
      id: string;
      building_id: string;
      lead_user_id: string;
      status: string;
      started_at: string | null;
    }>(
      "SELECT id, building_id, lead_user_id, status, started_at FROM shifts WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(shifts).toHaveLength(1);
    const shift = shifts[0];
    expect(shift.building_id).toBe(building!.id);
    expect(shift.lead_user_id).toBe(lead!.id);
    expect(shift.status).toBe("IN_PROGRESS");
    expect(shift.started_at).not.toBeNull();

    // D8 backend — exactly one participant, and that participant is the lead.
    const participants = await dbQuery<{ user_id: string; status: string }>(
      "SELECT user_id, status FROM shift_participants WHERE tenant_id = $1 AND shift_id = $2",
      [tenant.id, shift.id],
    );
    expect(participants).toHaveLength(1);
    expect(participants[0].user_id).toBe(lead!.id);
    // The backend sets CACHE_READY directly on the lead at creation time.
    expect(participants[0].status).toBe("CACHE_READY");
  });
});
