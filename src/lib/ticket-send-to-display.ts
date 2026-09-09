/** Resolve send-to label + value for open/running ticket headers. */

export type TicketSendRequestToDisplay = {
  label: "Send request to (company)" | "Send request to (department)";
  value: string;
};

type ActivityRow = { summary: string; detail: string | null };

function activityDetail(
  activities: readonly ActivityRow[],
  summary: string,
): string | null {
  const detail = activities.find((a) => a.summary === summary)?.detail?.trim();
  return detail || null;
}

/**
 * Company send-to is stored as a ticket activity (and routes to team queue).
 * Department send-to uses org-chart section id and/or activity.
 */
export function resolveTicketSendRequestToDisplay(input: {
  activities: readonly ActivityRow[];
  orgChartSectionId?: string | null;
  orgChartSectionName?: string | null;
  /** Routed company queue — fallback when company activity missing (older tickets). */
  teamName?: string | null;
}): TicketSendRequestToDisplay {
  const companyValue = activityDetail(input.activities, "Send request to company");
  if (companyValue) {
    return { label: "Send request to (company)", value: companyValue };
  }

  const departmentActivity =
    activityDetail(input.activities, "Send request to department") ??
    activityDetail(input.activities, "Send request to section");
  const sectionName = (input.orgChartSectionName ?? "").trim();
  const departmentValue = sectionName || departmentActivity;
  if (departmentValue) {
    return { label: "Send request to (department)", value: departmentValue };
  }

  const sectionId = (input.orgChartSectionId ?? "").trim();
  const teamName = (input.teamName ?? "").trim();
  if (!sectionId && teamName) {
    return { label: "Send request to (company)", value: teamName };
  }

  return { label: "Send request to (department)", value: "—" };
}
