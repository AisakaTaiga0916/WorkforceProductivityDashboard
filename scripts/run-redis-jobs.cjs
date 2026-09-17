/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Standalone BullMQ worker process for local Next.js (`npm run dev`).
 *
 * Production / `start:cpanel` already starts workers inside server.js.
 * Plain `next dev` does not — run this alongside the app when Redis is up:
 *
 *   npm run jobs:redis
 *
 * Requires:
 * - Redis reachable (REDIS_URL or REDIS_HOST*)
 * - Next app listening on PORT
 * - INTERNAL_JOB_KEY in .env matching whatever the Next process uses
 *   (set it explicitly in .env for local dual-process setups)
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { startRedisJobs, stopRedisJobs } = require("./redis-jobs.cjs");

function applyProjectEnvFiles() {
  const mergeLine = (line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const eq = t.indexOf("=");
    if (eq <= 0) return;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  };
  const root = path.join(__dirname, "..");
  for (const name of [".env", ".env.local", ".env.development", ".env.production"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) mergeLine(line);
  }
}
applyProjectEnvFiles();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOSTNAME || "0.0.0.0";
const jobHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const keyFromEnv = process.env.INTERNAL_JOB_KEY?.trim();
const internalJobKey = keyFromEnv || crypto.randomBytes(32).toString("hex");
process.env.INTERNAL_JOB_KEY = internalJobKey;

async function main() {
  if (!keyFromEnv) {
    console.warn(
      "[jobs:redis] INTERNAL_JOB_KEY is not set in .env — generated an ephemeral key. " +
        "Job POSTs will 401 unless Next uses the same key. Add INTERNAL_JOB_KEY to .env.",
    );
  }

  const result = await startRedisJobs({ internalJobKey, jobHost, port });
  if (!result.started) {
    console.error(
      "[jobs:redis] Redis unreachable — start Redis (see docs/REDIS.md) then retry.",
    );
    process.exit(1);
  }

  console.log(
    `[jobs:redis] BullMQ workers targeting http://${jobHost}:${port} (Ctrl+C to stop)`,
  );

  const shutdown = async () => {
    await stopRedisJobs();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  console.error("[jobs:redis] failed", err);
  process.exit(1);
});
