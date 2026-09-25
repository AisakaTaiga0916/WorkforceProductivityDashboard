/**
 * PostgreSQL backup for local production (PM2 / server-ctl).
 *
 * Dumps every configured Postgres URL (primary + auth). Uses pg_dump custom
 * format (-Fc). Does not stop the app. Secondary (MySQL) is not included.
 *
 * Usage:
 *   node scripts/db-backup.cjs
 *   node scripts/db-backup.cjs --dry-run
 *   node scripts/db-backup.cjs --list
 *
 * Restore (example):
 *   pg_restore -d "postgresql://user:pass@localhost:5432/dbname" --clean --if-exists backups/<file>.dump
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");
const {
  getMirrorMode,
  resolveMirrorDir,
  mirrorBackup,
  pruneMirrorBackups,
} = require("./db-backup-mirror.cjs");

const root = path.join(__dirname, "..");

function loadEnvFiles() {
  for (const name of [".env", ".env.production"]) {
    const envPath = path.join(root, name);
    if (!fs.existsSync(envPath)) continue;
    for (const lineRaw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

function parseDatabaseUrl(raw, label) {
  const url = new URL(raw.replace(/^postgresql:/i, "postgres:"));
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")).split("?")[0];
  if (!database) throw new Error(`${label} is missing database name.`);
  return {
    label,
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password || ""),
    host: url.hostname || "localhost",
    port: url.port || "5432",
    database,
  };
}

function collectPostgresTargets() {
  const candidates = [
    ["DATABASE_URL_PRIMARY", (process.env.DATABASE_URL_PRIMARY || "").trim()],
    ["DATABASE_URL", (process.env.DATABASE_URL || "").trim()],
    ["DATABASE_URL_AUTH", (process.env.DATABASE_URL_AUTH || "").trim()],
  ];

  const targets = [];
  const seen = new Set();

  for (const [label, raw] of candidates) {
    if (!raw) continue;
    if (!/^postgres(ql)?:/i.test(raw)) continue;
    const db = parseDatabaseUrl(raw, label);
    const key = `${db.host}:${db.port}/${db.database}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(db);
  }

  if (!targets.length) {
    throw new Error(
      "No PostgreSQL URLs found. Set DATABASE_URL_PRIMARY (or DATABASE_URL) and optionally DATABASE_URL_AUTH.",
    );
  }
  return targets;
}

function siteLabel() {
  const raw = (process.env.DB_BACKUP_SITE_LABEL || process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || "local")
    .trim()
    .replace(/\/+$/, "");
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/[^a-zA-Z0-9.-]+/g, "-");
  } catch {
    return raw.replace(/[^a-zA-Z0-9.-]+/g, "-") || "local";
  }
}

function resolvePgDump() {
  const configured = (process.env.PG_DUMP || process.env.PG_DUMP_PATH || "").trim();
  if (configured) {
    if (!fs.existsSync(configured)) throw new Error(`PG_DUMP not found: ${configured}`);
    return configured;
  }

  const fromPath = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["pg_dump"], {
    encoding: "utf8",
  });
  if (fromPath.status === 0) {
    const candidate = fromPath.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === "win32") {
    const roots = [
      "C:\\Program Files\\PostgreSQL",
      "C:\\Program Files (x86)\\PostgreSQL",
    ];
    let best = null;
    for (const base of roots) {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(base, entry.name, "bin", "pg_dump.exe");
        if (fs.existsSync(candidate)) best = candidate;
      }
    }
    if (best) return best;
  }

  throw new Error(
    "pg_dump not found. Install PostgreSQL client tools or set PG_DUMP to the full path (e.g. C:/Program Files/PostgreSQL/18/bin/pg_dump.exe).",
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".dump"))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, full, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneOldBackups(dir, retentionDays) {
  if (retentionDays <= 0) return [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const entry of listBackups(dir)) {
    if (entry.mtimeMs >= cutoff) continue;
    fs.unlinkSync(entry.full);
    removed.push(entry.name);
  }
  return removed;
}

async function maybeNotify({ ok, message, backupPaths, mirrorPaths, mirrorErrors, errorText }) {
  const to = (process.env.DB_BACKUP_NOTIFY_EMAIL || "").trim();
  if (!to) return;

  const host = (process.env.BREVO_SMTP_HOST || "smtp-relay.brevo.com").trim();
  const port = Number(process.env.BREVO_SMTP_PORT || "587");
  const user = (process.env.BREVO_SMTP_USER || "").trim();
  const pass = (process.env.BREVO_SMTP_PASS || "").trim();
  const fromEmail = (process.env.BREVO_FROM_EMAIL || "").trim();
  const fromName = (process.env.BREVO_FROM_NAME || "Service Desk").trim();
  if (!user || !pass || !fromEmail) {
    console.warn("DB_BACKUP_NOTIFY_EMAIL is set but Brevo SMTP is incomplete; skipping email.");
    return;
  }

  const site = siteLabel();
  const subject = ok
    ? `[${site}] Database backup succeeded`
    : `[${site}] Database backup FAILED`;

  const body = ok
    ? [
        `Site: ${site}`,
        ...(backupPaths || []).map((p) => `Backup file: ${p}`),
        ...(mirrorPaths || []).map((p) => `NAS mirror: ${p}`),
        ...(mirrorErrors || []).map((e) => `NAS mirror warning: ${e}`),
        message,
        "",
        "Restore with pg_restore (see scripts/db-backup.cjs header).",
      ]
        .filter(Boolean)
        .join("\n")
    : [message, "", errorText || "Unknown error."].join("\n");

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `${fromName} <${fromEmail}>`,
    to,
    subject,
    text: body,
  });
}

function backupFileName(db, date = new Date()) {
  const host = (db.host || "localhost").replace(/[^a-zA-Z0-9.-]+/g, "-") || "localhost";
  const name = String(db.database).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  // Format: localhost-db-name-YYYY-MM-DD.dump
  return `${host}-${name}-${yyyy}-${mm}-${dd}.dump`;
}

async function dumpOneDatabase({ db, backupDir, stamp, pgDump, dryRun }) {
  const fileName = backupFileName(db, stamp instanceof Date ? stamp : new Date());
  const outputPath = path.join(backupDir, fileName);

  if (dryRun) {
    console.log(`  [${db.label}] ${db.database} @ ${db.host}:${db.port}`);
    console.log(`    -> ${outputPath}`);
    return { outputPath, size: 0, dryRun: true };
  }

  const args = [
    "-h",
    db.host,
    "-p",
    db.port,
    "-U",
    db.user,
    "-d",
    db.database,
    "-Fc",
    "-f",
    outputPath,
    "--no-owner",
    "--no-acl",
  ];

  const result = spawnSync(pgDump, args, {
    env: { ...process.env, PGPASSWORD: db.password },
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(
      `[${db.label}] ${db.database}: ${detail || `pg_dump exited with code ${result.status ?? "unknown"}`}`,
    );
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`[${db.label}] Backup file was not created: ${outputPath}`);
  }

  return { outputPath, size: fs.statSync(outputPath).size, dryRun: false };
}

async function runBackup({ dryRun = false } = {}) {
  loadEnvFiles();

  const backupDir = path.resolve(root, (process.env.DB_BACKUP_DIR || "backups").trim());
  const mirrorMode = getMirrorMode();
  const mirrorDirRaw = (process.env.DB_BACKUP_MIRROR_DIR || "").trim();
  const mirrorDir = mirrorMode === "smb" ? resolveMirrorDir(mirrorDirRaw) : "";
  const webdavUrl = (process.env.DB_BACKUP_WEBDAV_URL || "").trim();
  const retentionDays = Number(process.env.DB_BACKUP_RETENTION_DAYS || "14");
  const targets = collectPostgresTargets();
  const pgDump = resolvePgDump();
  const stamp = new Date();

  if (dryRun) {
    console.log("Dry run only.");
    console.log("  pg_dump :", pgDump);
    console.log("  targets :", targets.length);
    for (const db of targets) {
      await dumpOneDatabase({ db, backupDir, stamp, pgDump, dryRun: true });
    }
    console.log("  mirror  :", mirrorMode === "webdav" ? webdavUrl || "(webdav not configured)" : mirrorDir || "(none)");
    console.log("  mode    :", mirrorMode || "(local only)");
    console.log("  retain  :", `${retentionDays} day(s)`);
    return { dryRun: true, targets };
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const created = [];
  const mirrored = [];
  const mirrorErrors = [];

  for (const db of targets) {
    const dump = await dumpOneDatabase({ db, backupDir, stamp, pgDump, dryRun: false });
    created.push(dump);

    if (mirrorMode) {
      const mirrorResult = await mirrorBackup(dump.outputPath);
      if (mirrorResult.mirrored) mirrored.push(mirrorResult.mirrored);
      if (mirrorResult.mirrorError) {
        mirrorErrors.push(`[${db.database}] ${mirrorResult.mirrorError}`);
        if ((process.env.DB_BACKUP_MIRROR_REQUIRED || "").trim() === "1") {
          throw new Error(`Local backup created but NAS mirror failed: ${mirrorResult.mirrorError}`);
        }
      }
    }
  }

  const removed = pruneOldBackups(backupDir, retentionDays);
  if (mirrorMode === "smb" && mirrorDir && !mirrorErrors.length) {
    pruneOldBackups(mirrorDir, retentionDays);
  }
  if (mirrorMode === "webdav" && !mirrorErrors.length) {
    try {
      const webdavRemoved = await pruneMirrorBackups(retentionDays);
      if (webdavRemoved?.length) removed.push(...webdavRemoved);
    } catch (error) {
      console.warn(`WebDAV prune skipped: ${error instanceof Error ? error.message : error}`);
    }
  }

  return {
    created,
    mirrored,
    mirrorErrors,
    removed,
    retentionDays,
    targets,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const listOnly = args.has("--list");

  loadEnvFiles();
  const backupDir = path.resolve(root, (process.env.DB_BACKUP_DIR || "backups").trim());

  if (listOnly) {
    const entries = listBackups(backupDir);
    if (!entries.length) {
      console.log(`No backups in ${backupDir}`);
      return;
    }
    for (const entry of entries) {
      console.log(`${entry.name}  ${formatBytes(entry.size)}  ${new Date(entry.mtimeMs).toISOString()}`);
    }
    return;
  }

  try {
    const result = await runBackup({ dryRun });
    if (result.dryRun) return;

    const lines = result.created.map(
      (c) => `Created ${c.outputPath} (${formatBytes(c.size)})`,
    );
    for (const line of lines) console.log(line);
    for (const m of result.mirrored) console.log(`Mirrored to ${m}`);
    for (const err of result.mirrorErrors) console.warn(`NAS mirror skipped: ${err}`);
    if (result.removed.length) {
      console.log(`Removed ${result.removed.length} backup(s) older than ${result.retentionDays} day(s).`);
    }

    const summary = `Backed up ${result.created.length} PostgreSQL database(s).\n${lines.join("\n")}`;
    await maybeNotify({
      ok: true,
      message: summary,
      backupPaths: result.created.map((c) => c.outputPath),
      mirrorPaths: result.mirrored,
      mirrorErrors: result.mirrorErrors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Database backup failed:", message);
    await maybeNotify({
      ok: false,
      message: "Database backup failed on local production server.",
      errorText: message,
    }).catch((notifyError) => {
      console.error("Could not send backup failure email:", notifyError.message || notifyError);
    });
    process.exit(1);
  }
}

main();
