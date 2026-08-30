import { useCallback, useEffect, useState } from 'react';
import type { CitizenReport } from '../services/api';
import { fetchReports, updateReportStatus } from '../services/api';

export function useReportsInbox() {
  const [reports, setReports] = useState<CitizenReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchReports();
    setReports(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [load]);

  const setStatus = useCallback(async (id: string, status: string) => {
    const ok = await updateReportStatus(id, status);
    if (ok) await load();
    return ok;
  }, [load]);

  return { reports, loading, refresh: load, setStatus };
}
