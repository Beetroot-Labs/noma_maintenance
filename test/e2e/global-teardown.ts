import { readState, clearState } from "./runtime/state";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export default async () => {
  const state = readState();
  if (!state) return;

  try {
    process.kill(state.backendPid, "SIGTERM");
  } catch {
    // already dead — fine.
  }

  // Give the backend up to 2s to exit gracefully, then SIGKILL. Without this, a stuck
  // backend would silently linger on the port and the next run would mis-connect to it.
  for (let i = 0; i < 10 && isAlive(state.backendPid); i++) {
    await sleep(200);
  }
  if (isAlive(state.backendPid)) {
    try {
      process.kill(state.backendPid, "SIGKILL");
    } catch {
      // race — already gone
    }
  }

  clearState();
  // Postgres container is reaped by Ryuk on Node process exit; no explicit stop needed.
};
