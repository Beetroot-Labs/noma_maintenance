import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distSwPath = path.resolve(__dirname, "../dist/sw.js");
const placeholder = "__CACHE_VERSION__";

const readGitDescribe = () => {
  try {
    return execFileSync("git", ["describe", "--always", "--dirty"], {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
};

const raw = await readFile(distSwPath, "utf8");
const version =
  process.env.GITHUB_SHA?.trim() ||
  process.env.VITE_GIT_SHA?.trim() ||
  readGitDescribe() ||
  "dev";
const shortVersion = version.slice(0, 16);

if (!raw.includes(placeholder)) {
  console.warn("sw.js placeholder not found; cache version not replaced.");
  process.exit(0);
}

const next = raw.replaceAll(placeholder, shortVersion);
await writeFile(distSwPath, next);
console.log(`sw.js cache version set to ${shortVersion}`);
