// Runtime state shared between global-setup and global-teardown. Both run in the
// Playwright main process, so a module-level singleton works.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".runtime-state.json",
);

export type RuntimeState = {
  databaseUrl: string;
  backendUrl: string;
  backendPid: number;
};

export const writeState = (state: RuntimeState) => {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

export const readState = (): RuntimeState | null => {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as RuntimeState;
};

export const clearState = () => {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
};
