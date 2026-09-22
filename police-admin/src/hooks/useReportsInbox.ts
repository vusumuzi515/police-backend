import { useCallback, useEffect, useRef, useState } from 'react';
import type { CitizenReport } from '../services/api';
import { assignReport, fetchReports, updateReportStatus } from '../services/api';

export function useReportsInbox() {
  const [reports, setReports] = useState<CitizenReport[]>([]);
  const [loading, setLoading] = useState(true);
  const loadingRequestRef = useRef<Promise<void> | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    if (loadingRequestRef.current) return loadingRequestRef.current;
    setLoading(true);
    const request = fetchReports(forceRefresh)
      .then((data) => setReports(data))
      .finally(() => {
        setLoading(false);
        loadingRequestRef.current = null;
      });
    loadingRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 2_000);
    return () => clearInterval(id);
  }, [load]);

  const setStatus = useCallback(async (id: string, status: string) => {
    const ok = await updateReportStatus(id, status);
    if (ok) await load();
    return ok;
  }, [load]);

  const assign = useCallback(async (id: string, assignment: { name: string; badge?: string; unit?: string }) => {
    const ok = await assignReport(id, assignment);
    if (ok) await load(true);
    return ok;
  }, [load]);

  return { reports, loading, refresh: load, setStatus, assign };
}
