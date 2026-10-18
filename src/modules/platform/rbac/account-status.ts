/** `portal_accounts.account_status` values. */
export const ACCOUNT_STATUS_ACTIVE = "ACTIVE";
export const ACCOUNT_STATUS_INACTIVE = "INACTIVE";
/** Duplicate rows superseded by an HRIS merge; never usable for sign-in. */
export const ACCOUNT_STATUS_LEGACY_CONFLICT = "LEGACY_CONFLICT";

/**
 * Accounts an administrator switched off (INACTIVE, SUSPENDED, DELETED, …).
 * Legacy-conflict duplicates are excluded: they are bookkeeping rows, not a
 * decision about the person, so they must not end the canonical account's session.
 */
export function accountStatusIsDisabled(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return !accountStatusIsActive(s) && s !== ACCOUNT_STATUS_LEGACY_CONFLICT;
}

/** Only ACTIVE (or unset, for legacy rows) accounts may sign in or hold permissions. */
export function accountStatusIsActive(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return s === "" || s === ACCOUNT_STATUS_ACTIVE;
}
