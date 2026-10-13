/**
 * Keyword triage used when the ML service is unreachable. It is the same rule
 * set as the Python baseline (services/ml/app/baselines.py), so a customer
 * still gets three sensible suggestions with no model at all.
 */
export const SERVICE_CATEGORY: Record<string, { name: string; kind: 'car' | 'bike'; category: string }> = {
  CAR_001: { name: 'Car General Service', kind: 'car', category: 'general' },
  CAR_002: { name: 'Car Oil Change', kind: 'car', category: 'oil' },
  CAR_003: { name: 'Car Brake Inspection', kind: 'car', category: 'brakes' },
  CAR_004: { name: 'Car Tire Rotation', kind: 'car', category: 'tyres' },
  CAR_005: { name: 'Car AC Service', kind: 'car', category: 'ac' },
  CAR_006: { name: 'Car Wash & Vacuum', kind: 'car', category: 'wash' },
  CAR_007: { name: 'Car Clutch Overhaul', kind: 'car', category: 'clutch' },
  CAR_008: { name: 'Car Wheel Alignment', kind: 'car', category: 'tyres' },
  CAR_009: { name: 'Car Battery Check', kind: 'car', category: 'electrical' },
  CAR_010: { name: 'Car Denting/Painting', kind: 'car', category: 'body' },
  BIKE_001: { name: 'Bike General Service', kind: 'bike', category: 'general' },
  BIKE_002: { name: 'Bike Oil Change', kind: 'bike', category: 'oil' },
  BIKE_003: { name: 'Bike Brake & Chain Lube', kind: 'bike', category: 'brakes' },
  BIKE_004: { name: 'Bike Puncture Repair', kind: 'bike', category: 'tyres' },
  BIKE_005: { name: 'Bike Engine Tuning', kind: 'bike', category: 'engine' },
  BIKE_006: { name: 'Bike Water Wash', kind: 'bike', category: 'wash' },
  BIKE_007: { name: 'Bike Carburetor Cleaning', kind: 'bike', category: 'engine' },
  BIKE_008: { name: 'Bike Clutch Plate Check', kind: 'bike', category: 'clutch' },
  BIKE_009: { name: 'Bike Electrical Checkup', kind: 'bike', category: 'electrical' },
  BIKE_010: { name: 'Bike Chain Tightening', kind: 'bike', category: 'general' },
};

const KEYWORDS: Record<string, string[]> = {
  brakes: ['brake', 'braking', 'pidikkala', 'lagane'],
  oil: ['oil', 'maathanum', 'badalna'],
  ac: ['ac ', 'air condition', 'cooling', 'thanda', 'gas'],
  tyres: ['tyre', 'tire', 'puncture', 'flat', 'alignment', 'pulls', 'rotation'],
  clutch: ['clutch', 'gear'],
  electrical: ['battery', 'headlight', 'horn', 'light', 'self start', 'electrical'],
  body: ['dent', 'scratch', 'paint', 'bumper'],
  wash: ['wash', 'vacuum', 'dusty', 'mud', 'safai', 'dhulai'],
  engine: ['engine', 'carburetor', 'mileage', 'tuning', 'knock'],
  general: ['service', 'maintenance', 'chain', 'periodic'],
};

export function keywordTriage(
  text: string,
  kind: 'car' | 'bike',
  k = 3,
): { code: string; name: string; probability: number }[] {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const score = (category: string) => (KEYWORDS[category] ?? []).filter((w) => t.includes(w)).length;
  return Object.entries(SERVICE_CATEGORY)
    .filter(([, v]) => v.kind === kind)
    .map(([code, v]) => ({ code, name: v.name, hits: score(v.category) }))
    .sort((a, b) => b.hits - a.hits || (a.code < b.code ? -1 : 1))
    .slice(0, k)
    .map((r, i) => ({ code: r.code, name: r.name, probability: Number((1 / (i + 1)).toFixed(3)) }));
}
