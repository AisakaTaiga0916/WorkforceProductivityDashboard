import { DateTime } from "luxon";
import { DEFAULT_TIME_ZONE } from "@/modules/tasks/kpi-recurrence";
import { REPORT_MAX_DAYS } from "@/modules/reports/report-range";
import {
  WORKFORCE_KPI_PERIOD_PRESETS,
  isWorkforceKpiPeriodPreset,
  type PersonnelKpiRange,
  type WorkforceKpiPeriodPreset,
} from "@/modules/workforce/personnel-kpi";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseYmd(raw: string | null | undefined, timeZone: string): DateTime | null {
  const value = raw?.trim();
  if (!value || !YMD_RE.test(value)) return null;
  const dt = DateTime.fromISO(value, { zone: timeZone }).startOf("day");
  return dt.isValid ? dt : null;
}

function presetLabel(preset: WorkforceKpiPeriodPreset): string {
  return WORKFORCE_KPI_PERIOD_PRESETS.find((option) => option.id === preset)?.label ?? "This month";
}

/**
 * Parse the Workforce KPI lens date window.
 * Calendar presets start at the calendar boundary and end today (future days
 * have no recorded KPI data). Custom ranges are capped to 366 days.
 */
export function parsePersonnelKpiRange(
  input: {
    range?: string | null;
    from?: string | null;
    to?: string | null;
  },
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): PersonnelKpiRange {
  const zone = timeZone || DEFAULT_TIME_ZONE;
  const today = DateTime.fromJSDate(now, { zone }).startOf("day");
  const hasDates = Boolean(input.from?.trim() || input.to?.trim());
  const preset: WorkforceKpiPeriodPreset = isWorkforceKpiPeriodPreset(input.range)
    ? input.range
    : hasDates
      ? "custom"
      : "month";

  let from: DateTime;
  let to = today;
  if (preset === "month") {
    from = today.startOf("month");
  } else if (preset === "quarter") {
    from = today.startOf("quarter");
  } else if (preset === "year") {
    from = today.startOf("year");
  } else {
    const customTo = parseYmd(input.to, zone) ?? today;
    to = customTo > today ? today : customTo;
    from = parseYmd(input.from, zone) ?? to.minus({ days: 29 });
    if (from > to) [from, to] = [to, from];
    if (Math.round(to.diff(from, "days").days) + 1 > REPORT_MAX_DAYS) {
      from = to.minus({ days: REPORT_MAX_DAYS - 1 });
    }
  }

  const fromYmd = from.toISODate()!;
  const toYmd = to.toISODate()!;
  const label =
    preset === "custom"
      ? fromYmd === toYmd
        ? from.toFormat("LLL d, yyyy")
        : `${from.toFormat("LLL d, yyyy")} – ${to.toFormat("LLL d, yyyy")}`
      : presetLabel(preset);

  return { preset, fromYmd, toYmd, label, timeZone: zone };
}
