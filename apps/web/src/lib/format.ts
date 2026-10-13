const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

export const rupees = (n: number | string | null | undefined, decimals = false) => {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return Number.isFinite(v) ? (decimals ? inr2 : inr).format(v) : '—';
};

export const priceRange = (low: number, high: number) => `${rupees(low)} – ${rupees(high)}`;

export function minutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function km(d: number | string | null | undefined): string {
  if (d === null || d === undefined) return '—';
  const v = Number(d);
  return v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

/** KA01AB1234 -> KA 01 AB 1234, for display only */
export function plate(reg: string): string {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(reg);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : reg;
}

export const normalisePlate = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
