/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Start a local Redis ≥ 6.2 process for BullMQ (Windows portable build).
 *
 * Default install path (after docs/REDIS.md download):
 *   %LOCALAPPDATA%\redis-win\redis-server.exe
 * Prefer Redis 7.2+ from redis-windows; Redis 5.x triggers BullMQ warnings.
 *
 * Usage: npm run redis:local
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");
const IORedis = require("ioredis");
const { resolveRedisUrl } = require("./redis-connection.cjs");

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
  for (const name of [".env", ".env.local", ".env.development"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) mergeLine(line);
  }
}
applyProjectEnvFiles();

const candidates = [
  path.join(process.env.LOCALAPPDATA || "", "redis-win", "redis-server.exe"),
  path.join("C:", "Program Files", "Memurai", "memurai.exe"),
  path.join("C:", "Program Files", "Redis", "redis-server.exe"),
].filter(Boolean);

function alreadyListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function pingRedis() {
  const url = resolveRedisUrl();
  let client = null;
  try {
    client = new IORedis(url, {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await client.connect();
    const pong = await client.ping();
    const info = await client.info("server");
    const ver = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? "?";
    return { ok: pong === "PONG", version: ver };
  } catch {
    return { ok: false, version: null };
  } finally {
    client?.disconnect();
  }
}

function warnIfOld(version) {
  const major = Number(String(version || "").split(".")[0]);
  const minor = Number(String(version || "").split(".")[1] || 0);
  if (!Number.isFinite(major)) return;
  if (major > 6 || (major === 6 && minor >= 2)) return;
  console.warn(
    `[redis:local] Redis ${version} is below BullMQ’s recommended 6.2+.\n` +
      `  Prefer portable Redis 7.2: see docs/REDIS.md\n` +
      `  (unzip into %LOCALAPPDATA%\\redis-win and restart npm run redis:local)`,
  );
}

async function main() {
  const existing = await pingRedis();
  if (existing.ok) {
    console.log(`[redis:local] already running (version ${existing.version}) at ${resolveRedisUrl()}`);
    warnIfOld(existing.version);
    return;
  }

  const bin = candidates.find((p) => fs.existsSync(p));
  if (!bin) {
    console.error(
      "[redis:local] No redis-server found. Install Redis ≥ 6.2 (see docs/REDIS.md),\n" +
        `  e.g. unzip Redis-7.2.6-Windows-x64-msys2.zip into ${path.join(process.env.LOCALAPPDATA || "%LOCALAPPDATA%", "redis-win")}`,
    );
    process.exit(1);
  }

  const port = 6379;
  if (await alreadyListening(port)) {
    console.warn(`[redis:local] port ${port} is open but Redis ping failed — check the process on that port`);
  }

  console.log(`[redis:local] starting ${bin}`);
  const child = spawn(bin, ["--port", String(port)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const check = await pingRedis();
    if (check.ok) {
      console.log(`[redis:local] ready (version ${check.version}) at ${resolveRedisUrl()}`);
      warnIfOld(check.version);
      return;
    }
  }
  console.error("[redis:local] started process but ping never succeeded");
  process.exit(1);
}

main().catch((err) => {
  console.error("[redis:local] failed", err);
  process.exit(1);
});
