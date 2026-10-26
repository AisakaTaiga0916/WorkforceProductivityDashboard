import { isElevatedUserRole } from "@/modules/platform/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isJwtSessionExpired, sanitizeCallbackUrl, signInUrlWithCallback } from "@/lib/session-expiry";

const SESSION_TIMEOUT_SIGNIN_URL = "/signin?reason=session-expired";

function isAllowed(role: string | undefined, allowed: string[]) {
  if (!role) return false;
  if (isElevatedUserRole(role) && allowed.includes("Admin")) return true;
  return allowed.includes(role);
}

function redirectSessionExpired(req: NextRequest) {
  return NextResponse.redirect(new URL(SESSION_TIMEOUT_SIGNIN_URL, req.url));
}

function redirectToSignIn(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const signInPath = signInUrlWithCallback(pathname, search);
  return NextResponse.redirect(new URL(signInPath, req.url));
}

function requireAuth(
  req: NextRequest,
  token: Awaited<ReturnType<typeof getToken>>,
  sessionInvalid: boolean,
) {
  if (sessionInvalid) return redirectSessionExpired(req);
  if (!token) return redirectToSignIn(req);
  return null;
}

export async function proxy(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => {
    return null;
  });
  const { pathname } = req.nextUrl;
  const sessionInvalid = isJwtSessionExpired(token);

  if (pathname.startsWith("/agent")) {
    const denied = requireAuth(req, token, sessionInvalid);
    if (denied) return denied;
    if (!isAllowed(token!.role as string | undefined, ["Admin", "Personnel"])) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/reports")) {
    if (pathname.startsWith("/admin/manual-assignment")) {
      const denied = requireAuth(req, token, sessionInvalid);
      if (denied) return denied;
      if (!isAllowed(token!.role as string | undefined, ["Admin"])) {
        return NextResponse.redirect(new URL("/", req.url));
      }
      return NextResponse.next();
    }
    if (pathname.startsWith("/admin/account")) {
      const denied = requireAuth(req, token, sessionInvalid);
      if (denied) return denied;
      if (!isAllowed(token!.role as string | undefined, ["Admin", "Personnel", "Customer"])) {
        return NextResponse.redirect(new URL("/", req.url));
      }
      return NextResponse.next();
    }
    const denied = requireAuth(req, token, sessionInvalid);
    if (denied) return denied;
    if (!isAllowed(token!.role as string | undefined, ["Admin"])) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (pathname.startsWith("/tickets/new") || pathname.startsWith("/tickets/")) {
    if (sessionInvalid) {
      return redirectSessionExpired(req);
    }
  }

  /** `/customer/signin` is a compatibility redirect to `/signin` (no session required). */
  const publicCustomerAuthPaths = ["/customer/signin", "/customer/signup"];
  if (pathname.startsWith("/customer/") && !publicCustomerAuthPaths.includes(pathname)) {
    const denied = requireAuth(req, token, sessionInvalid);
    if (denied) return denied;
    if (!isAllowed(token!.role as string | undefined, ["Customer"])) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (pathname.startsWith("/my-requests")) {
    const denied = requireAuth(req, token, sessionInvalid);
    if (denied) return denied;
    if (!isAllowed(token!.role as string | undefined, ["Admin", "Personnel", "SuperAdmin"])) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (pathname.startsWith("/travel-orders")) {
    const denied = requireAuth(req, token, sessionInvalid);
    if (denied) return denied;
    if (
      !isAllowed(token!.role as string | undefined, [
        "Admin",
        "Personnel",
        "Personnel-Guard",
      ])
    ) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (pathname.startsWith("/my-tickets")) {
    if (sessionInvalid) {
      return redirectSessionExpired(req);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/agent/:path*",
    "/admin/:path*",
    "/reports/:path*",
    "/tickets/new",
    "/tickets/:path*",
    "/my-tickets",
    "/my-tickets/:path*",
    "/my-requests/:path*",
    "/travel-orders",
    "/travel-orders/:path*",
    "/customer/:path*",
  ],
};
