# Redis + BullMQ

The app works without Redis (in-memory cache, rate-limit fail-open, timer jobs on `server.js`, single-process sockets). Start Redis when you want shared cache, Socket.IO across processes, and BullMQ background jobs.

## Env

Prefer one of:

```env
REDIS_URL="redis://127.0.0.1:6379"
```

or:

```env
REDIS_HOST="127.0.0.1"
# REDIS_PORT="6379"
# REDIS_PASSWORD=""
# REDIS_USERNAME=""
# REDIS_TLS="false"
```

For standalone workers beside `npm run dev`, also set a shared secret:

```env
INTERNAL_JOB_KEY="a-long-random-string"
```

## Which npm script uses what

| Script | Socket.IO | Redis adapter | BullMQ jobs |
|---|---|---|---|
| `npm run dev` | No (HTTP poll fallback) | Cache/rate-limit only if Redis up | No — run `npm run jobs:redis` in a second terminal |
| `npm run dev:realtime` | Yes | Yes when Redis up | Yes when Redis up |
| `npm run jobs:redis` | — | — | Workers only (needs Next on `PORT`) |
| `npm run start:cpanel` / PM2 (`server.js`) | Yes | Yes when Redis up | Yes when Redis up; else `setInterval` fallback |
| `npm start` (`next start`) | No | Cache/rate-limit only | No — use `start:cpanel` for jobs |

## Local Redis (Windows)

BullMQ needs **Redis ≥ 6.2** (warnings appear on older builds). Do **not** use the old `Redis.Redis` winget package (3.0.504).

### Recommended: portable Redis 7 (no Docker)

1. Download [Redis-7.2.6-Windows-x64-msys2.zip](https://github.com/redis-windows/redis-windows/releases/download/7.2.6/Redis-7.2.6-Windows-x64-msys2.zip)
2. Unzip into `%LOCALAPPDATA%\redis-win` so `redis-server.exe` sits directly in that folder (replace any old 5.x files)
3. Start it:

```powershell
npm run redis:local
# should report version 7.2.6
```

### Alternatives

- **Memurai Developer** (native Windows service, Redis 7 API): `winget install Memurai.MemuraiDeveloper` (may need elevation). `npm run redis:local` will pick up `C:\Program Files\Memurai\memurai.exe` if present.
- **Docker**: `docker run -d --name ticketing-redis -p 6379:6379 redis:7-alpine`
- **WSL2**: install Redis inside the distro and point `REDIS_URL` at it

Verify:

```powershell
npm run redis:local
# should report 7.2.x (or Memurai / Docker 7.x) — not 5.0.14.1
npm run jobs:redis
```

You should see `[redis-jobs] started 3 BullMQ queues …` **without** the “minimum Redis version of 6.2.0” warning. Use the same `INTERNAL_JOB_KEY` in `.env` for both Next and the worker process.

## BullMQ queues

Defined in `scripts/redis-jobs.cjs`. Each worker POSTs the matching internal job route with `x-internal-job-key`:

| Queue | Interval | Route |
|---|---|---|
| `confirmation-reminders` | 15m | `POST /api/jobs/confirmation-reminders` |
| `sync-hris-portal` | 30m | `POST /api/jobs/sync-hris-portal` |
| `sync-portal-merged` | 30m | `POST /api/jobs/sync-portal-merged` |

## Chat / Socket.IO

Socket.IO in `server.js` / `dev:realtime` uses `@socket.io/redis-adapter` when Redis is reachable so `request:{ticketId}` rooms work across instances.

Next.js chat API routes publish with `@socket.io/redis-emitter` (`src/lib/request-chat-emit.ts`).

If Redis is down:

- Chat still works on a single Node process
- The chat panel polls every ~12s as a fallback (also covers `next dev` without a custom server)

Live Socket.IO requires `server.js` / `npm run start:cpanel` or `npm run dev:realtime`.
