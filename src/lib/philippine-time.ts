import { DateTime } from "luxon";
import { DEFAULT_TIME_ZONE } from "@/modules/tasks/kpi-recurrence";

/** App display timezone (GMT+8 Taiwan via DEFAULT_TIME_ZONE / env). */
export const PHILIPPINE_TIME_ZONE = DEFAULT_TIME_ZONE;

const TIME_ZONE_LABEL = "GMT+8";

export function philippineDateTimeFromEpoch(epochMs: number): DateTime {
  return DateTime.fromMillis(epochMs, { zone: PHILIPPINE_TIME_ZONE });
}

export function formatPhilippineClock(epochMs: number): {
  time: string;
  date: string;
  timeZoneLabel: string;
} {
  const dt = philippineDateTimeFromEpoch(epochMs);
  return {
    time: dt.toFormat("h:mm:ss a"),
    date: dt.toFormat("EEE, MMM d, yyyy"),
    timeZoneLabel: TIME_ZONE_LABEL,
  };
}

export function formatPhilippineWidgetClock(epochMs: number): {
  hours: string;
  minutes: string;
  seconds: string;
  dayOfWeek: string;
  dayNumber: string;
  month: string;
  timeZoneLabel: string;
  ariaLabel: string;
} {
  const dt = philippineDateTimeFromEpoch(epochMs);
  const hours = dt.toFormat("HH");
  const minutes = dt.toFormat("mm");
  const seconds = dt.toFormat("ss");
  const dayOfWeek = dt.toFormat("ccc").toUpperCase();
  const dayNumber = dt.toFormat("d");
  const month = dt.toFormat("LLL").toUpperCase();
  const date = dt.toFormat("EEE, MMM d, yyyy");
  return {
    hours,
    minutes,
    seconds,
    dayOfWeek,
    dayNumber,
    month,
    timeZoneLabel: TIME_ZONE_LABEL,
    ariaLabel: `Time ${hours}:${minutes}:${seconds}, ${date} (${TIME_ZONE_LABEL})`,
  };
}

export function formatPhilippineBarClock(epochMs: number): {
  hours: string;
  minutes: string;
  seconds: string;
  ariaLabel: string;
} {
  const dt = philippineDateTimeFromEpoch(epochMs);
  const hours = dt.toFormat("HH");
  const minutes = dt.toFormat("mm");
  const seconds = dt.toFormat("ss");
  return {
    hours,
    minutes,
    seconds,
    ariaLabel: `Time ${hours}:${minutes}:${seconds} (${TIME_ZONE_LABEL})`,
  };
}
