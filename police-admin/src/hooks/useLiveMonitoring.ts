import { useCallback, useEffect, useRef, useState } from 'react';
import type { CitizenReport, DistressSession } from '../services/api';
import {
  fetchActiveDistress,
  fetchPublicNotices,
  fetchReports,
  getAuthToken,
} from '../services/api';
import { sortDistressSessions } from '../utils/distressSession';

const POLL_MS = 3000;

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

export function useLiveMonitoring() {
  const [sessions, setSessions] = useState<DistressSession[]>([]);
  const [reports, setReports] = useState<CitizenReport[]>([]);
  const [notices, setNotices] = useState<{ id: string; title: string; timestamp?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [apiOnline, setApiOnline] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const authenticated = Boolean(getAuthToken());

  const refresh = useCallback(async () => {
    const hasAuth = Boolean(getAuthToken());
    if (!hasAuth) {
      setSessions([]);
      setFetchError('Sign in required');
      setApiOnline(false);
      setLoading(false);
      return;
    }

    try {
      const distressResult = await fetchActiveDistress();
      const reps = await fetchReports();
      const pub = await fetchPublicNotices().catch(() => []);

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
        if (knownIdsRef.current.size > 0 && newIds.length > 0) {
          playNewAlertTone();
        }
        for (const s of sorted) knownIdsRef.current.add(s.id);
        setSessions(sorted);
        setApiOnline(true);
        setFetchError(null);
        setLastSync(new Date());
      }

      setReports(reps);
      setNotices(pub);
    } catch {
      setApiOnline(false);
      setFetchError('Cannot reach police server');
    } finally {
      setLoading(false);
    }
  }, []);

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
    refresh,
    activeCount: sessions.length,
    highPriorityCount: sessions.filter((s) => s.priority === 'high' || s.source === 'panic_button' || s.source === 'citizen_mobile').length,
    newReportCount: reports.filter((r) => r.status === 'new').length,
  };
}
