import { findPortalByEmailOnly } from "@/lib/portal-account";

export const GOOGLE_AUTH_PROVIDER = "google";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidWorkEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length > 3 && SIMPLE_EMAIL.test(v);
}

export class IntakeContactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeContactError";
  }
}

/**
 * contactEmail = portal/session identity for ownership.
 * requestorEmail = inbox for resolution / verification SMTP (Google OAuth email, or portal work email).
 */
export async function resolveTicketContactFields(params: {
  sessionEmail: string;
  authProvider: string | null | undefined;
  bodyRequestorEmail?: string | null;
}): Promise<{ contactEmail: string; requestorEmail: string }> {
  const accountEmail = params.sessionEmail.trim().toLowerCase();
  if (!accountEmail) {
    throw new IntakeContactError("Signed-in account email is required.");
  }

  const ap = (params.authProvider ?? "").trim().toLowerCase();

  if (ap === GOOGLE_AUTH_PROVIDER) {
    return { contactEmail: accountEmail, requestorEmail: accountEmail };
  }

  const portal = await findPortalByEmailOnly(accountEmail);
  if (portal?.email) {
    const work = portal.email.trim().toLowerCase();
    const fromBody = (params.bodyRequestorEmail ?? "").trim().toLowerCase();
    if (fromBody && isValidWorkEmail(fromBody) && fromBody === work) {
      return { contactEmail: accountEmail, requestorEmail: fromBody };
    }
    return { contactEmail: accountEmail, requestorEmail: work };
  }

  if (accountEmail.endsWith("@portal.stoicticket.local")) {
    const fromBody = (params.bodyRequestorEmail ?? "").trim().toLowerCase();
    if (!fromBody || !isValidWorkEmail(fromBody)) {
      throw new IntakeContactError(
        "Provide a valid work email for ticket notifications (requestor email).",
      );
    }
    return { contactEmail: accountEmail, requestorEmail: fromBody };
  }

  const fromBody = (params.bodyRequestorEmail ?? "").trim().toLowerCase();
  if (fromBody && isValidWorkEmail(fromBody) && fromBody === accountEmail) {
    return { contactEmail: accountEmail, requestorEmail: fromBody };
  }

  return { contactEmail: accountEmail, requestorEmail: accountEmail };
}
