import { Link, NavLink } from 'react-router-dom';
import { useLiveMonitoring } from '../hooks/useLiveMonitoring';
import { MonitoringMap, sessionAreaLabel, type MonitoringMapHandle, type SignalDirection } from '../components/MonitoringMap';
import { DistressAudioPlayer } from '../components/DistressAudioPlayer';
import { PoliceSlogan } from '../components/PoliceSlogan';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, getOfficerProfile, updateDistressSession } from '../services/api';
import { useAuth } from '../store/AuthContext';
import {
  alertKindLabel,
  formatPingAge,
  isFacataSession,
  isSessionUrgent,
  isSignalStale,
  sourceLabel,
} from '../utils/distressSession';

function sessionDuration(startedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000);
  if (mins < 1) return 'Active now';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function MonitoringPage() {
  const { logout } = useAuth();
  const {
    sessions,
    loading,
    lastSync,
    apiOnline,
    activeCount,
    authenticated,
    fetchError,
    refresh,
  } = useLiveMonitoring();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [direction, setDirection] = useState<SignalDirection | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const mapRef = useRef<MonitoringMapHandle>(null);
  const autoFocusedRef = useRef(false);
  const hadGpsRef = useRef<Record<string, boolean>>({});

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const officer = getOfficerProfile();

  const goToSignal = useCallback((id: string) => {
    setSelectedId(id);
    window.requestAnimationFrame(() => {
      mapRef.current?.focusSignal(id);
    });
  }, []);

  const runAction = useCallback(async (action: 'acknowledge' | 'assign' | 'resolve') => {
    if (!selected) return;
    setActionBusy(true);
    try {
      let ok = false;
      if (action === 'acknowledge') {
        ok = await updateDistressSession(selected.id, { status: 'acknowledged' });
      } else if (action === 'assign' && officer) {
        ok = await updateDistressSession(selected.id, {
          assignment: {
            name: officer.name,
            badge: officer.badge,
            unit: officer.rank || 'Communications',
          },
        });
      } else if (action === 'resolve') {
        ok = await updateDistressSession(selected.id, { status: 'resolved' });
      }
      if (ok) await refresh();
    } finally {
      setActionBusy(false);
    }
  }, [selected, officer, refresh]);

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedId(null);
      autoFocusedRef.current = false;
      return;
    }
    if (!selectedId || !sessions.some((s) => s.id === selectedId)) {
      const urgent = sessions.find((s) => isSessionUrgent(s));
      setSelectedId((urgent ?? sessions[0]).id);
    }
  }, [sessions, selectedId]);

  useEffect(() => {
    if (!selectedId || autoFocusedRef.current) return;
    const session = sessions.find((s) => s.id === selectedId);
    if (session?.lastLat == null || session?.lastLng == null) return;
    autoFocusedRef.current = true;
    window.requestAnimationFrame(() => {
      mapRef.current?.focusSignal(selectedId);
    });
  }, [sessions, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const session = sessions.find((s) => s.id === selectedId);
    const hasGps = session?.lastLat != null && session?.lastLng != null;
    const hadGps = hadGpsRef.current[selectedId];
    if (hasGps && !hadGps) {
      window.requestAnimationFrame(() => {
        mapRef.current?.focusSignal(selectedId);
      });
    }
    if (session) hadGpsRef.current[selectedId] = hasGps;
  }, [sessions, selectedId]);

  const tick = useState(0)[1];
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [tick]);

  return (
    <div className="monitoring-shell dashboard-badge-bg dashboard-badge-bg--dark">
      <header className="monitoring-header">
        <div className="monitoring-header-left">
          <Link to="/dashboard" className="monitoring-back">← Dashboard</Link>
          <PoliceSlogan className="monitoring-slogan" />
        </div>

        <nav className="monitoring-nav">
          <NavLink to="/monitoring" className={({ isActive }) => `monitoring-nav-link${isActive ? ' active' : ''}`}>
            Live map
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `monitoring-nav-link${isActive ? ' active' : ''}`}>
            Reports
          </NavLink>
          <NavLink to="/notices" end className={({ isActive }) => `monitoring-nav-link${isActive ? ' active' : ''}`}>
            Notices
          </NavLink>
        </nav>

        <div className="monitoring-header-right">
          <button type="button" className="monitoring-refresh" onClick={() => void refresh()}>
            Refresh feed
          </button>
          <button
            type="button"
            className="monitoring-refresh"
            onClick={() => mapRef.current?.fitCountry()}
            title="Zoom so Eswatini fills the map panel"
          >
            Fill map
          </button>
          <button type="button" className="monitoring-refresh monitoring-logout" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <div className="monitoring-stats monitoring-stats-compact">
        <div className="monitoring-stat">
          <span className="monitoring-stat-value monitoring-stat-alert">{activeCount}</span>
          <span className="monitoring-stat-label">Citizens needing help</span>
        </div>
        <div className="monitoring-stat monitoring-stat-status">
          <span className={`sync-dot${apiOnline && authenticated ? ' online' : ''}`} />
          <span className="monitoring-stat-label">
            {!authenticated
              ? 'Sign in required for live feed'
              : fetchError
                ? fetchError
                : apiOnline
                  ? `Connected · ${API_BASE}`
                  : 'Police server offline'}
          </span>
        </div>
      </div>

      <div className="monitoring-body monitoring-body-focus">
        <div className="monitoring-map-panel">
          {selected ? (
            <div className="map-incident-bar">
              <span className={`map-incident-priority${isSessionUrgent(selected) ? ' urgent' : ''}${isFacataSession(selected) ? ' facata' : ''}`}>
                {alertKindLabel(selected)}
              </span>
              <span className="map-incident-loc">{sessionAreaLabel(selected)}</span>
              <span className="map-incident-meta">{sessionDuration(selected.startedAt)}</span>
              <span className={`map-incident-ping${isSignalStale(selected) ? ' stale' : ''}`}>
                GPS {formatPingAge(selected)}
              </span>
              <span className="map-incident-source">{sourceLabel(selected.source)}</span>
              {selected.callerNumber ? (
                <span className="map-incident-caller">Call: {selected.callerNumber}</span>
              ) : null}
              {isFacataSession(selected) && selected.callAnswered ? (
                <span className="map-incident-facata-flag">Phone call answered</span>
              ) : null}
              {direction && selected.lastLat != null ? (
                <span className="map-incident-direction">
                  {direction.distanceKm > 0
                    ? `${direction.fromName} · ${direction.distanceKm} km · ~${direction.durationMin} min`
                    : `Routing from ${direction.fromName}…`}
                </span>
              ) : null}
              {selected.lastLat != null && selected.lastLng != null ? (
                <a
                  href={direction?.mapsUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${selected.lastLat},${selected.lastLng}&travelmode=driving`}
                  target="_blank"
                  rel="noreferrer"
                  className="map-incident-maps"
                >
                  Open directions
                </a>
              ) : null}
              {selected.audioUrl ? (
                <DistressAudioPlayer audioUrl={selected.audioUrl} />
              ) : null}
              <div className="map-incident-actions">
                <button
                  type="button"
                  className="map-action-btn"
                  disabled={actionBusy || selected.status === 'acknowledged'}
                  onClick={() => void runAction('acknowledge')}
                >
                  Acknowledge
                </button>
                <button
                  type="button"
                  className="map-action-btn"
                  disabled={actionBusy || !officer}
                  onClick={() => void runAction('assign')}
                >
                  Assign unit
                </button>
                <button
                  type="button"
                  className="map-action-btn map-action-resolve"
                  disabled={actionBusy}
                  onClick={() => void runAction('resolve')}
                >
                  Resolve
                </button>
              </div>
            </div>
          ) : null}

          <MonitoringMap
            ref={mapRef}
            sessions={sessions}
            selectedId={selected?.id ?? null}
            onSelect={goToSignal}
            onDirectionChange={setDirection}
            live={apiOnline && authenticated}
            lastSync={lastSync}
          />

          {loading && sessions.length === 0 ? (
            <div className="map-loading">Connecting to live feed…</div>
          ) : null}
        </div>

        <aside className="monitoring-rail monitoring-rail-focus">
          <div className="rail-section-head rail-section-head-main">
            <h3>Active requests</h3>
            <span className="rail-count">{activeCount}</span>
          </div>

          {!authenticated ? (
            <div className="rail-auth-notice">
              <p>Sign in with your officer badge to receive live Get Help locations.</p>
            </div>
          ) : null}

          <div className="rail-list">
            {sessions.length === 0 ? (
              <p className="rail-empty">{loading ? 'Loading…' : 'No active requests'}</p>
            ) : (
              sessions.map((s) => {
                const stale = isSignalStale(s);
                const urgent = isSessionUrgent(s);
                const facata = isFacataSession(s);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`rail-card rail-card-distress${selected?.id === s.id ? ' selected' : ''}${urgent ? ' high' : ''}${facata ? ' facata' : ''}${stale ? ' stale' : ''}`}
                    onClick={() => goToSignal(s.id)}
                  >
                    <div className="rail-card-top">
                      <span className="rail-card-id">
                        {facata ? 'Facata' : urgent ? 'Urgent' : 'Get Help'}
                        {s.status === 'acknowledged' ? ' · Seen' : ''}
                      </span>
                      <span className="rail-card-time">{formatPingAge(s)}</span>
                    </div>
                    <p className="rail-card-title">{sessionAreaLabel(s)}</p>
                    <p className="rail-card-meta">
                      {s.lastLat != null && s.lastLng != null
                        ? `${s.lastLat.toFixed(4)}, ${s.lastLng.toFixed(4)}`
                        : 'Waiting for GPS…'}
                    </p>
                    {s.callerNumber ? (
                      <p className="rail-card-caller">On call with {s.callerNumber}</p>
                    ) : null}
                    {s.assignedOfficer ? (
                      <p className="rail-card-assigned">Unit: {s.assignedOfficer.name}</p>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
