import type { CitizenReport } from '../services/api';

export interface ReportCategory {
  id: string;
  label: string;
  description: string;
  color: string;
  assist: string;
}

export const REPORT_TYPE_META: Record<string, Omit<ReportCategory, 'id'> & { assist: string }> = {
  anonymous: {
    label: 'Anonymous tip',
    description: '',
    color: '#4a5568',
    assist: 'Review the tip and forward to the relevant station. No callback — act on location or details given.',
  },
  crime: {
    label: 'Report crime',
    description: '',
    color: '#c53030',
    assist: 'Call the citizen back to confirm details, then dispatch or refer to the nearest station.',
  },
  hate: {
    label: 'Hate crime',
    description: '',
    color: '#9b2c2c',
    assist: 'Treat sensitively. Confirm safety, gather details, and assign an investigating officer.',
  },
  traffic: {
    label: 'Traffic issue',
    description: '',
    color: '#dd6b20',
    assist: 'Contact the reporter for exact location and dispatch traffic or patrol units if needed.',
  },
  cyber: {
    label: 'Cyber crime',
    description: '',
    color: '#2b6cb0',
    assist: 'Advise the citizen to preserve evidence. Refer to cyber-crime unit if fraud or threats are involved.',
  },
  domestic: {
    label: 'Domestic abuse',
    description: '',
    color: '#805ad5',
    assist: 'Priority response. Confirm if anyone is in immediate danger. Dispatch and keep the caller on the line if safe.',
  },
  emergency: {
    label: 'Emergency alert',
    description: '',
    color: '#e53e3e',
    assist: 'Check Live monitoring for GPS and audio. Dispatch immediately if the session is still active.',
  },
};

/** Report types shown in the citizen app (Report screen). */
export const APP_REPORT_CATEGORIES: ReportCategory[] = (
  ['anonymous', 'crime', 'hate', 'traffic', 'cyber', 'domestic'] as const
).map((id) => ({
  id,
  ...REPORT_TYPE_META[id],
}));

/** All inbox categories including emergency alerts from Get Help. */
export const CITIZEN_REPORT_CATEGORIES: ReportCategory[] = [
  ...APP_REPORT_CATEGORIES,
  { id: 'emergency', ...REPORT_TYPE_META.emergency },
];

export function reportTypeMeta(type: string) {
  return (
    REPORT_TYPE_META[type] ?? {
      label: type.replace(/_/g, ' '),
      description: 'Citizen submission',
      color: '#2c5282',
      assist: 'Review the report and contact the citizen if a phone number was provided.',
    }
  );
}

export function countByType(reports: CitizenReport[], type: string): number {
  if (type === 'all') return reports.length;
  return reports.filter((r) => r.type === type).length;
}

/** Active (not solved) reports for a category. */
export function countActiveByType(reports: CitizenReport[], type: string): number {
  const pool = type === 'all' ? reports : reports.filter((r) => r.type === type);
  return pool.filter((r) => !isReportClosed(r.status)).length;
}

export function countNewByType(reports: CitizenReport[], type: string): number {
  const pool = type === 'all' ? reports : reports.filter((r) => r.type === type);
  return pool.filter((r) => r.status === 'new').length;
}

export function formatReportStatus(status: string): string {
  switch (status) {
    case 'new':
      return 'New';
    case 'reviewing':
      return 'In review';
    case 'closed':
      return 'Solved';
    case 'resolved':
      return 'Solved';
    default:
      return status;
  }
}

export function statusCssClass(status: string): string {
  if (status === 'resolved' || status === 'closed') return 'closed';
  return status;
}

export function isReportClosed(status: string): boolean {
  return status === 'closed' || status === 'resolved';
}

/** When the case was marked solved (falls back to submit time for older records). */
export function reportSolvedAt(report: CitizenReport): string {
  return report.closedAt || report.timestamp;
}

export function isSolvedThisMonth(report: CitizenReport, now = new Date()): boolean {
  if (!isReportClosed(report.status)) return false;
  const when = new Date(reportSolvedAt(report));
  if (Number.isNaN(when.getTime())) return false;
  return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth();
}

export function solvedReportsThisMonth(reports: CitizenReport[], now = new Date()): CitizenReport[] {
  return reports
    .filter((r) => isSolvedThisMonth(r, now))
    .sort((a, b) => new Date(reportSolvedAt(b)).getTime() - new Date(reportSolvedAt(a)).getTime());
}

/** All closed / attended cases, newest solved first. */
export function allSolvedReports(reports: CitizenReport[]): CitizenReport[] {
  return reports
    .filter((r) => isReportClosed(r.status))
    .sort((a, b) => new Date(reportSolvedAt(b)).getTime() - new Date(reportSolvedAt(a)).getTime());
}

export function countSolvedThisMonth(reports: CitizenReport[], now = new Date()): number {
  return solvedReportsThisMonth(reports, now).length;
}

export function monthLabel(now = new Date()): string {
  return now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export function parseCoordinates(location?: string): { lat: number; lng: number } | null {
  if (!location) return null;
  const match = location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function mapsUrl(location?: string): string | null {
  const coords = parseCoordinates(location);
  if (!coords) return null;
  return `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
}

export function phoneDialUrl(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const local = digits.length === 8 ? `268${digits}` : digits;
  return `tel:+${local}`;
}

export function formatPhoneDisplay(phone?: string): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  }
  return phone;
}

export function reportPreviewLine(report: CitizenReport): string {
  if (report.message) {
    const line = report.message.split('\n')[0].trim();
    return line.length > 90 ? `${line.slice(0, 90)}…` : line;
  }
  if (!report.anonymous && report.location) return `📍 ${report.location}`;
  if (!report.anonymous && report.phone) return `📞 ${formatPhoneDisplay(report.phone)}`;
  return 'No description provided';
}

export function reportListMeta(report: CitizenReport): string {
  const parts: string[] = [];
  if (!report.anonymous && report.phone) parts.push(formatPhoneDisplay(report.phone));
  if (!report.anonymous && report.location) {
    const short = report.location.length > 40 ? `${report.location.slice(0, 40)}…` : report.location;
    parts.push(short);
  }
  if (report.evidenceFiles?.length) parts.push(`${report.evidenceFiles.length} attachment${report.evidenceFiles.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function countByStatus(reports: CitizenReport[], status: string): number {
  if (status === 'closed') {
    return reports.filter((r) => isReportClosed(r.status)).length;
  }
  return reports.filter((r) => r.status === status).length;
}

export function isImageEvidence(type?: string): boolean {
  return !!type && type.startsWith('image/');
}

export function isVideoEvidence(type?: string): boolean {
  return !!type && type.startsWith('video/');
}
