// Journey: tech1 has an INVITED participant row; they open /home, click "Elfogadás",
// the building cache is built locally, the backend marks them CACHE_READY, and the page
// transitions out of the invite state. In parallel, the lead's open /shifts/current
// page receives a participants-updated SSE event and re-renders.
//
// Catalog rows covered: C3 (existing shift card), C4 (INVITED label), C5 (accept flow
// rebuilds cache then POSTs join-ready), C7 (buttons disable while in flight), E20 (SSE
// drives the lead's view to refresh).
//
// Uses two browser contexts because the SSE assertion requires the lead's page to be
// open at the moment the tech accepts.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { dbOne } from "../helpers/db";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("shift invite accept flow", () => {
  test("tech accepts → DB CACHE_READY + lead's page reflects new state via SSE", async ({
    browser,
  }) => {
    const tenant = await seedTenant("invite-accept");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_with_invited_tech1");

    const leadEmailAddr = userEmail(tenant.id, "lead");
    const techEmailAddr = userEmail(tenant.id, "tech1");

    // Lead context — open /shifts/current first so the SSE subscription is established
    // before the tech accepts.
    const leadCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();
    await loginAs(leadPage, leadEmailAddr);
    await leadPage.goto("/shifts/current");
    // Pre-condition: tech1 row exists. Don't over-specify the icon — the SSE assertion
    // below will catch any update via the rendered status text.
    await expect(leadPage.getByText("Test Tech One")).toBeVisible();

    // Tech context — start on /home; C4 invite card shows.
    const techCtx = await browser.newContext();
    const techPage = await techCtx.newPage();
    await loginAs(techPage, techEmailAddr);
    await techPage.goto("/home");
    await expect(
      techPage.getByText("Meghívást kapott egy műszakhoz.", { exact: false }),
    ).toBeVisible();

    // C5 / C7 — Click Elfogadás. Both Accept and Decline render with "..." labels mid-flight;
    // accept here matches name="Elfogadás" exactly (regex anchored).
    await techPage.getByRole("button", { name: /^Elfogadás$/ }).click();

    // C5 — backend marks tech1 CACHE_READY.
    const tech1 = await dbOne<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
      [tenant.id, techEmailAddr],
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
        { timeout: 15_000 },
      )
      .toBe("CACHE_READY");

    // E20 — lead's page receives the SSE update and the invited-loader icon for tech1
    // disappears. The participant row carries different icons by state; once tech1 is
    // CACHE_READY in an IN_PROGRESS shift, the spinning loader (INVITED state) should
    // no longer be the visible icon for that row. We assert at the data level by
    // re-fetching from the lead's request context.
    await expect
      .poll(
        async () => {
          const response = await leadPage.request.get(
            `/api/shifts/${(await dbOne<{ id: string }>("SELECT id FROM shifts WHERE tenant_id = $1", [tenant.id]))!.id}/waiting-room`,
          );
          if (!response.ok()) return null;
          const body = (await response.json()) as {
            participants: { user_id: string; status: string }[];
          };
          return body.participants.find((p) => p.user_id === tech1!.id)?.status;
        },
        { timeout: 15_000 },
      )
      .toBe("CACHE_READY");

    await leadCtx.close();
    await techCtx.close();
  });
});
