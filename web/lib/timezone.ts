const FALLBACK_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
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

export function listSupportedTimeZones() {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }
  return FALLBACK_TIMEZONES;
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
