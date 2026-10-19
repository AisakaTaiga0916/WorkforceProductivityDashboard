import { NextResponse } from "next/server";
import { isActiveCompanyId } from "@/modules/platform/companies/company-directory";
import {
  OAUTH_SIGNUP_INTENT_COOKIE,
  signOAuthSignupIntent,
  validateOAuthSignupInput,
} from "@/modules/platform/auth/oauth-signup-intent";
import {
  createPortalAccount,
  findPortalByEmailOnly,
  findPortalByUsername,
  isSignupRole,
} from "@/lib/portal-account";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const INTENT_MAX_AGE = 15 * 60;

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validUsername(username: string) {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(username);
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const lim = await rateLimit({ key: `signup:${ip}`, limit: 5, windowSeconds: 15 * 60 });
    if (!lim.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts. Try again in a few minutes." },
        { status: 429 },
      );
    }

    const body = (await req.json()) as {
      mode?: string;
      name?: string;
      username?: string;
      email?: string;
      password?: string;
      role?: string;
      companyId?: string;
      customerOrgRole?: string;
    };

    const mode = body.mode === "google" ? "google" : "password";

    if (mode === "google") {
      const orgRaw = body.customerOrgRole?.trim() ?? "Personnel";
      const customerOrgRole = orgRaw === "Head" ? "Admin" : orgRaw;

      const validation = await validateOAuthSignupInput({
        username: body.username ?? "",
        name: body.name ?? "",
        email: body.email ?? "",
        companyId: body.companyId ?? "",
        customerOrgRole,
      });
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: validation.status });
      }

      const username = body.username!.trim().toLowerCase();
      const name = body.name!.trim();
      const email = body.email!.trim().toLowerCase();
      const companyId = body.companyId!.trim();
      const role =
        customerOrgRole === "Admin" || customerOrgRole === "Personnel"
          ? customerOrgRole
          : "Personnel";

      const token = signOAuthSignupIntent({
        email,
        username,
        name,
        companyId,
        customerOrgRole: role,
      });

      const res = NextResponse.json({ ok: true, mode: "google" });
      res.cookies.set(OAUTH_SIGNUP_INTENT_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: INTENT_MAX_AGE,
        path: "/",
      });
      return res;
    }

    const name = body.name?.trim() ?? "";
    const username = body.username?.trim().toLowerCase() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    const roleRaw = body.role?.toString().trim() ?? "Customer";
    const normalizedRole = roleRaw.toLowerCase() === "agent" ? "Personnel" : roleRaw;

    if (!isSignupRole(normalizedRole)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    const role = normalizedRole;

    if (name.length < 2) {
      return NextResponse.json({ error: "Please enter a display name." }, { status: 400 });
    }
    if (!validUsername(username)) {
      return NextResponse.json(
        { error: "Username must be 3–32 characters (letters, numbers, . _ -)." },
        { status: 400 },
      );
    }
    if (!validEmail(email)) {
      return NextResponse.json({ error: "Enter a valid work email." }, { status: 400 });
    }
    if (password.length === 0) {
      return NextResponse.json({ error: "Enter a password." }, { status: 400 });
    }

    const [byEmail, byUser] = await Promise.all([
      findPortalByEmailOnly(email),
      findPortalByUsername(username),
    ]);
    if (byEmail) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    if (byUser) {
      return NextResponse.json({ error: "This username is already taken." }, { status: 409 });
    }

    let companyId: string | null = null;
    let customerOrgRole: string | null = null;
    if (role === "Customer") {
      const cid = body.companyId?.trim() ?? "";
      const orgRoleRaw = body.customerOrgRole?.trim() ?? "";
      const normalizedOrgRole = orgRoleRaw === "Head" ? "Admin" : orgRoleRaw;
      if (!cid || !["Admin", "Personnel"].includes(normalizedOrgRole)) {
        return NextResponse.json(
          { error: "Choose your company and org role (Admin or Personnel)." },
          { status: 400 },
        );
      }
      if (!(await isActiveCompanyId(cid))) {
        return NextResponse.json({ error: "Invalid company selection." }, { status: 400 });
      }
      companyId = cid;
      customerOrgRole = normalizedOrgRole;
    }

    const result = await createPortalAccount({
      username,
      email,
      name,
      password,
      role,
      companyId,
      customerOrgRole,
    });
    if (!result.ok) {
      if (result.code === "DUPLICATE") {
        return NextResponse.json(
          { error: "Username or email is already registered." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Could not create account." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, mode: "password" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not create account." }, { status: 500 });
  }
}
