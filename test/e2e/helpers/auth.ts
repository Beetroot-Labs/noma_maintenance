import type { BrowserContext, Page } from "@playwright/test";

import { dbOne } from "./db";

// Logs in via the backend's dev-login bypass. The backend issues a session cookie via
// Set-Cookie; we capture it from the response and inject it into the browser context so
// subsequent navigations are authenticated.
export const loginAs = async (
  page: Page,
  email: string,
): Promise<void> => {
  const userExists = await dbOne<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  if (!userExists) {
    throw new Error(`loginAs: no seeded user with email ${email}`);
  }

  const response = await page.request.get(
    `/api/auth/dev-login?email=${encodeURIComponent(email)}`,
  );
  if (response.status() !== 204) {
    throw new Error(
      `loginAs: /auth/dev-login returned ${response.status()} for ${email}`,
    );
  }

  // The cookie is set on the request context's cookie jar via the response;
  // `page.request` shares it with the page's network stack.
};

// Helper for asserting "no session" — clears cookies in the current context.
export const logout = async (context: BrowserContext): Promise<void> => {
  await context.clearCookies();
};
