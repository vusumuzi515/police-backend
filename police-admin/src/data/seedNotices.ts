import type { AdminNotice } from '../types/notice';

/** Demo notices disabled — start with an empty inbox. */
export const SEED_NOTICES: AdminNotice[] = [];

export function isNoticeExpired(notice: AdminNotice): boolean {
  if (!notice.expiresAt) return false;
  return new Date(notice.expiresAt).getTime() < Date.now();
}

export function isNoticeLive(notice: AdminNotice): boolean {
  return notice.status === 'published' && !isNoticeExpired(notice);
}
