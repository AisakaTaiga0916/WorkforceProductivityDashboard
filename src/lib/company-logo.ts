import fs from "node:fs";
import path from "node:path";

/**
 * Primary local folder for Company Board logos (by roster name).
 * Prefer COMPANY_LOGOS_DIR, then the workstation folder, then repo public assets.
 */
export const LOCAL_COMPANY_LOGOS_DIR =
  process.env.COMPANY_LOGOS_DIR?.trim() ||
  "C:/Users/tk/Desktop/work/COMPANY LOGOS";

const REPO_COMPANY_LOGOS_DIR = path.join(process.cwd(), "public", "company-logos");

const DEFAULT_LOGO_DIRS = [
  LOCAL_COMPANY_LOGOS_DIR,
  REPO_COMPANY_LOGOS_DIR,
  "C:/Users/tk/Desktop/work/COMPANY LOGOS",
  "C:/xampp/htdocs/HR/backend/storage/app/public",
  "C:/xampp/htdocs/HR/backend/public/storage",
  "C:/xampp/htdocs/HR_GEO/backend/storage/app/public",
  "C:/xampp/htdocs/HR_GEO/backend/public/storage",
  "C:/xampp/htdocs/HRIS/backend/storage/app/public",
  "C:/xampp/htdocs/HRIS/backend/public/storage",
];

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Explicit roster / display name → filename overrides.
 * `lending.png` is ALI; `mchisi.png` covers LPG + FAMES.
 */
const COMPANY_LOGO_FILENAMES: Record<string, string> = {
  agc: "agc.png",
  aci: "aci.png",
  apmc: "apmc.png",
  awic: "awic.png",
  agoc: "agoc.png",
  eazzygas: "eazzygas.png",
  eazygaz: "eazzygas.png",
  easygas: "eazzygas.png",
  industries: "industries.png",
  ali: "lending.png",
  "amalgated lending": "lending.png",
  "amalgated lending inc.": "lending.png",
  "amalgated lending inc": "lending.png",
  mchisi: "mchisi.png",
  "mchisi lpg": "mchisi.png",
  "mchisi fames": "mchisi.png",
};

const IMAGE_EXTS = [".png", ".webp", ".jpg", ".jpeg", ".gif", ".svg"] as const;

function logoSearchDirs(): string[] {
  const fromEnv = (process.env.HRIS_COMPANY_LOGO_DIRS ?? "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const dirs = [...fromEnv, ...DEFAULT_LOGO_DIRS];
  return Array.from(new Set(dirs));
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function candidateFileNames(companyName: string): string[] {
  const key = normalizeCompanyKey(companyName);
  if (!key) return [];
  const names = new Set<string>();
  const mapped = COMPANY_LOGO_FILENAMES[key];
  if (mapped) names.add(mapped);

  const compact = key.replace(/\s+/g, "");
  const dashed = key.replace(/\s+/g, "-");
  const underscored = key.replace(/\s+/g, "_");
  for (const stem of [compact, dashed, underscored, key.split(" ")[0]]) {
    if (!stem) continue;
    for (const ext of IMAGE_EXTS) {
      names.add(`${stem}${ext}`);
    }
  }
  return Array.from(names);
}

function findExistingFile(fileName: string): string | null {
  for (const root of [
    LOCAL_COMPANY_LOGOS_DIR,
    REPO_COMPANY_LOGOS_DIR,
    ...logoSearchDirs(),
  ]) {
    const candidate = path.join(root, fileName);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Resolve a logo file from the local company-logos folder by company/team name. */
export function resolveCompanyLogoByName(companyName: string | null | undefined): string | null {
  for (const fileName of candidateFileNames(companyName ?? "")) {
    const hit = findExistingFile(fileName);
    if (hit) return hit;
  }
  return null;
}

export function companyHasLocalLogo(companyName: string | null | undefined): boolean {
  return resolveCompanyLogoByName(companyName) != null;
}

/** Resolve a relative HRIS logo path (e.g. company-logos/….png) to an absolute file. */
export function resolveCompanyLogoFile(relativePath: string | null | undefined): string | null {
  const rel = (relativePath ?? "").trim().replace(/^\/+/, "");
  if (!rel) return null;
  const fileName = path.basename(rel);
  const withoutPrefix = rel.replace(/^company-logos[\\/]/, "");
  for (const root of logoSearchDirs()) {
    for (const candidate of [
      path.join(root, rel),
      path.join(root, "company-logos", fileName),
      path.join(root, fileName),
      path.join(root, withoutPrefix),
    ]) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function readLogoAbsolute(file: string): { mime: string; bytes: Buffer } | null {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  try {
    return { mime, bytes: fs.readFileSync(file) };
  } catch {
    return null;
  }
}

export function readCompanyLogoFile(relativePath: string | null | undefined): {
  mime: string;
  bytes: Buffer;
} | null {
  const file = resolveCompanyLogoFile(relativePath);
  if (!file) return null;
  return readLogoAbsolute(file);
}

export function readCompanyLogoByName(companyName: string | null | undefined): {
  mime: string;
  bytes: Buffer;
} | null {
  const file = resolveCompanyLogoByName(companyName);
  if (!file) return null;
  return readLogoAbsolute(file);
}

const DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml));base64,([a-z0-9+/=\s]+)$/i;

export function parseCompanyLogoDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = dataUrl.trim().match(DATA_URL_RE);
  if (!match) return null;
  try {
    return { mime: match[1].toLowerCase(), bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

export { companyLogoApiPath } from "@/lib/company-logo-url";
