/** Kingdom of Eswatini map limits for live monitoring. */
export const ESWATINI_BOUNDS = {
  north: -25.72,
  south: -27.32,
  east: 32.14,
  west: 30.79,
} as const;

export const ESWATINI_CENTER = {
  latitude: -26.5225,
  longitude: 31.4659,
} as const;

/** Towns shown on the live map (Eswatini only). */
export const MAJOR_TOWNS = [
  { name: 'Mbabane', lat: -26.3167, lng: 31.1333 },
  { name: 'Manzini', lat: -26.4989, lng: 31.3681 },
  { name: 'Matsapha', lat: -26.5167, lng: 31.3167 },
  { name: 'Lobamba', lat: -26.4667, lng: 31.2 },
  { name: 'Siteki', lat: -26.55, lng: 31.95 },
  { name: 'Nhlangano', lat: -27.1167, lng: 31.2 },
  { name: 'Piggs Peak', lat: -25.9667, lng: 31.25 },
  { name: 'Big Bend', lat: -26.8167, lng: 31.9333 },
  { name: 'Malkerns', lat: -26.5667, lng: 31.1833 },
] as const;

export function isWithinEswatini(latitude: number, longitude: number): boolean {
  return (
    latitude <= ESWATINI_BOUNDS.north &&
    latitude >= ESWATINI_BOUNDS.south &&
    longitude >= ESWATINI_BOUNDS.west &&
    longitude <= ESWATINI_BOUNDS.east
  );
}

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

/** Plain-language area label for comms staff. */
export function describeLocation(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return 'Waiting for GPS signal';
  if (!isWithinEswatini(lat, lng)) return 'Outside Eswatini — check signal';

  let nearest: (typeof MAJOR_TOWNS)[number] = MAJOR_TOWNS[0];
  let best = Infinity;
  for (const town of MAJOR_TOWNS) {
    const d = distanceKm(lat, lng, town.lat, town.lng);
    if (d < best) {
      best = d;
      nearest = town;
    }
  }

  if (best <= 12) return `Near ${nearest.name}`;
  if (best <= 25) return `${nearest.name} area`;
  return `Eswatini (${nearest.name} region)`;
}

export function getLeafletBounds(): [[number, number], [number, number]] {
  return [
    [ESWATINI_BOUNDS.south, ESWATINI_BOUNDS.west],
    [ESWATINI_BOUNDS.north, ESWATINI_BOUNDS.east],
  ];
}
