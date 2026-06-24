export const DEFAULT_CLINIC_TIMEZONE = "Asia/Kolkata";

export type TimeZoneOption = {
  value: string;
  label: string;
};

const TIMEZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
};

const CURATED_TIMEZONE_OPTIONS: TimeZoneOption[] = [
  { value: "Asia/Kolkata", label: "India Standard Time (IST)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Japan (JST)" },
  { value: "Europe/London", label: "United Kingdom (GMT/BST)" },
  { value: "Europe/Berlin", label: "Central Europe (CET/CEST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "America/New_York", label: "US Eastern (ET)" },
  { value: "America/Chicago", label: "US Central (CT)" },
  { value: "America/Denver", label: "US Mountain (MT)" },
  { value: "America/Los_Angeles", label: "US Pacific (PT)" },
  { value: "America/Toronto", label: "Toronto (ET)" },
  { value: "Australia/Sydney", label: "Sydney (AET)" },
  { value: "Pacific/Auckland", label: "Auckland (NZST/NZDT)" },
  { value: "UTC", label: "UTC" },
];

type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string) {
  const cacheKey = `${timeZone}:parts`;
  if (!partsFormatterCache.has(cacheKey)) {
    partsFormatterCache.set(
      cacheKey,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    );
  }
  return partsFormatterCache.get(cacheKey)!;
}

function getTimeZoneParts(date: Date, timeZone: string): TimeZoneParts {
  const values = getPartsFormatter(timeZone).formatToParts(date);
  const lookup = Object.fromEntries(
    values
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: lookup.year ?? date.getUTCFullYear(),
    month: lookup.month ?? date.getUTCMonth() + 1,
    day: lookup.day ?? date.getUTCDate(),
    hour: lookup.hour ?? date.getUTCHours(),
    minute: lookup.minute ?? date.getUTCMinutes(),
    second: lookup.second ?? date.getUTCSeconds(),
  };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function normalizeTimeZoneValue(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return DEFAULT_CLINIC_TIMEZONE;
  }
  return TIMEZONE_ALIASES[trimmed] ?? trimmed;
}

function buildTimeZoneLabel(value: string) {
  const normalized = normalizeTimeZoneValue(value);
  return normalized.replaceAll("_", " ");
}

export function getDefaultClinicTimeZone() {
  if (typeof Intl === "undefined") {
    return DEFAULT_CLINIC_TIMEZONE;
  }
  try {
    return normalizeTimeZoneValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return DEFAULT_CLINIC_TIMEZONE;
  }
}

export function listSupportedTimeZones(selectedTimeZone?: string): TimeZoneOption[] {
  const normalizedSelected = normalizeTimeZoneValue(selectedTimeZone);
  const options = new Map<string, TimeZoneOption>();

  for (const option of CURATED_TIMEZONE_OPTIONS) {
    options.set(option.value, option);
  }

  if (normalizedSelected && !options.has(normalizedSelected)) {
    options.set(normalizedSelected, {
      value: normalizedSelected,
      label: buildTimeZoneLabel(normalizedSelected),
    });
  }

  return Array.from(options.values());
}

export function formatIsoDateInTimeZone(value: string | Date, timeZone: string) {
  const parts = getTimeZoneParts(typeof value === "string" ? new Date(value) : value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getTodayIsoDateInTimeZone(timeZone: string) {
  return formatIsoDateInTimeZone(new Date(), timeZone);
}

export function formatDateTimeInTimeZone(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function toDateTimeInputInTimeZone(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function zonedDateTimeInputToUtcIso(value: string, timeZone: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    return new Date(value).toISOString();
  }
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(utcGuess);
  const offsetMinutes = getTimeZoneOffsetMinutes(instant, timeZone);
  instant = new Date(utcGuess - offsetMinutes * 60_000);
  const correctedOffset = getTimeZoneOffsetMinutes(instant, timeZone);
  if (correctedOffset !== offsetMinutes) {
    instant = new Date(utcGuess - correctedOffset * 60_000);
  }
  return instant.toISOString();
}
