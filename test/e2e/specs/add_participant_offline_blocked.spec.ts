// Journey: lead is on /shifts/current, goes offline, and the "Résztvevő hozzáadása"
// button is disabled. Catalog row covered: E14, with the note that the catalog describes
// both the button-disabled state (E11) and a toast that fires if the handler runs
// regardless. In the code, the handler's offline check is a defensive backstop — the
// button is disabled when navigator.onLine is false, so clicking it through normal user
// interaction does not surface the toast. Disabled-button is the observable contract.
//
// Plan §16 flags "verify SW behavior under setOffline" as an open caveat for the first
// offline test. If the service worker intercepted /api requests and kept the page in a
// pseudo-online state, the button would stay enabled. This spec passing without setting
// service-worker handling implies the PWA registration is not interfering with the
// offline signal in the e2e build — recorded here so the next offline spec doesn't need
// to re-verify.

import { expect, test } from "@playwright/test";

import { loginAs } from "../helpers/auth";
import { applyPreset, seedTenant } from "../helpers/tenant";
import { userEmail } from "../helpers/users";

test.describe("add participant blocked offline", () => {
  test("toggling context offline disables the Résztvevő hozzáadása button", async ({
    page,
    context,
  }) => {
    const tenant = await seedTenant("add-offline");
    await applyPreset(tenant.id, "users_basic");
    await applyPreset(tenant.id, "building_with_10_devices");
    await applyPreset(tenant.id, "active_shift_lead_only");

    await loginAs(page, userEmail(tenant.id, "lead"));
    await page.goto("/shifts/current");

    const addButton = page.getByRole("button", { name: "Résztvevő hozzáadása" });
    await expect(addButton).toBeEnabled();

    await context.setOffline(true);
    // The button's disabled prop is bound to !isOnline, which flips when navigator.onLine
    // changes (via the "online"/"offline" events that Playwright fires on setOffline).
    await expect(addButton).toBeDisabled();

    await context.setOffline(false);
    await expect(addButton).toBeEnabled();
  });
});
