import { redisClient, redisReady } from "@/lib/redis";

/**
 * TTL cache with an in-memory L1 layer and a Redis L2 layer.
 *
 * - L1 (module Map): zero-latency reads for the current process.
 * - L2 (Redis `cache:` keys with PX TTL): shared across instances/restarts.
 *
 * Concurrent misses for the same key share one compute (no stampede).
 * Degrades gracefully: when Redis is unavailable the cache behaves as in-memory.
 *
 * Values must be JSON-serializable.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const KEY_PREFIX = "cache:";

export async function withTtlCache<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const run = (async () => {
    const redis = redisClient();
    if (redis) {
      try {
        const raw = await redis.get(KEY_PREFIX + key);
        if (raw != null) {
          const value = JSON.parse(raw) as T;
          store.set(key, { value, expiresAt: Date.now() + ttlMs });
          return value;
        }
      } catch {
        // Fall through to compute; the in-memory entry (if any) stays stale-safe.
      }
    }

    const value = await compute();
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    const writeClient = redisClient();
    if (writeClient) {
      try {
        await writeClient.set(KEY_PREFIX + key, JSON.stringify(value), "PX", ttlMs);
      } catch {
        // Best-effort write only.
      }
    } else {
      void redisReady()
        .then((r) => r?.set(KEY_PREFIX + key, JSON.stringify(value), "PX", ttlMs))
        .catch(() => {});
    }
    return value;
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    if (inflight.get(key) === run) inflight.delete(key);
  }
}

/** Drop a cached key from both layers (e.g. after a known mutation). */
export function invalidateTtlCache(key: string): void {
  store.delete(key);
  inflight.delete(key);
  const redis = redisClient();
  if (!redis) return;
  void redis.del(KEY_PREFIX + key).catch(() => {});
}
