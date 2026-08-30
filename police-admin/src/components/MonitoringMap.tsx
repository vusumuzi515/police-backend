import L from 'leaflet';
import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import type { DistressSession } from '../services/api';
import {
  ESWATINI_BOUNDS,
  ESWATINI_CENTER,
  MAJOR_TOWNS,
  describeLocation,
  getLeafletBounds,
  isWithinEswatini,
} from '../constants/eswatini';
import { POLICE_STATIONS, nearestPoliceStation } from '../constants/policeStations';
import {
  fetchDrivingRoute,
  mapsDirectionsUrl,
  type DrivingRoute,
} from '../services/directions';
import { isSessionUrgent } from '../utils/distressSession';
import 'leaflet/dist/leaflet.css';

const COUNTRY_BOUNDS = L.latLngBounds(getLeafletBounds());
const COUNTRY_CENTER: L.LatLngExpression = [
  ESWATINI_CENTER.latitude,
  ESWATINI_CENTER.longitude,
];
/** Free OSM tiles — no Carto/Mapbox API key. Live GPS pins are separate from this basemap. */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** Minimal padding — fill uses inside-zoom so the map edge-to-edge covers the panel. */
const FIT_PAD = 0;
const FIT_PADDING: L.PointExpression = [FIT_PAD, FIT_PAD];
const FALLBACK_ZOOM = 10;
const MAX_ZOOM = 17;
const DETAIL_ZOOM = 15;
const TILE_MAX_ZOOM = 18;
/** Hides neighbouring countries — matches panel background. */
const MASK_COLOR = '#dfe6ee';

type CountryViewMode = 'fill' | 'contain';

function addOutsideCountryMask(map: L.Map) {
  map.createPane('countryMask');
  const pane = map.getPane('countryMask');
  if (pane) pane.style.zIndex = '450';

  const { north, south, east, west } = ESWATINI_BOUNDS;
  const maskOpts: L.PathOptions = {
    fillColor: MASK_COLOR,
    fillOpacity: 1,
    stroke: false,
    interactive: false,
    pane: 'countryMask',
  };

  const mask = L.layerGroup();
  L.rectangle([[north, -180], [90, 180]], maskOpts).addTo(mask);
  L.rectangle([[-90, -180], [south, 180]], maskOpts).addTo(mask);
  L.rectangle([[south, -180], [north, west]], maskOpts).addTo(mask);
  L.rectangle([[south, east], [north, 180]], maskOpts).addTo(mask);
  mask.addTo(map);
}

function addEswatiniPlaces(map: L.Map): L.LayerGroup {
  map.createPane('placeLabels');
  const pane = map.getPane('placeLabels');
  if (pane) {
    pane.style.zIndex = '550';
    pane.style.pointerEvents = 'none';
  }

  const group = L.layerGroup();

  MAJOR_TOWNS.forEach((town) => {
    L.marker([town.lat, town.lng], {
      interactive: false,
      keyboard: false,
      pane: 'placeLabels',
      icon: L.divIcon({
        className: 'eswatini-town-label',
        html: `<span>${town.name}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    }).addTo(group);
  });

  POLICE_STATIONS.forEach((station) => {
    L.circleMarker([station.latitude, station.longitude], {
      radius: 4,
      color: '#fff',
      weight: 1.5,
      fillColor: '#1a365d',
      fillOpacity: 0.95,
      pane: 'placeLabels',
      interactive: true,
    })
      .bindTooltip(station.name, { direction: 'top', opacity: 0.95 })
      .addTo(group);
  });

  group.addTo(map);
  return group;
}

function mapHasSize(map: L.Map): boolean {
  const el = map.getContainer();
  return el.offsetWidth >= 120 && el.offsetHeight >= 120;
}

function syncContainerSize(_container: HTMLElement, wrap: HTMLElement): boolean {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  return w >= 120 && h >= 120;
}

function containerReady(container: HTMLElement, wrap: HTMLElement): boolean {
  return syncContainerSize(container, wrap);
}

/** Zoom so the whole country fits inside the panel (may leave side gutters). */
function countryContainZoom(map: L.Map): number | null {
  if (!mapHasSize(map)) return null;
  map.invalidateSize({ animate: false, pan: false });
  const zoom = map.getBoundsZoom(COUNTRY_BOUNDS, false, L.point(FIT_PAD, FIT_PAD));
  if (!Number.isFinite(zoom)) return null;
  return Math.min(zoom, MAX_ZOOM);
}

/**
 * Zoom so the panel is fully covered by Eswatini (no grey gutters).
 * Leaflet `inside: true` = map view fits inside country bounds.
 */
function countryFillZoom(map: L.Map): number | null {
  if (!mapHasSize(map)) return null;
  map.invalidateSize({ animate: false, pan: false });
  const zoom = map.getBoundsZoom(COUNTRY_BOUNDS, true, L.point(FIT_PAD, FIT_PAD));
  if (!Number.isFinite(zoom)) return null;
  return Math.min(zoom, MAX_ZOOM);
}

/** Lock map to Eswatini — default `fill` makes the country cover the whole panel. */
function lockToEswatini(
  map: L.Map,
  animate = false,
  mode: CountryViewMode = 'fill',
): boolean {
  if (!mapHasSize(map)) return false;

  map.invalidateSize({ animate: false, pan: false });
  const containZoom = countryContainZoom(map);
  const fillZoom = countryFillZoom(map);
  if (containZoom == null || fillZoom == null) return false;

  // Allow zooming out to whole-country view, but not beyond.
  map.setMinZoom(containZoom);
  map.setMaxBounds(COUNTRY_BOUNDS);
  map.options.maxBoundsViscosity = 1;

  if (mode === 'fill') {
    map.setView(COUNTRY_CENTER, fillZoom, { animate });
  } else {
    map.fitBounds(COUNTRY_BOUNDS, {
      padding: FIT_PADDING,
      animate,
      maxZoom: MAX_ZOOM,
    });
  }

  map.invalidateSize({ animate: false, pan: false });
  return true;
}

function focusOnRoute(map: L.Map, route: DrivingRoute, destLat: number, destLng: number): void {
  if (!mapHasSize(map)) return;
  map.invalidateSize({ animate: false, pan: false });
  const bounds = L.latLngBounds(route.points);
  bounds.extend([destLat, destLng]);
  bounds.extend([route.from.latitude, route.from.longitude]);
  const clipped = COUNTRY_BOUNDS.intersects(bounds)
    ? L.latLngBounds(
        [
          Math.max(bounds.getSouth(), ESWATINI_BOUNDS.south),
          Math.max(bounds.getWest(), ESWATINI_BOUNDS.west),
        ],
        [
          Math.min(bounds.getNorth(), ESWATINI_BOUNDS.north),
          Math.min(bounds.getEast(), ESWATINI_BOUNDS.east),
        ],
      )
    : COUNTRY_BOUNDS;
  map.flyToBounds(clipped, {
    padding: [48, 48],
    maxZoom: DETAIL_ZOOM,
    duration: 0.55,
  });
}

export interface SignalDirection {
  fromName: string;
  distanceKm: number;
  durationMin: number;
  mapsUrl: string;
}

function sessionCoords(session: DistressSession): { lat: number; lng: number } | null {
  if (session.lastLat == null || session.lastLng == null) return null;
  if (!isWithinEswatini(session.lastLat, session.lastLng)) return null;
  return { lat: session.lastLat, lng: session.lastLng };
}

function helpMarkerHtml(urgent: boolean, selected: boolean, label: string): string {
  return `
    <div class="help-marker${selected ? ' help-marker-selected' : ''}${urgent ? ' help-marker-urgent' : ''}">
      <span class="help-marker-pulse"></span>
      <span class="help-marker-core">${urgent ? '!' : 'SOS'}</span>
      <span class="help-marker-label">${label}</span>
    </div>
  `;
}

function createHelpIcon(urgent: boolean, selected: boolean, label: string) {
  return L.divIcon({
    className: 'help-marker-wrap',
    html: helpMarkerHtml(urgent, selected, label),
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export interface MonitoringMapHandle {
  fitCountry: () => void;
  focusSignal: (sessionId?: string) => void;
}

interface MonitoringMapProps {
  sessions: DistressSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDirectionChange?: (direction: SignalDirection | null) => void;
  live: boolean;
  lastSync: Date | null;
}

export const MonitoringMap = forwardRef<MonitoringMapHandle, MonitoringMapProps>(
  function MonitoringMap({ sessions, selectedId, onSelect, onDirectionChange, live, lastSync }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const sessionLayersRef = useRef<Record<string, L.LayerGroup>>({});
    const directionLayerRef = useRef<L.LayerGroup | null>(null);
    const directionRequestRef = useRef(0);
    const userNavigatedRef = useRef(false);
    const followSignalRef = useRef(false);
    const lastFollowedPosRef = useRef<string | null>(null);

    const clearDirection = () => {
      const map = mapRef.current;
      if (map && directionLayerRef.current) {
        map.removeLayer(directionLayerRef.current);
        directionLayerRef.current = null;
      }
      onDirectionChange?.(null);
    };

    const drawDirection = (route: DrivingRoute, destLat: number, destLng: number) => {
      const map = mapRef.current;
      if (!map) return;

      if (directionLayerRef.current) {
        map.removeLayer(directionLayerRef.current);
      }

      const group = L.layerGroup();

      const clippedPoints = route.points.filter(([lat, lng]) => isWithinEswatini(lat, lng));
      if (clippedPoints.length > 1) {
        L.polyline(clippedPoints, {
          color: '#3182ce',
          weight: 5,
          opacity: 0.9,
          lineJoin: 'round',
        }).addTo(group);
      }

      L.circleMarker([route.from.latitude, route.from.longitude], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#38a169',
        fillOpacity: 1,
      })
        .bindTooltip(route.from.name, { permanent: false, direction: 'top' })
        .addTo(group);

      L.circleMarker([destLat, destLng], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#e53e3e',
        fillOpacity: 1,
      })
        .bindTooltip('Citizen needing help', { permanent: false, direction: 'top' })
        .addTo(group);

      group.addTo(map);
      directionLayerRef.current = group;
      focusOnRoute(map, route, destLat, destLng);
    };

    const loadDirection = async (sessionId: string, lat: number, lng: number) => {
      const requestId = ++directionRequestRef.current;
      const station = nearestPoliceStation(lat, lng);

      onDirectionChange?.({
        fromName: station.name,
        distanceKm: 0,
        durationMin: 0,
        mapsUrl: mapsDirectionsUrl(station, lat, lng),
      });

      try {
        const route = await fetchDrivingRoute(station, lat, lng);
        if (requestId !== directionRequestRef.current) return;
        if (selectedId !== sessionId) return;

        drawDirection(route, lat, lng);
        onDirectionChange?.({
          fromName: route.from.name,
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          mapsUrl: mapsDirectionsUrl(route.from, lat, lng),
        });
      } catch {
        if (requestId !== directionRequestRef.current) return;
      }
    };

    const focusSessionById = (sessionId?: string) => {
      const map = mapRef.current;
      if (!map) return false;
      const id = sessionId ?? selectedId;
      if (!id) return false;
      const session = sessions.find((s) => s.id === id);
      const coords = session ? sessionCoords(session) : null;
      if (!coords) return false;

      followSignalRef.current = true;
      userNavigatedRef.current = false;
      lastFollowedPosRef.current = `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
      void loadDirection(id, coords.lat, coords.lng);
      return true;
    };

    useImperativeHandle(ref, () => ({
      fitCountry() {
        if (!mapRef.current) return;
        directionRequestRef.current += 1;
        followSignalRef.current = false;
        userNavigatedRef.current = false;
        lastFollowedPosRef.current = null;
        clearDirection();
        lockToEswatini(mapRef.current, true, 'fill');
      },
      focusSignal(sessionId?: string) {
        focusSessionById(sessionId);
      },
    }), [sessions, selectedId, onDirectionChange]);

    useEffect(() => {
      const el = containerRef.current;
      const wrap = wrapRef.current;
      if (!el || !wrap || mapRef.current) return;

      let map: L.Map | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let resizeObserver: ResizeObserver | null = null;
      let initObserver: ResizeObserver | null = null;

      const applyCountryView = () => {
        if (!map) return;
        syncContainerSize(el, wrap);
        map.invalidateSize({ animate: false, pan: false });
        const locked = lockToEswatini(map, false, 'fill');
        if (!locked) {
          retryTimer = setTimeout(applyCountryView, 150);
        }
      };

      const onResize = () => {
        if (!map) return;
        if (!syncContainerSize(el, wrap)) return;
        map.invalidateSize({ animate: false, pan: false });
        const containZoom = countryContainZoom(map);
        const fillZoom = countryFillZoom(map);
        if (containZoom == null || fillZoom == null) return;
        map.setMinZoom(containZoom);
        if (!userNavigatedRef.current) {
          lockToEswatini(map, false, 'fill');
        } else if (map.getZoom() < containZoom) {
          map.setZoom(containZoom);
        }
      };

      const initMap = () => {
        if (mapRef.current || !containerReady(el, wrap)) return false;

        map = L.map(el, {
          zoomControl: false,
          attributionControl: false,
          maxBounds: COUNTRY_BOUNDS,
          maxBoundsViscosity: 1,
          minZoom: 6,
          maxZoom: MAX_ZOOM,
          worldCopyJump: false,
          scrollWheelZoom: true,
          doubleClickZoom: true,
          touchZoom: true,
          boxZoom: false,
          keyboard: true,
        }).setView(COUNTRY_CENTER, FALLBACK_ZOOM);

        map.on('zoomend dragend', () => {
          if (followSignalRef.current) {
            userNavigatedRef.current = true;
            followSignalRef.current = false;
          }
        });

        L.control.zoom({ position: 'bottomright' }).addTo(map);

        L.tileLayer(TILE_URL, {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          minZoom: 0,
          maxZoom: TILE_MAX_ZOOM,
          bounds: COUNTRY_BOUNDS,
          noWrap: true,
        }).addTo(map);

        addOutsideCountryMask(map);
        addEswatiniPlaces(map);
        mapRef.current = map;

        const scheduleFit = () => {
          syncContainerSize(el, wrap);
          requestAnimationFrame(() => {
            requestAnimationFrame(applyCountryView);
          });
        };

        map.whenReady(scheduleFit);
        window.setTimeout(scheduleFit, 50);
        window.setTimeout(applyCountryView, 200);
        window.setTimeout(applyCountryView, 600);

        resizeObserver =
          typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => onResize()) : null;
        resizeObserver?.observe(wrap);
        resizeObserver?.observe(el);
        window.addEventListener('resize', onResize);

        return true;
      };

      if (!initMap()) {
        initObserver =
          typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                if (initMap() && initObserver) {
                  initObserver.disconnect();
                  initObserver = null;
                }
              })
            : null;
        initObserver?.observe(wrap);
        window.setTimeout(() => {
          if (!mapRef.current) initMap();
        }, 100);
        window.setTimeout(() => {
          if (!mapRef.current) initMap();
        }, 400);
      }

      return () => {
        if (retryTimer) clearTimeout(retryTimer);
        window.removeEventListener('resize', onResize);
        initObserver?.disconnect();
        resizeObserver?.disconnect();
        if (map) {
          map.remove();
          mapRef.current = null;
        }
        sessionLayersRef.current = {};
        directionLayerRef.current = null;
      };
    }, []);

    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      Object.values(sessionLayersRef.current).forEach((layer) => map.removeLayer(layer));
      sessionLayersRef.current = {};

      sessions.forEach((session) => {
        const coords = sessionCoords(session);
        if (!coords) return;

        const pos: L.LatLngExpression = [coords.lat, coords.lng];
        const urgent = isSessionUrgent(session);
        const selected = selectedId === session.id;
        const area = describeLocation(coords.lat, coords.lng);

        const group = L.layerGroup();
        const marker = L.marker(pos, {
          icon: createHelpIcon(urgent, selected, area),
          zIndexOffset: selected ? 1000 : urgent ? 500 : 0,
          title: `${urgent ? 'Urgent' : 'Get Help'} — ${area}`,
        });
        marker.on('click', () => onSelect(session.id));
        marker.bindTooltip(
          `<strong>${urgent ? 'Urgent help' : 'Get Help'}</strong><br/>${area}<br/><span style="opacity:.8">Tap to track & route</span>`,
          { direction: 'top', opacity: 0.96, className: 'help-tooltip' },
        );
        group.addLayer(marker);

        if (session.path && session.path.length > 1) {
          const path = session.path.filter((p) => isWithinEswatini(p.lat, p.lng));
          if (path.length > 1) {
            L.polyline(
              path.map((p) => [p.lat, p.lng] as L.LatLngExpression),
              { color: urgent ? '#fc8181' : '#63b3ed', weight: 2.5, opacity: 0.85, dashArray: '4 6' },
            ).addTo(group);
          }
        }

        if (selected) {
          L.circle(pos, {
            radius: 2500,
            color: 'rgba(99, 179, 237, 0.95)',
            fillColor: 'rgba(99, 179, 237, 0.14)',
            fillOpacity: 0.4,
            weight: 2,
          }).addTo(group);
        }

        group.addTo(map);
        sessionLayersRef.current[session.id] = group;
      });
    }, [sessions, selectedId, onSelect]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || !selectedId || !followSignalRef.current) return;

      const session = sessions.find((s) => s.id === selectedId);
      const coords = session ? sessionCoords(session) : null;
      if (!coords) return;

      const posKey = `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
      if (lastFollowedPosRef.current === posKey) return;

      const hadPosition = lastFollowedPosRef.current != null;
      lastFollowedPosRef.current = posKey;

      if (hadPosition && !userNavigatedRef.current) {
        map.panTo([coords.lat, coords.lng], { animate: true, duration: 0.45 });
      }
    }, [sessions, selectedId]);

    const syncLabel = lastSync
      ? lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '—';

    const mappedCount = sessions.filter((s) => sessionCoords(s)).length;

    return (
      <div ref={wrapRef} className="monitoring-map-wrap">
        <div className="map-title-chip" aria-hidden>
          Kingdom of Eswatini · Citizen tracking
        </div>

        <div className="map-live-badge">
          <span className={`map-live-dot${live ? ' on' : ''}`} />
          <span className="map-live-text">{live ? 'Live' : 'Offline'}</span>
          <span className="map-live-sep">·</span>
          <span className="map-live-sync">
            {mappedCount} on map · Updated {syncLabel}
          </span>
        </div>

        <div ref={containerRef} className="monitoring-map" />

        {mappedCount === 0 ? (
          <div className="map-empty-hint">
            <strong>No active Get Help signals</strong>
          </div>
        ) : null}

        <div className="map-legend" aria-label="Legend">
          <span className="map-legend-item"><span className="legend-sos urgent" /> Urgent</span>
          <span className="map-legend-item"><span className="legend-sos" /> Get Help</span>
          <span className="map-legend-item"><span className="legend-route" /> Route</span>
          <span className="map-legend-item"><span className="legend-station" /> Police station</span>
        </div>
      </div>
    );
  },
);

export function sessionAreaLabel(session: DistressSession): string {
  return describeLocation(session.lastLat, session.lastLng);
}
