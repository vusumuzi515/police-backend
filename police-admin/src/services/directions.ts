import type { PoliceStation } from '../constants/policeStations';

export interface DrivingRoute {
  points: [number, number][];
  distanceKm: number;
  durationMin: number;
  from: PoliceStation;
}

function formatDuration(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function formatDistance(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

/** Straight-line fallback when routing service is unavailable. */
function fallbackRoute(
  from: PoliceStation,
  toLat: number,
  toLng: number,
): DrivingRoute {
  const distanceKm =
    Math.round(
      haversineKm(from.latitude, from.longitude, toLat, toLng) * 10,
    ) / 10;
  const durationMin = Math.max(1, Math.round((distanceKm / 45) * 60));
  return {
    points: [
      [from.latitude, from.longitude],
      [toLat, toLng],
    ],
    distanceKm,
    durationMin,
    from,
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchDrivingRoute(
  from: PoliceStation,
  toLat: number,
  toLng: number,
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.longitude},${from.latitude};${toLng},${toLat}` +
    `?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return fallbackRoute(from, toLat, toLng);

    const data = await res.json();
    const route = data?.routes?.[0];
    if (data?.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
      return fallbackRoute(from, toLat, toLng);
    }

    const points = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
    );

    return {
      points,
      distanceKm: formatDistance(route.distance),
      durationMin: formatDuration(route.duration),
      from,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return fallbackRoute(from, toLat, toLng);
  }
}

export function mapsDirectionsUrl(
  from: PoliceStation,
  toLat: number,
  toLng: number,
): string {
  const params = new URLSearchParams({
    api: '1',
    origin: `${from.latitude},${from.longitude}`,
    destination: `${toLat},${toLng}`,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
