import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { dbQuery, withClient } from "./db";

export type SeededTenant = { id: string; name: string };

const PRESETS_DIR = join(import.meta.dirname, "..", "presets");

export const seedTenant = async (label = "tenant"): Promise<SeededTenant> => {
  const id = randomUUID();
  const name = `${label}-${id.slice(0, 8)}`;
  await dbQuery("INSERT INTO tenants (id, name) VALUES ($1, $2)", [id, name]);
  return { id, name };
};

// Apply a SQL preset substituting `:tenant_id` with the given tenant. Presets are
// composable building blocks; tests stack them as needed.
export const applyPreset = async (
  tenantId: string,
  presetName: string,
): Promise<void> => {
  const path = join(PRESETS_DIR, `${presetName}.sql`);
  const sql = readFileSync(path, "utf8").replace(/:tenant_id/g, `'${tenantId}'`);
  await withClient(async (client) => {
    await client.query(sql);
  });
};
