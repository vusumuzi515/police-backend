export interface PoliceStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  town: string;
}

export const POLICE_STATIONS: PoliceStation[] = [
  { id: 'mbabane', name: 'Mbabane Police Station', latitude: -26.3167, longitude: 31.1333, town: 'Mbabane' },
  { id: 'manzini', name: 'Manzini Police Station', latitude: -26.4989, longitude: 31.3681, town: 'Manzini' },
  { id: 'matsapha', name: 'Matsapha Police Station', latitude: -26.5167, longitude: 31.3167, town: 'Matsapha' },
  { id: 'siteki', name: 'Siteki Police Station', latitude: -26.55, longitude: 31.95, town: 'Siteki' },
  { id: 'nhlangano', name: 'Nhlangano Police Station', latitude: -27.1167, longitude: 31.2, town: 'Nhlangano' },
  { id: 'lobamba', name: 'Lobamba Police Station', latitude: -26.4667, longitude: 31.2, town: 'Lobamba' },
  { id: 'big-bend', name: 'Big Bend Police Station', latitude: -26.9833, longitude: 31.9333, town: 'Big Bend' },
  { id: 'piggs-peak', name: "Piggs Peak Police Station", latitude: -25.9667, longitude: 31.25, town: "Piggs Peak" },
];

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestPoliceStation(lat: number, lng: number): PoliceStation {
  let nearest = POLICE_STATIONS[0];
  let best = Infinity;
  for (const station of POLICE_STATIONS) {
    const d = distanceKm(lat, lng, station.latitude, station.longitude);
    if (d < best) {
      best = d;
      nearest = station;
    }
  }
  return nearest;
}
