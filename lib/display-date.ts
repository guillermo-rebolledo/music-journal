/**
 * Formats a moment as an ISO `YYYY-MM-DD` date in the listener's time zone (ADR 0001).
 * Unknown or invalid zones fall back to UTC. Listen dates are calendar dates and never pass through here.
 */
export function displayDate(at: Date, timeZone?: string) {
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  try {
    return format(timeZone || "UTC");
  } catch {
    return format("UTC");
  }
}

/** Cookie the browser uses to report its IANA time zone so server-rendered dates are right on first paint. */
export const timeZoneCookie = "tz";
