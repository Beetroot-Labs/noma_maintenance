import { readState, clearState } from "./runtime/state";

export default async () => {
  const state = readState();
  if (!state) return;

  try {
    process.kill(state.backendPid, "SIGTERM");
  } catch {
    // already dead — fine.
  }

  clearState();
  // Postgres container is reaped by Ryuk on Node process exit; no explicit stop needed.
};
