/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Next.js + Socket.IO custom server for local realtime chat development.
 * Use: npm run dev:realtime
 *
 * Plain `npm run dev` has no Socket.IO — chat falls back to HTTP polling.
 */
const path = require("path");
const fs = require("fs");

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

const http = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const IORedis = require("ioredis");
const { PrismaClient: PrimaryClient } = require("@prisma/client/primary");
const { attachRequestChatHandlers } = require("./socket-request-chat.cjs");
const { startRedisJobs, stopRedisJobs } = require("./redis-jobs.cjs");
const { resolveRedisUrl } = require("./redis-connection.cjs");
const crypto = require("crypto");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOSTNAME || "0.0.0.0";
const maxHeaderSize = Number(process.env.MAX_HTTP_HEADER_SIZE || "65536");

const app = next({
  dev: true,
  hostname: host === "0.0.0.0" ? "localhost" : host,
  port,
  webpack: true,
});
const handle = app.getRequestHandler();
const prisma = new PrimaryClient();

app
  .prepare()
  .then(async () => {
    const server = http.createServer({ maxHeaderSize }, (req, res) => {
      handle(req, res);
    });
    const io = new Server(server, {
      path: "/socket.io",
      cors: { origin: "*" },
    });

    let pubClient = null;
    let subClient = null;
    try {
      const redisUrl = resolveRedisUrl();
      pubClient = new IORedis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
      });
      subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      console.log("[dev:realtime] Socket.IO Redis adapter enabled");
    } catch (err) {
      console.warn(
        "[dev:realtime] Redis adapter unavailable — single-process sockets",
        err?.message || err,
      );
      try {
        pubClient?.disconnect();
        subClient?.disconnect();
      } catch {
        /* ignore */
      }
      pubClient = null;
      subClient = null;
    }

    const jobHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    attachRequestChatHandlers(io, prisma, { jobHost, port });

    const internalJobKey =
      process.env.INTERNAL_JOB_KEY?.trim() || crypto.randomBytes(32).toString("hex");
    process.env.INTERNAL_JOB_KEY = internalJobKey;

    const redisJobs = await startRedisJobs({
      internalJobKey,
      jobHost,
      port,
    });
    if (redisJobs.started) {
      console.log("[dev:realtime] BullMQ jobs enabled");
    } else {
      console.warn("[dev:realtime] BullMQ unavailable — background jobs idle until Redis is up");
    }

    server.listen(port, host, () => {
      console.log(`[dev:realtime] http://localhost:${port} (Next + Socket.IO)`);
    });

    const shutdown = async () => {
      if (redisJobs.started) await stopRedisJobs();
      try {
        pubClient?.disconnect();
        subClient?.disconnect();
      } catch {
        /* ignore */
      }
      await prisma.$disconnect();
      io.close();
      server.close(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  })
  .catch((err) => {
    console.error("[dev:realtime] failed to start", err);
    process.exit(1);
  });
