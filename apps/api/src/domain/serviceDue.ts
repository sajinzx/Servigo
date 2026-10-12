/** Fixed-interval rule used until the survival model is promoted: every 5,000 km or 6 months. */
export const KM_INTERVAL = 5000;
export const MAX_INTERVAL_DAYS = 180;

export function serviceDueBaseline(
  kmPerDay: number,
  daysSinceService: number,
  withinDays = 30,
): { days_left: number; probability_due: number; median_days_between_services: number } {
  const interval = Math.min(MAX_INTERVAL_DAYS, KM_INTERVAL / Math.max(kmPerDay, 0.01));
  return {
    median_days_between_services: Math.round(interval * 10) / 10,
    days_left: Math.max(0, Math.round((interval - daysSinceService) * 10) / 10),
    probability_due: daysSinceService + withinDays >= interval ? 1 : 0,
  };
}
