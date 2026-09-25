/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

/**
 * Load `.env` then `.env.production` from this directory (later wins).
 * Ensures values next to `server.js` apply on every start even when PM2 or the
 * shell still carries an older `GOOGLE_CLIENT_*` / `NEXTAUTH_*` from a prior run.
 */
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
  for (const name of [".env", ".env.production"]) {
    const p = path.join(__dirname, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      mergeLine(line);
    }
  }
}

applyProjectEnvFiles();

const http = require("http");
const crypto = require("crypto");
const next = require("next");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const IORedis = require("ioredis");
const { PrismaClient: PrimaryClient } = require("@prisma/client/primary");
const { PrismaClient: AuthClient } = require("@prisma/client/auth");
const { startRedisJobs, stopRedisJobs } = require("./scripts/redis-jobs.cjs");
const { resolveRedisUrl } = require("./scripts/redis-connection.cjs");
const { attachRequestChatHandlers } = require("./scripts/socket-request-chat.cjs");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOSTNAME || "0.0.0.0";
/** Default Node limit is 16KB; large NextAuth cookie stacks can trigger HTTP 431. */
const maxHeaderSize = Number(process.env.MAX_HTTP_HEADER_SIZE || "65536");

const app = next({
  dev: false,
  hostname: host,
  port,
});

const handle = app.getRequestHandler();
const prisma = new PrimaryClient();
const prismaAuth = new AuthClient();
const internalJobKey = process.env.INTERNAL_JOB_KEY || crypto.randomBytes(32).toString("hex");
process.env.INTERNAL_JOB_KEY = internalJobKey;

let signature = "";
async function emitRealtimeSnapshot(io) {
  const [ticketMax, taskMax, kpiMax] = await Promise.all([
    prisma.ticket.aggregate({ _max: { updatedAt: true } }),
    prisma.taskItem.aggregate({ _max: { updatedAt: true } }),
    prisma.kpiMaintenance.aggregate({ _max: { updatedAt: true } }),
  ]);
  const nextSig = [
    ticketMax._max.updatedAt?.toISOString() ?? "",
    taskMax._max.updatedAt?.toISOString() ?? "",
    kpiMax._max.updatedAt?.toISOString() ?? "",
  ].join("|");
  if (nextSig === signature) return;
  signature = nextSig;
  io.emit("lifecycle:update", {
    ticketUpdatedAt: ticketMax._max.updatedAt?.toISOString() ?? null,
    taskUpdatedAt: taskMax._max.updatedAt?.toISOString() ?? null,
    kpiUpdatedAt: kpiMax._max.updatedAt?.toISOString() ?? null,
    emittedAt: new Date().toISOString(),
  });
}

let hrisSyncJobRunning = false;
async function runHrisSyncJob() {
  if (hrisSyncJobRunning) return;
  hrisSyncJobRunning = true;
  try {
    const jobHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const res = await fetch(`http://${jobHost}:${port}/api/jobs/sync-hris-portal`, {
      method: "POST",
      headers: { "x-internal-job-key": internalJobKey },
    });
    if (!res.ok) {
      console.warn(`HRIS sync job failed with HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("HRIS sync job failed", err);
  } finally {
    hrisSyncJobRunning = false;
  }
}

let portalMergedSyncJobRunning = false;
/** Sync task progress + KPI from primary ticketing_system_v3 into mergedatabase users. */
async function runPortalMergedSyncJob() {
  if (portalMergedSyncJobRunning) return;
  portalMergedSyncJobRunning = true;
  try {
    const jobHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const res = await fetch(`http://${jobHost}:${port}/api/jobs/sync-portal-merged`, {
      method: "POST",
      headers: { "x-internal-job-key": internalJobKey },
    });
    if (!res.ok) {
      console.warn(`Portal→merged work sync job failed with HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("Portal→merged work sync job failed", err);
  } finally {
    portalMergedSyncJobRunning = false;
  }
}

let confirmationReminderJobRunning = false;
async function runConfirmationReminderJob() {
  if (confirmationReminderJobRunning) return;
  confirmationReminderJobRunning = true;
  try {
    const jobHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const res = await fetch(`http://${jobHost}:${port}/api/jobs/confirmation-reminders`, {
      method: "POST",
      headers: { "x-internal-job-key": internalJobKey },
    });
    if (!res.ok) {
      console.warn(`Confirmation reminder job failed with HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("Confirmation reminder job failed", err);
  } finally {
    confirmationReminderJobRunning = false;
  }
}

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

    // Redis adapter for multi-instance PM2 (optional — falls back to in-process).
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
      console.log("[socket.io] Redis adapter enabled");
    } catch (err) {
      console.warn("[socket.io] Redis adapter unavailable — single-process mode", err?.message || err);
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

    const timer = setInterval(() => {
      void emitRealtimeSnapshot(io);
    }, 3000);

    // Prefer BullMQ (Redis) for background jobs; keep timer fallback if Redis is down.
    const redisJobs = await startRedisJobs({
      internalJobKey,
      jobHost,
      port,
    });
    const useRedisJobs = redisJobs.started;

    let confirmationReminderTimer = null;
    let hrisSyncTimer = null;
    let portalMergedSyncTimer = null;
    const bootTimeouts = [];
    if (!useRedisJobs) {
      confirmationReminderTimer = setInterval(() => {
        void runConfirmationReminderJob();
      }, 15 * 60 * 1000);
      hrisSyncTimer = setInterval(() => {
        void runHrisSyncJob();
      }, 15 * 60 * 1000);
      portalMergedSyncTimer = setInterval(() => {
        void runPortalMergedSyncJob();
      }, 30 * 60 * 1000);
      server.listen(port, host, () => {
        console.log(`Ticket System listening on http://${host}:${port} (timer jobs)`);
        bootTimeouts.push(setTimeout(() => void runConfirmationReminderJob(), 60 * 1000));
        bootTimeouts.push(setTimeout(() => void runHrisSyncJob(), 120 * 1000));
        // Offset from the HRIS job so the two syncs do not overlap at startup.
        bootTimeouts.push(setTimeout(() => void runPortalMergedSyncJob(), 5 * 60 * 1000));
      });
    } else {
      server.listen(port, host, () => {
        console.log(`Ticket System listening on http://${host}:${port} (Redis jobs)`);
      });
    }

    const shutdown = async () => {
      clearInterval(timer);
      if (confirmationReminderTimer) clearInterval(confirmationReminderTimer);
      if (hrisSyncTimer) clearInterval(hrisSyncTimer);
      if (portalMergedSyncTimer) clearInterval(portalMergedSyncTimer);
      for (const t of bootTimeouts) clearTimeout(t);
      if (useRedisJobs) await stopRedisJobs();
      try {
        pubClient?.disconnect();
        subClient?.disconnect();
      } catch {
        /* ignore */
      }
      await prisma.$disconnect();
      await prismaAuth.$disconnect();
      io.close();
      server.close(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  })
  .catch((err) => {
    console.error("Failed to start Next.js server", err);
    process.exit(1);
  });
