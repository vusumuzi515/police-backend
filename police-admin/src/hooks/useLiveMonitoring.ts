import { useCallback, useEffect, useRef, useState } from 'react';
import type { CitizenReport, DistressSession } from '../services/api';
import {
  fetchActiveDistress,
  fetchRecentDistress,
  fetchPublicNotices,
  fetchReports,
  getAuthToken,
} from '../services/api';
import { sortDistressSessions } from '../utils/distressSession';

const POLL_MS = 2000;

function isRecentUnresolvedAlert(session: {
  status: string;
}) {
  return session.status === 'active' || session.status === 'acknowledged';
}

function playNewAlertTone() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, 280);
  } catch {
    /* ignore if audio blocked */
  }
}

export function useLiveMonitoring(options: { fetchSupplemental?: boolean } = {}) {
  const fetchSupplemental = options.fetchSupplemental ?? true;
  const [sessions, setSessions] = useState<DistressSession[]>([]);
  const [reports, setReports] = useState<CitizenReport[]>([]);
  const [notices, setNotices] = useState<{ id: string; title: string; timestamp?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [apiOnline, setApiOnline] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [newAlertId, setNewAlertId] = useState<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedSessionsRef = useRef(false);
  const refreshingRef = useRef(false);
  const authenticated = Boolean(getAuthToken());
  const removeSession = useCallback((id: string) => {
    setSessions((current) => current.filter((session) => session.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    const hasAuth = Boolean(getAuthToken());
    if (!hasAuth) {
      setSessions([]);
      setFetchError('Sign in required');
      setApiOnline(false);
      setLoading(false);
      refreshingRef.current = false;
      return;
    }

    try {
      const [activeResult, recentResult] = await Promise.all([fetchActiveDistress(), fetchRecentDistress()]);
      const distressResult = activeResult.ok
        ? {
            ok: true as const,
            sessions: [...activeResult.sessions, ...(recentResult.ok ? recentResult.sessions : [])].filter(
              (session, index, all) => all.findIndex((candidate) => candidate.id === session.id) === index,
            ),
          }
        : activeResult;

      if (!distressResult.ok) {
        setApiOnline(false);
        if (distressResult.reason === 'unauthorized') {
          setFetchError('Session expired — sign in again');
          setSessions([]);
        } else if (distressResult.reason === 'network') {
          setFetchError('Cannot reach police server');
        } else {
          setFetchError('Could not load live feed');
        }
      } else {
        const sorted = sortDistressSessions(distressResult.sessions);
        const newIds = sorted.filter((s) => !knownIdsRef.current.has(s.id)).map((s) => s.id);
        if (hasLoadedSessionsRef.current && newIds.length > 0) {
          playNewAlertTone();
          setNewAlertId(newIds[newIds.length - 1]);
        }
        for (const s of sorted) knownIdsRef.current.add(s.id);
        hasLoadedSessionsRef.current = true;
        setSessions(sorted);
        setApiOnline(true);
        setFetchError(null);
        setLastSync(new Date());
      }

      if (fetchSupplemental) {
        void fetchReports().then(setReports).catch(() => undefined);
        void fetchPublicNotices().then(setNotices).catch(() => undefined);
      }
    } catch {
      setApiOnline(false);
      setFetchError('Cannot reach police server');
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, [fetchSupplemental]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return {
    sessions,
    reports,
    notices,
    loading,
    lastSync,
    apiOnline,
    authenticated,
    fetchError,
    newAlertId,
    refresh,
    removeSession,
    activeCount: sessions.filter(isRecentUnresolvedAlert).length,
    highPriorityCount: sessions.filter((s) => s.priority === 'high' || s.source === 'panic_button' || s.source === 'citizen_mobile').length,
    newReportCount: reports.filter((r) => r.status === 'new').length,
  };
}
