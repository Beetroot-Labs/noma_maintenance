import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distSwPath = path.resolve(__dirname, "../dist/sw.js");
const placeholder = "__CACHE_VERSION__";

const raw = await readFile(distSwPath, "utf8");
const sha = process.env.GITHUB_SHA || process.env.VITE_GIT_SHA || "dev";
const shortSha = sha.slice(0, 8);

if (!raw.includes(placeholder)) {
  console.warn("sw.js placeholder not found; cache version not replaced.");
  process.exit(0);
}

const next = raw.replaceAll(placeholder, shortSha);
await writeFile(distSwPath, next);
console.log(`sw.js cache version set to ${shortSha}`);
