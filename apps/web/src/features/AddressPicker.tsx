import { useEffect, useRef, useState } from 'react';
import { MapView } from '@/map/Map';
import { TextField } from '@/ui/Field';

export interface PickedAddress {
  line1: string;
  city: string;
  pincode: string | null;
  lat: number;
  lng: number;
}

interface NominatimHit {
  display_name: string;
  lat: string;
  lon: string;
  address?: { road?: string; suburb?: string; neighbourhood?: string; city?: string; town?: string; village?: string; state_district?: string; postcode?: string };
}

const CHENNAI = { lat: 13.0827, lng: 80.2707 };

export function toAddress(h: NominatimHit): PickedAddress {
  const a = h.address ?? {};
  const city = a.city ?? a.town ?? a.village ?? a.state_district ?? 'Chennai';
  const pin = a.postcode?.replace(/\s/g, '');
  return {
    line1: h.display_name.split(',').slice(0, 3).join(',').trim(),
    city,
    pincode: pin && /^[1-9]\d{5}$/.test(pin) ? pin : null,
    lat: Number(h.lat),
    lng: Number(h.lon),
  };
}

/**
 * Address search (OpenStreetMap Nominatim) with a confirmation map. The point is
 * geocoded once, here, and stored; the server never geocodes on the booking path.
 */
export function AddressPicker({
  value,
  onChange,
}: {
  value: PickedAddress | null;
  onChange: (a: PickedAddress | null) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<NominatimHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 4) {
      setHits([]);
      return;
    }
    // Nominatim asks for at most one request a second; debounce the typing
    timer.current = setTimeout(async () => {
      setSearching(true);
      setErr(null);
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('addressdetails', '1');
        url.searchParams.set('countrycodes', 'in');
        url.searchParams.set('limit', '5');
        url.searchParams.set('q', q);
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('Address search is busy, try again in a moment');
        setHits((await res.json()) as NominatimHit[]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Address search failed');
      } finally {
        setSearching(false);
      }
    }, 800);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div className="space-y-4">
      <TextField
        label="Search your address"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Street, area, city"
        hint={searching ? 'Searching…' : undefined}
        error={err ?? undefined}
      />
      {hits.length > 0 ? (
        <ul className="divide-y divide-line border border-line">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lon}`}>
              <button
                type="button"
                className="w-full px-3 py-3 text-left text-sm hover:bg-paper-2"
                onClick={() => {
                  onChange(toAddress(h));
                  setHits([]);
                  setQ(h.display_name.split(',').slice(0, 2).join(','));
                }}
              >
                {h.display_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <MapView
        center={value ?? CHENNAI}
        zoom={value ? 15 : 11}
        pins={value ? [{ id: 'you', lat: value.lat, lng: value.lng, tone: 'accent' }] : []}
        onPick={(p) => onChange({ line1: value?.line1 ?? 'Dropped pin', city: value?.city ?? 'Chennai', pincode: value?.pincode ?? null, ...p })}
        ariaLabel="Confirm your location. Click the map to adjust the pin."
        className="h-64"
      />
      {value ? (
        <p className="text-sm text-muted">
          {value.line1}
          {value.pincode ? ` · ${value.pincode}` : ''} — click the map to adjust the pin.
        </p>
      ) : null}
    </div>
  );
}
