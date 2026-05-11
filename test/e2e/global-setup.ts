import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

import { writeState } from "./runtime/state";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BACKEND_DIR = join(REPO_ROOT, "backend");
const MIGRATIONS_DIR = join(BACKEND_DIR, "migrations");
const FRONTEND_DIST = join(REPO_ROOT, "frontend", "apps", "main", "dist");
const BACKEND_BIN = join(BACKEND_DIR, "target", "debug", "noma_maintenance");

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3010);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

const runBlocking = (
  cmd: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) => {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${result.status}`);
  }
};

const applyMigrations = async (databaseUrl: string) => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`[e2e] applying migration ${file}`);
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
};

const waitForHealth = async (url: string, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health-check`);
      if (response.ok) return;
    } catch {
      // backend not up yet
    }
    await sleep(200);
  }
  throw new Error(`backend at ${url} did not become healthy within ${timeoutMs}ms`);
};

const spawnBackend = (databaseUrl: string): ChildProcess => {
  if (!existsSync(BACKEND_BIN)) {
    throw new Error(
      `backend binary missing at ${BACKEND_BIN} — run 'cargo build' under backend/ first`,
    );
  }
  if (!existsSync(join(FRONTEND_DIST, "index.html"))) {
    throw new Error(
      `frontend bundle missing at ${FRONTEND_DIST}/index.html — run 'npm run build:main' under frontend/ first`,
    );
  }

  const child = spawn(BACKEND_BIN, [], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      ENABLE_DEV_LOGIN: "true",
      SESSION_COOKIE_NAME: "noma_session",
      COOKIE_SECURE: "false",
      STORAGE_BACKEND: "mem",
      HOST: "127.0.0.1",
      PORT: String(BACKEND_PORT),
      STATIC_DIR: FRONTEND_DIST,
      RUST_LOG: process.env.E2E_BACKEND_LOG ?? "info",
    },
    stdio: process.env.E2E_BACKEND_VERBOSE ? "inherit" : "ignore",
  });
  child.unref();
  return child;
};

export default async () => {
  console.log("[e2e] booting postgres container");
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("noma_e2e")
    .start();
  const databaseUrl = container.getConnectionUri();

  console.log("[e2e] applying migrations");
  await applyMigrations(databaseUrl);

  console.log("[e2e] building backend (incremental)");
  runBlocking("cargo", ["build", "--bin", "noma_maintenance"], { cwd: BACKEND_DIR });

  console.log(`[e2e] spawning backend on ${BACKEND_URL}`);
  const backend = spawnBackend(databaseUrl);
  if (!backend.pid) {
    throw new Error("backend failed to spawn");
  }

  await waitForHealth(BACKEND_URL);
  console.log("[e2e] backend healthy");

  writeState({
    databaseUrl,
    backendUrl: BACKEND_URL,
    backendPid: backend.pid,
  });

  process.env.E2E_DATABASE_URL = databaseUrl;
  process.env.E2E_BACKEND_URL = BACKEND_URL;
};
