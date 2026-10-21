// When the price list is due: once a day after 17:00 Sofia time (summer
// and winter time handled by the time zone database).
export const SYNC_TIME_ZONE = "Europe/Sofia";
export const SYNC_HOUR = 17;
/** After a failed run, try again at most this often. */
export const RETRY_MS = 60 * 60 * 1000;

/** Minutes the zone is ahead of UTC at the given moment. */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((local - at.getTime()) / 60000);
}

/** The UTC moment of hour:00 on the given local calendar day in the zone. */
function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const first = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess - zoneOffsetMinutes(new Date(first), timeZone) * 60000);
}

/** The latest 17:00 Sofia time at or before `now`. */
export function lastSyncSlot(now = new Date()): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: SYNC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now).split("-").map(Number);
  const today = zonedTime(y, m, d, SYNC_HOUR, SYNC_TIME_ZONE);
  return today <= now ? today : zonedTime(y, m, d - 1, SYNC_HOUR, SYNC_TIME_ZONE);
}

/**
 * A sync is due when nothing succeeded since the last 17:00 — unless the
 * latest attempt failed less than an hour ago.
 */
export function isSyncDue(lastSuccess: Date | null, lastRun: { at: Date; failed: boolean } | null, now = new Date()): boolean {
  if (lastSuccess && lastSuccess >= lastSyncSlot(now)) return false;
  if (lastRun?.failed && now.getTime() - lastRun.at.getTime() < RETRY_MS) return false;
  return true;
}
