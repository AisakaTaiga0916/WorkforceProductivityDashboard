/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Redis-backed background jobs (BullMQ).
 *
 * Replaces the setInterval-driven job runners in server.js when Redis is
 * available. server.js calls `startRedisJobs`; if Redis is down the function
 * returns `{ started: false }` and server.js keeps its timer fallback.
 *
 * Each queue runs a single Worker that POSTs to the same internal job API
 * routes the timers used (`x-internal-job-key` auth), so job logic stays in
 * the Next.js route handlers.
 */
const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const { resolveRedisUrl, redisConnectionOptions } = require("./redis-connection.cjs");

/** Mirror of server.js env loading: `.env` then `.env.production` (later wins). */
function loadEnvFiles() {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..");
  const mergeLine = (line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const eq = t.indexOf("=");
    if (eq <= 0) return;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  };
  for (const name of [".env", ".env.production"]) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) mergeLine(line);
  }
}
loadEnvFiles();

function connectionOptions() {
  return redisConnectionOptions();
}

const JOBS = [
  {
    queueName: "confirmation-reminders",
    jobName: "confirmation-reminders",
    repeatEveryMs: 15 * 60 * 1000,
    path: "/api/jobs/confirmation-reminders",
  },
  {
    queueName: "sync-hris-portal",
    jobName: "sync-hris-portal",
    repeatEveryMs: 30 * 60 * 1000,
    path: "/api/jobs/sync-hris-portal",
  },
  {
    queueName: "sync-portal-merged",
    jobName: "sync-portal-merged",
    repeatEveryMs: 30 * 60 * 1000,
    path: "/api/jobs/sync-portal-merged",
  },
];

let started = false;
let connection = null;
const queues = [];
const workers = [];

async function pingRedis() {
  let probe = null;
  try {
    probe = new IORedis(connectionOptions(), {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    if (probe) probe.disconnect();
  }
}

/**
 * @param {{ internalJobKey: string, jobHost: string, port: number }} opts
 * @returns {Promise<{ started: boolean }>}
 */
async function startRedisJobs({ internalJobKey, jobHost, port }) {
  if (started) return { started: true };
  const ok = await pingRedis();
  if (!ok) {
    console.warn("[redis-jobs] Redis unreachable — falling back to server.js timers");
    return { started: false };
  }

  connection = new IORedis(connectionOptions(), { maxRetriesPerRequest: null });

  try {
    for (const job of JOBS) {
      const queue = new Queue(job.queueName, {
        connection,
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });
      queues.push(queue);

      await queue.add(
        job.jobName,
        {},
        {
          repeat: { every: job.repeatEveryMs },
          jobId: job.jobName,
        },
      );
      // Delay the first run so the HTTP server can finish binding (esp. server.js boot).
      await queue.add(
        job.jobName,
        {},
        { jobId: `boot-${job.jobName}-${Date.now()}`, delay: 60_000 },
      );

      const worker = new Worker(
        job.queueName,
        async () => {
          const url = `http://${jobHost}:${port}${job.path}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "x-internal-job-key": internalJobKey },
          });
          if (!res.ok) {
            throw new Error(`${job.jobName} job failed with HTTP ${res.status}`);
          }
        },
        { connection, concurrency: 1 },
      );
      worker.on("failed", (job, err) => {
        console.warn(`[redis-jobs] ${job?.queueName ?? "unknown"} job failed`, err?.message || err);
      });
      workers.push(worker);
    }
  } catch (err) {
    console.warn(
      "[redis-jobs] BullMQ failed to start — need Redis ≥ 5 (6.2+ recommended).",
      err?.message || err,
    );
    await stopRedisJobs();
    return { started: false };
  }

  started = true;
  console.log(`[redis-jobs] started ${JOBS.length} BullMQ queues at ${resolveRedisUrl()}`);
  return { started: true };
}

async function stopRedisJobs() {
  for (const w of workers) {
    try {
      await w.close();
    } catch {
      // ignore shutdown errors
    }
  }
  workers.length = 0;
  for (const q of queues) {
    try {
      await q.close();
    } catch {
      // ignore shutdown errors
    }
  }
  queues.length = 0;
  if (connection) {
    try {
      connection.disconnect();
    } catch {
      // ignore
    }
    connection = null;
  }
  started = false;
}

module.exports = { startRedisJobs, stopRedisJobs };
