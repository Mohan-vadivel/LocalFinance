import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  title: string;
  color?: string;
}

const icon = (label: string, color = '#0f766e') =>
  L.divIcon({ className: '', html: `<div class="pin" style="background:${color}">${label}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

function Fit({ pins }: { pins: Pin[] }) {
  const map = useMap();
  useEffect(() => {
    // No animation: a modal holding the map can close mid-animation and Leaflet then throws.
    if (pins.length === 1) map.setView([pins[0].lat, pins[0].lng], Math.max(map.getZoom(), 15), { animate: false });
    else if (pins.length > 1) map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30], animate: false });
  }, [map, pins]);
  return null;
}

function Picker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}

/** OpenStreetMap map with numbered pins in visiting order; optionally a click-to-pick point. */
export function MapView({ pins, path, onPick, height = 420 }: { pins: Pin[]; path?: boolean; onPick?: (lat: number, lng: number) => void; height?: number }) {
  const center: [number, number] = pins[0] ? [pins[0].lat, pins[0].lng] : [9.9252, 78.1198];
  return (
    <MapContainer center={center} zoom={14} className="map" style={{ height }} scrollWheelZoom>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit pins={pins} />
      {onPick && <Picker onPick={onPick} />}
      {path && pins.length > 1 && <Polyline positions={pins.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: '#0f766e', weight: 3, opacity: 0.6, dashArray: '6 6' }} />}
      {pins.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={icon(p.label, p.color)}>
          <Popup>{p.title}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
