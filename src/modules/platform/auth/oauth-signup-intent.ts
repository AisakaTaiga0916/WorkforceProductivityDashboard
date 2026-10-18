import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { COMPANY_ROSTER } from "@/lib/company-roster";
import { findPortalByEmailOnly, findPortalByUsername } from "@/lib/portal-account";
import { prisma } from "@/modules/platform/db/prisma";

export const OAUTH_SIGNUP_INTENT_COOKIE = "oauth_signup_intent";
const INTENT_TTL_SECONDS = 15 * 60;

export type OAuthSignupIntent = {
  email: string;
  username: string;
  name: string;
  companyId: string;
  customerOrgRole: "Admin" | "Personnel";
  exp: number;
};

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET?.trim();
  if (!s) throw new Error("NEXTAUTH_SECRET is required for signup intent signing.");
  return s;
}

export function signOAuthSignupIntent(
  payload: Omit<OAuthSignupIntent, "exp">,
): string {
  const data: OAuthSignupIntent = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + INTENT_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthSignupIntent(token: string): OAuthSignupIntent | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthSignupIntent;
    if (
      !parsed.email ||
      !parsed.username ||
      !parsed.name ||
      !parsed.companyId ||
      (parsed.customerOrgRole !== "Admin" && parsed.customerOrgRole !== "Personnel")
    ) {
      return null;
    }
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function readOAuthSignupIntentFromCookies(): Promise<OAuthSignupIntent | null> {
  const jar = await cookies();
  const raw = jar.get(OAUTH_SIGNUP_INTENT_COOKIE)?.value;
  if (!raw) return null;
  return verifyOAuthSignupIntent(raw);
}

export async function clearOAuthSignupIntentCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(OAUTH_SIGNUP_INTENT_COOKIE);
}

/** Apply pending signup profile after Google OAuth (new customers only). */
export async function applyOAuthSignupIntent(email: string, portalId: string): Promise<void> {
  const intent = await readOAuthSignupIntentFromCookies();
  if (!intent) return;

  const normalizedEmail = email.trim().toLowerCase();
  if (intent.email.trim().toLowerCase() !== normalizedEmail) {
    await clearOAuthSignupIntentCookie();
    return;
  }

  const portal = await prisma.portalAccount.findUnique({
    where: { id: portalId },
    select: {
      id: true,
      username: true,
      companyId: true,
      role: true,
      createdAt: true,
    },
  });
  if (!portal) {
    await clearOAuthSignupIntentCookie();
    return;
  }

  // Do not overwrite established accounts (staff or customers with company already set).
  if (portal.username || portal.companyId || portal.role !== "Customer") {
    await clearOAuthSignupIntentCookie();
    return;
  }

  const team = await prisma.team.findUnique({
    where: { id: intent.companyId },
    select: { name: true },
  });
  if (!team || !(COMPANY_ROSTER as readonly string[]).includes(team.name)) {
    await clearOAuthSignupIntentCookie();
    return;
  }

  const taken = await findPortalByUsername(intent.username);
  if (taken && taken.id !== portal.id) {
    await clearOAuthSignupIntentCookie();
    return;
  }

  await prisma.portalAccount.update({
    where: { id: portal.id },
    data: {
      username: intent.username.trim().toLowerCase(),
      name: intent.name.trim(),
      companyId: intent.companyId,
      customerOrgRole: intent.customerOrgRole,
      role: "Customer",
    },
  });

  await clearOAuthSignupIntentCookie();
}

export async function validateOAuthSignupInput(input: {
  username: string;
  name: string;
  email: string;
  companyId: string;
  customerOrgRole: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const username = input.username.trim().toLowerCase();
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const companyId = input.companyId.trim();
  const orgRaw = input.customerOrgRole.trim();
  const customerOrgRole = orgRaw === "Head" ? "Admin" : orgRaw;

  if (name.length < 2) {
    return { ok: false, error: "Please enter a display name.", status: 400 };
  }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return {
      ok: false,
      error: "Username must be 3–32 characters (letters, numbers, . _ -).",
      status: 400,
    };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid work email.", status: 400 };
  }
  if (!companyId) {
    return { ok: false, error: "Select the company you belong to.", status: 400 };
  }
  if (customerOrgRole !== "Admin" && customerOrgRole !== "Personnel") {
    return { ok: false, error: "Choose your org role (Admin or Personnel).", status: 400 };
  }

  const team = await prisma.team.findUnique({ where: { id: companyId }, select: { name: true } });
  if (!team || !(COMPANY_ROSTER as readonly string[]).includes(team.name)) {
    return { ok: false, error: "Invalid company selection.", status: 400 };
  }

  const [byEmail, byUser] = await Promise.all([
    findPortalByEmailOnly(email),
    findPortalByUsername(username),
  ]);
  if (byEmail) {
    return {
      ok: false,
      error: "An account with this email already exists. Sign in instead.",
      status: 409,
    };
  }
  if (byUser) {
    return { ok: false, error: "This username is already taken.", status: 409 };
  }

  return { ok: true };
}
