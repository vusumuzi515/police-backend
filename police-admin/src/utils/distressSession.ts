import type { DistressSession } from '../services/api';

const STALE_SECONDS = 20;

export function isSessionUrgent(session: DistressSession): boolean {
  if (session.priority === 'high') return true;
  const source = session.source || '';
  return (
    source === 'panic_button' ||
    source === 'citizen_mobile' ||
    source === 'facata_call' ||
    session.alertType === 'facata'
  );
}

export function isFacataSession(session: DistressSession): boolean {
  return session.alertType === 'facata' || session.source === 'facata_call';
}

export function pingAgeSeconds(session: DistressSession): number | null {
  const ts = session.lastPingAt || session.startedAt;
  if (!ts) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
}

export function formatPingAge(session: DistressSession): string {
  const secs = pingAgeSeconds(session);
  if (secs == null) return 'Waiting for GPS';
  if (secs < 5) return 'Live now';
  if (session.audioUrl && secs > 20) return `Live · last ping ${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`} ago`;
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins} min ago`;
}

export function isSignalStale(session: DistressSession): boolean {
  if (session.audioUrl) return false;
  const secs = pingAgeSeconds(session);
  if (secs == null) return true;
  return secs > STALE_SECONDS;
}

export function sourceLabel(source?: string): string {
  if (source === 'facata_call') return 'Facata call';
  if (source === 'panic_button') return 'Get Help button';
  if (source === 'citizen_mobile') return 'Citizen mobile';
  if (source === 'web') return 'Web citizen';
  return source || 'Unknown';
}

export function alertKindLabel(session: DistressSession): string {
  if (isFacataSession(session)) return 'FACATA';
  if (isSessionUrgent(session)) return 'URGENT';
  return 'GET HELP';
}

export function sortDistressSessions(sessions: DistressSession[]): DistressSession[] {
  return [...sessions].sort((a, b) => {
    const ua = isSessionUrgent(a) ? 0 : 1;
    const ub = isSessionUrgent(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });
}
