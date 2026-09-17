/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Shared Redis connection config for Node scripts and (via TS re-export) Next.js.
 *
 * Prefer REDIS_URL. Otherwise build from REDIS_HOST (+ PORT / PASSWORD / USERNAME / TLS).
 * Default: redis://127.0.0.1:6379
 */

/**
 * @returns {string}
 */
function resolveRedisUrl() {
  const fromUrl = process.env.REDIS_URL?.trim();
  if (fromUrl) return fromUrl;

  const host = process.env.REDIS_HOST?.trim();
  if (host) {
    const port = process.env.REDIS_PORT?.trim() || "6379";
    const password = process.env.REDIS_PASSWORD?.trim();
    const username = process.env.REDIS_USERNAME?.trim();
    const tls =
      process.env.REDIS_TLS === "1" ||
      process.env.REDIS_TLS === "true" ||
      process.env.REDIS_TLS === "yes";
    let auth = "";
    if (password) {
      auth = username
        ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
        : `:${encodeURIComponent(password)}@`;
    }
    return `${tls ? "rediss" : "redis"}://${auth}${host}:${port}`;
  }

  return "redis://127.0.0.1:6379";
}

/**
 * BullMQ / ioredis connection object derived from the resolved URL.
 * @returns {{ host: string, port: number, username?: string, password?: string, db: number, tls?: object }}
 */
function redisConnectionOptions() {
  const REDIS_URL = resolveRedisUrl();
  let u;
  try {
    u = new URL(REDIS_URL);
  } catch {
    return { host: "127.0.0.1", port: 6379, db: 0 };
  }
  return {
    host: u.hostname || "127.0.0.1",
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) || 0 : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
  };
}

module.exports = { resolveRedisUrl, redisConnectionOptions };
