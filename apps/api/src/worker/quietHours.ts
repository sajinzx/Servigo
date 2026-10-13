const IST_OFFSET_MIN = 330;
const QUIET_START_H = 21;
const QUIET_END_H = 8;

const toIst = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60_000);

/** 21:00-08:00 India time. */
export function inQuietHours(now: Date): boolean {
  const h = toIst(now).getUTCHours();
  return h >= QUIET_START_H || h < QUIET_END_H;
}

/** The next 08:00 IST at or after `now` (returns `now` itself outside quiet hours). */
export function nextQuietEnd(now: Date): Date {
  if (!inQuietHours(now)) return now;
  const ist = toIst(now);
  const end = new Date(ist);
  end.setUTCHours(QUIET_END_H, 0, 0, 0);
  if (ist.getUTCHours() >= QUIET_START_H) end.setUTCDate(end.getUTCDate() + 1);
  return new Date(end.getTime() - IST_OFFSET_MIN * 60_000);
}
