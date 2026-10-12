import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  tone?: 'ink' | 'accent' | 'crit';
}

export interface HexCell {
  /** polygon ring as [lng, lat] pairs */
  ring: [number, number][];
  value: number;
}

const STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    // desaturated so the map sits quietly in the monochrome UI
    { id: 'osm', type: 'raster' as const, source: 'osm', paint: { 'raster-saturation': -1, 'raster-contrast': 0.1 } },
  ],
};

const TONE = { ink: '#0a0a0a', accent: '#0a6cff', crit: '#a12b2b' } as const;

interface Props {
  center: { lat: number; lng: number };
  zoom?: number;
  pins?: Pin[];
  /** straight line between two pins, e.g. workshop to customer */
  route?: [number, number][];
  hexes?: HexCell[];
  className?: string;
  onPick?: (p: { lat: number; lng: number }) => void;
  ariaLabel?: string;
}

/**
 * Thin MapLibre wrapper. OSM tiles (no Google Maps billing). It renders nothing
 * useful in jsdom, so tests mock this module.
 */
export function MapView({ center, zoom = 12, pins = [], route, hexes, className = '', onPick, ariaLabel }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: [center.lng, center.lat],
      zoom,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = m;

    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#0a6cff', 'line-width': 3 } });
      m.addSource('hexes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'hexes',
        type: 'fill',
        source: 'hexes',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'value'], 0, '#f5f5f3', 1, '#0a0a0a'],
          'fill-opacity': 0.55,
          'fill-outline-color': '#6b6b6b',
        },
      });
    });
    if (onPick) m.on('click', (e) => onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng }));

    return () => {
      m.remove();
      map.current = null;
    };
    // the map is created once; props below update it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((x) => x.remove());
    markers.current = pins.map((p) => {
      const dot = document.createElement('div');
      dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${TONE[p.tone ?? 'ink']};border:2px solid #fff`;
      if (p.label) dot.title = p.label;
      return new maplibregl.Marker({ element: dot }).setLngLat([p.lng, p.lat]).addTo(m);
    });
  }, [pins]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.easeTo({ center: [center.lng, center.lat], duration: 300 });
  }, [center.lat, center.lng]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const r = m.getSource('route') as GeoJSONSource | undefined;
      r?.setData({
        type: 'FeatureCollection',
        features: route ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } }] : [],
      });
      const h = m.getSource('hexes') as GeoJSONSource | undefined;
      const max = Math.max(1, ...(hexes ?? []).map((x) => x.value));
      h?.setData({
        type: 'FeatureCollection',
        features: (hexes ?? []).map((x) => ({
          type: 'Feature' as const,
          properties: { value: x.value / max },
          geometry: { type: 'Polygon' as const, coordinates: [[...x.ring, x.ring[0]]] },
        })),
      });
    };
    if (m.isStyleLoaded()) apply();
    else m.once('load', apply);
  }, [route, hexes]);

  return (
    <div
      ref={el}
      role="application"
      aria-label={ariaLabel ?? 'Map'}
      className={`min-h-[280px] w-full border border-line ${className}`}
    />
  );
}
