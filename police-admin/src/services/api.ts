export const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:3000';

const API_CACHE_PREFIX = 'police-admin-api-cache:';
const apiCache = new Map<string, { value: unknown; expiresAt: number }>();
const apiRequests = new Map<string, Promise<unknown>>();

function readCached<T>(key: string): { value: T; expiresAt: number } | null {
  const memory = apiCache.get(key);
  if (memory) return memory as { value: T; expiresAt: number };
  try {
    const storageKey = `${API_CACHE_PREFIX}${key}`;
    const raw = localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { value: T; expiresAt: number };
    if (!Number.isFinite(cached.expiresAt)) return null;
    apiCache.set(key, cached);
    return cached;
  } catch {
    return null;
  }
}

function writeCached<T>(key: string, value: T, ttlMs: number) {
  const cached = { value, expiresAt: Date.now() + ttlMs };
  apiCache.set(key, cached);
  try {
    localStorage.setItem(`${API_CACHE_PREFIX}${key}`, JSON.stringify(cached));
  } catch {
    /* memory cache remains available when storage is unavailable */
  }
}

async function cachedRequest<T>(
  key: string,
  ttlMs: number,
  request: () => Promise<T>,
  fallback: T,
  forceRefresh = false,
): Promise<T> {
  const cached = readCached<T>(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = apiRequests.get(key);
  if (pending) return pending as Promise<T>;

  const requestPromise = request()
    .then((value) => {
      writeCached(key, value, ttlMs);
      return value;
    })
    .catch(() => cached?.value ?? fallback)
    .finally(() => apiRequests.delete(key));
  apiRequests.set(key, requestPromise);
  return requestPromise;
}

export function clearApiCache() {
  apiCache.clear();
  apiRequests.clear();
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) {
      if (key.startsWith(API_CACHE_PREFIX)) storage.removeItem(key);
    }
  }
}

export function getAuthToken(): string | null {
  return sessionStorage.getItem('police-admin-token');
}

export function setAuthToken(token: string) {
  clearApiCache();
  sessionStorage.setItem('police-admin-token', token);
}

export interface OfficerProfile {
  badge: string;
  name: string;
  rank?: string;
}

export function setOfficerProfile(officer: OfficerProfile) {
  sessionStorage.setItem('police-admin-officer', JSON.stringify(officer));
}

export function getOfficerProfile(): OfficerProfile | null {
  const raw = sessionStorage.getItem('police-admin-officer');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfficerProfile;
  } catch {
    return null;
  }
}

export function clearAuthToken() {
  sessionStorage.removeItem('police-admin-token');
  sessionStorage.removeItem('police-admin-officer');
}

export function clearAuthSession() {
  sessionStorage.removeItem('police-admin-auth');
  clearApiCache();
  clearAuthToken();
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'network' | 'invalid' | 'locked' | 'unknown' };

export async function loginOfficer(badge: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ badge: badge.trim(), password }),
    });
    if (res.status === 401) return { ok: false, reason: 'invalid' };
    if (res.status === 423) return { ok: false, reason: 'locked' };
    if (!res.ok) return { ok: false, reason: 'unknown' };
    const data = (await res.json()) as { token?: string; officer?: OfficerProfile };
    if (!data.token) return { ok: false, reason: 'unknown' };
    setAuthToken(data.token);
    if (data.officer) setOfficerProfile(data.officer);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export interface DistressSession {
  id: string;
  priority: 'high' | 'regular' | string;
  status: string;
  source?: string;
  alertType?: string | null;
  callerNumber?: string | null;
  callAnswered?: boolean;
  startedAt: string;
  lastPingAt?: string;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracy?: number | null;
  audioUrl?: string | null;
  path?: { lat: number; lng: number; ts?: string }[];
  assignedOfficer?: {
    name: string;
    unit?: string;
    badge?: string;
  };
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

export type DistressFetchResult =
  | { ok: true; sessions: DistressSession[] }
  | { ok: false; reason: 'unauthorized' | 'network' | 'error' };

export interface EvidenceFile {
  name: string;
  url: string;
  type?: string;
}

export interface CitizenReport {
  id: string;
  type: string;
  title: string;
  message: string;
  status: string;
  timestamp: string;
  closedAt?: string;
  phone?: string;
  location?: string;
  anonymous: boolean;
  evidenceFiles?: EvidenceFile[];
}

const REPORT_LABELS: Record<string, string> = {
  anonymous: 'Anonymous tip',
  crime: 'Report crime',
  hate: 'Report hate crime',
  traffic: 'Traffic issue',
  cyber: 'Cyber crime',
  domestic: 'Domestic abuse',
  emergency: 'Emergency alert',
};

const REPORT_TYPE_ALIASES: Record<string, string> = {
  suspicious_activity: 'anonymous',
  'suspicious-activity': 'anonymous',
  tip: 'anonymous',
  report_crime: 'crime',
  hate_crime: 'hate',
  traffic_issue: 'traffic',
  cyber_crime: 'cyber',
  domestic_abuse: 'domestic',
};

interface ServerReport {
  id: string;
  type: string;
  status: string;
  timestamp: string;
  closedAt?: string;
  payload?: {
    details?: string;
    information?: string;
    description?: string;
    reportTitle?: string;
    phone?: string;
    location?: string | Record<string, unknown>;
    anonymous?: string | boolean;
    evidenceFiles?: EvidenceFile[];
  };
}

function normalizeReportLocation(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const loc = value as { latitude?: number; longitude?: number; accuracy?: number };
    if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
      const acc = typeof loc.accuracy === 'number' ? ` (±${Math.round(loc.accuracy)}m)` : '';
      return `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}${acc}`;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return String(value);
}

function normalizeReportMessage(payload: ServerReport['payload']): string {
  if (!payload) return '';
  return (
    payload.details?.trim() ||
    payload.information?.trim() ||
    payload.description?.trim() ||
    ''
  );
}

export function normalizeReport(raw: ServerReport): CitizenReport {
  const p = raw.payload ?? {};
  const anon = p.anonymous === true || p.anonymous === 'true' || raw.type === 'anonymous';
  const type = REPORT_TYPE_ALIASES[raw.type] ?? raw.type;
  const reportTitle =
    typeof (p as { reportTitle?: string }).reportTitle === 'string'
      ? (p as { reportTitle?: string }).reportTitle
      : undefined;
  return {
    id: raw.id,
    type,
    title: reportTitle || (REPORT_LABELS[type] ?? type.replace(/_/g, ' ')),
    message: normalizeReportMessage(p),
    status: raw.status || 'new',
    timestamp: raw.timestamp || new Date().toISOString(),
    closedAt: typeof raw.closedAt === 'string' ? raw.closedAt : undefined,
    phone: anon ? undefined : (typeof p.phone === 'string' ? p.phone : undefined),
    location: anon ? undefined : normalizeReportLocation(p.location),
    anonymous: anon,
    evidenceFiles: Array.isArray(p.evidenceFiles) ? p.evidenceFiles : undefined,
  };
}

export async function fetchActiveDistress(): Promise<DistressFetchResult> {
  const token = getAuthToken();
  if (!token) return { ok: false, reason: 'unauthorized' };

  return cachedRequest(`active-distress:${token}`, 1_000, async () => {
    const res = await fetch(`${API_BASE}/api/distress/active`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { ok: false, reason: 'unauthorized' as const };
    if (!res.ok) return { ok: false, reason: 'error' as const };
    const data = await res.json();
    return { ok: true, sessions: Array.isArray(data) ? data : [] } as DistressFetchResult;
  }, { ok: false, reason: 'network' });
}

export async function updateDistressSession(
  id: string,
  body: { status?: 'acknowledged' | 'resolved'; assignment?: { name: string; badge: string; unit?: string } },
): Promise<boolean> {
  const token = getAuthToken();
  if (!token) return false;

  try {
    const res = await fetch(`${API_BASE}/api/distress/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    clearApiCache();
    return true;
  } catch {
    return false;
  }
}

export async function fetchReports(forceRefresh = false): Promise<CitizenReport[]> {
  const token = getAuthToken();
  if (!token) return [];
  const cacheKey = `reports:v2:${token}`;
  const previous = readCached<CitizenReport[]>(cacheKey)?.value ?? [];

  return cachedRequest(cacheKey, 15_000, async () => {
    const res = await fetch(`${API_BASE}/api/reports`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Reports request failed: ${res.status}`);
    const data = (await res.json()) as ServerReport[];
    if (!Array.isArray(data)) throw new Error('Invalid reports response');
    const fetched = data.flatMap((raw) => {
      try {
        return [normalizeReport(raw)];
      } catch {
        return [];
      }
    });
    if (!fetched.length && previous.length) return previous;
    const byId = new Map(previous.map((report) => [report.id, report]));
    for (const report of fetched) byId.set(report.id, report);
    return [...byId.values()].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [], forceRefresh);
}

export async function updateReportStatus(id: string, status: string): Promise<boolean> {
  const token = getAuthToken();
  if (!token) return false;

  try {
    const res = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return false;
    clearApiCache();
    return true;
  } catch {
    return false;
  }
}

export interface RetentionSettings {
  reportRetentionDays: number;
  liveAlertRetentionDays: number;
}

export async function fetchSettings(): Promise<
  { ok: true; settings: RetentionSettings } | { ok: false; error: string }
> {
  const token = getAuthToken();
  if (!token) return { ok: false, error: 'Not signed in' };

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: 'Could not load retention settings' };
    const data = (await res.json()) as RetentionSettings;
    return {
      ok: true,
      settings: {
        reportRetentionDays: Number(data.reportRetentionDays) || 0,
        liveAlertRetentionDays: Number(data.liveAlertRetentionDays) || 0,
      },
    };
  } catch {
    return { ok: false, error: 'Cannot reach police server' };
  }
}

export async function updateSettings(
  settings: RetentionSettings,
): Promise<
  | { ok: true; settings: RetentionSettings; purged: boolean }
  | { ok: false; error: string }
> {
  const token = getAuthToken();
  if (!token) return { ok: false, error: 'Not signed in' };

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(settings),
    });
    if (!res.ok) return { ok: false, error: 'Could not save retention settings' };
    const data = (await res.json()) as {
      settings?: RetentionSettings;
      purged?: boolean;
    };
    return {
      ok: true,
      settings: {
        reportRetentionDays: Number(data.settings?.reportRetentionDays) || 0,
        liveAlertRetentionDays: Number(data.settings?.liveAlertRetentionDays) || 0,
      },
      purged: Boolean(data.purged),
    };
  } catch {
    return { ok: false, error: 'Cannot reach police server' };
  }
}

export async function fetchPublicNotices(): Promise<{ id: string; title: string; timestamp?: string }[]> {
  return cachedRequest('public-notices', 30_000, async () => {
    const res = await fetch(`${API_BASE}/api/notices`);
    if (!res.ok) throw new Error(`Notices request failed: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid notices response');
    return data;
  }, []);
}

export async function publishNoticeToApi(notice: {
  title: string;
  message: string;
  category: string;
  scope: string;
  region?: string;
  urgency: string;
  expiresAt?: string;
  reference?: string;
  acknowledgeable?: boolean;
  attachmentUrl?: string;
}): Promise<boolean> {
  const token = getAuthToken();
  if (!token) return false;

  try {
    const res = await fetch(`${API_BASE}/api/notices`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: notice.title,
        message: notice.message,
        category: notice.category,
        type: notice.category,
        scope: notice.scope,
        location: notice.scope === 'national' ? 'national' : notice.region || 'regional',
        region: notice.scope === 'regional' ? notice.region : undefined,
        urgency: notice.urgency,
        urgent: notice.urgency === 'emergency',
        expiresAt: notice.expiresAt || undefined,
        reference: notice.reference || undefined,
        acknowledgeable: notice.acknowledgeable ?? false,
        attachmentUrl: notice.attachmentUrl || undefined,
      }),
    });
    if (!res.ok) return false;
    clearApiCache();
    return true;
  } catch {
    return false;
  }
}

export async function uploadNoticeAttachment(
  file: File,
): Promise<{ url: string; mimeType: string } | null> {
  const token = getAuthToken();
  if (!token) return null;

  const body = new FormData();
  body.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/api/notices/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    if (!res.ok) return null;
    return (await res.json()) as { url: string; mimeType: string };
  } catch {
    return null;
  }
}

export function mediaUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}
