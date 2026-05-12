// Test users seeded by users_basic.sql have tenant-scoped emails so the same preset can
// be applied across many tenants in one suite run without colliding on the dev-login
// route's email lookup. This helper mirrors the construction so specs can resolve the
// email address they need without hard-coding it.

export type SeededRole = "admin" | "lead" | "tech1" | "tech2";

export const userEmail = (tenantId: string, role: SeededRole): string =>
  `${role}-${tenantId.slice(0, 8)}@e2e.local`;
