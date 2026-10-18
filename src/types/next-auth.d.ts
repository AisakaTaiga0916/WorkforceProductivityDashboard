import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/modules/platform/auth";

declare module "next-auth" {
  interface Session {
    error?: "SessionExpired";
    /** Unix seconds; fixed at sign-in — used for immediate client-side expiry redirects. */
    sessionExpiresAt?: number;
    needsUsername?: boolean;
    user: DefaultSession["user"] & {
      id?: string;
      role: UserRole;
      /** OAuth / credentials provider id (e.g. google, credentials). */
      authProvider?: string | null;
      /** Customer portal: linked company (Team id). */
      companyId?: string | null;
      companyName?: string | null;
      /** Customer org role at signup: Head | Personnel (not staff Personnel). */
      customerOrgRole?: string | null;
      /** Canonical portal staff tier from PortalAccount: Head | Personnel | null for customers. */
      staffRoleLabel?: string | null;
      /** Portal account username. */
      username?: string | null;
    };
  }

  interface User {
    role?: UserRole;
    companyId?: string | null;
    companyName?: string | null;
    customerOrgRole?: string | null;
    staffRoleLabel?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    error?: "SessionExpired";
    /** Unix seconds; fixed at sign-in so refresh does not extend the session. */
    sessionExpiresAt?: number;
    role?: UserRole;
    authProvider?: string | null;
    companyId?: string | null;
    companyName?: string | null;
    customerOrgRole?: string | null;
    staffRoleLabel?: string | null;
    /** Portal account username. */
    username?: string | null;
    /** True when the user signed up via OAuth but hasn't set a username yet. */
    needsUsername?: boolean;
  }
}
