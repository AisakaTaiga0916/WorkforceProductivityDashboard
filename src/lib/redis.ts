import IORedis from "ioredis";
import { resolveRedisUrl } from "@/lib/redis-connection";

/**
 * Shared Redis client.
 *
 * Prefer `REDIS_URL`, otherwise `REDIS_HOST` (+ PORT / PASSWORD / USERNAME / TLS),
 * falling back to `redis://127.0.0.1:6379`.
 *
 * The app must keep working when Redis is down: every consumer guards calls
 * with `redisClient()` and degrades gracefully (in-memory cache fallback,
 * rate limiting fails open, BullMQ jobs fall back to server.js timers).
 *
 * The connection is started lazily on first use (never at import time) so
 * builds and tests are not held up when Redis is absent.
 */

let client: IORedis | null = null;
let available = false;
let warned = false;
let startAttempted = false;
let connectPromise: Promise<void> | null = null;

function createClient(): IORedis {
  const c = new IORedis(resolveRedisUrl(), {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    retryStrategy(times) {
      // Give up after ~8 attempts so a dead Redis does not spam reconnect
      // logs or pin the event loop. The app falls back; a process restart
      // (or later call) tries again.
      if (times > 8) return null;
      return Math.min(500 * 2 ** times, 10_000);
    },
  });
  c.on("connect", () => {
    available = true;
  });
  c.on("error", () => {
    available = false;
    if (!warned) {
      warned = true;
      console.warn(`[redis] unreachable at ${resolveRedisUrl()} — using fallbacks (cache, rate limit, jobs)`);
    }
  });
  c.on("close", () => {
    available = false;
  });
  c.on("end", () => {
    available = false;
  });
  return c;
}

function ensureClient(): void {
  if (client || startAttempted) return;
  startAttempted = true;
  try {
    client = createClient();
    connectPromise = client
      .connect()
      .then(() => {})
      .catch(() => {
        available = false;
      });
  } catch {
    client = null;
    connectPromise = null;
  }
}

/** Redis client when connected, otherwise null (callers must handle null). */
export function redisClient(): IORedis | null {
  ensureClient();
  return available ? client : null;
}

/**
 * Waits briefly for the initial connection (first call after boot kicks it).
 * Used where failing open on the very first request is undesirable
 * (rate limiting). Falls back to null after `timeoutMs` when Redis is down.
 */
export async function redisReady(timeoutMs = 2_500): Promise<IORedis | null> {
  ensureClient();
  if (available) return client;
  if (!connectPromise) return null;
  try {
    await Promise.race([
      connectPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // fall through
  }
  return available ? client : null;
}

export function isRedisAvailable(): boolean {
  ensureClient();
  return available;
}

/** Best-effort re-check used at boot (BullMQ wiring) — pings and disconnects. */
export async function pingRedis(): Promise<boolean> {
  let probe: IORedis | null = null;
  try {
    probe = new IORedis(resolveRedisUrl(), {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe?.disconnect();
  }
}
