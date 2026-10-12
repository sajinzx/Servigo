export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Roads are longer than the crow flies; 1.4 is a common urban detour factor. */
export const DETOUR_FACTOR = 1.4;
export const CITY_SPEED_KMH = 25;

/** Fallback drive time in minutes when the routing service is unavailable. */
export function fallbackEtaMin(a: Point, b: Point): number {
  const km = haversineKm(a, b) * DETOUR_FACTOR;
  return Math.max(1, Math.round((km / CITY_SPEED_KMH) * 60));
}

/** Search radii in km: start small, widen only if too few candidates qualify. */
export const RADIUS_STEPS_KM = [5, 10, 20, 40] as const;
