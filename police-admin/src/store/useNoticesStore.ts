import { useCallback, useEffect, useState } from 'react';
import { SEED_NOTICES } from '../data/seedNotices';
import type { AdminNotice, NoticeFormData } from '../types/notice';

const STORAGE_KEY = 'police-admin-notices-v2';

function loadNotices(): AdminNotice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AdminNotice[];
  } catch {
    /* ignore */
  }
  return SEED_NOTICES;
}

function saveNotices(notices: AdminNotice[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notices));
}

function makeId() {
  return `notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useNoticesStore() {
  const [notices, setNotices] = useState<AdminNotice[]>(loadNotices);

  useEffect(() => {
    saveNotices(notices);
  }, [notices]);

  const createNotice = useCallback((data: NoticeFormData) => {
    const now = new Date().toISOString();
    const notice: AdminNotice = {
      ...data,
      id: makeId(),
      timestamp: now,
      status: 'draft',
      createdBy: 'Comms Officer',
      updatedAt: now,
    };
    setNotices((prev) => [notice, ...prev]);
    return notice.id;
  }, []);

  const updateNotice = useCallback((id: string, data: Partial<NoticeFormData>) => {
    setNotices((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, ...data, updatedAt: new Date().toISOString() } : n,
      ),
    );
  }, []);

  const publishNotice = useCallback((id: string) => {
    const now = new Date().toISOString();
    setNotices((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, status: 'published', publishedAt: now, timestamp: now, updatedAt: now }
          : n,
      ),
    );
  }, []);

  const unpublishNotice = useCallback((id: string) => {
    setNotices((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, status: 'draft', publishedAt: undefined, updatedAt: new Date().toISOString() }
          : n,
      ),
    );
  }, []);

  const archiveNotice = useCallback((id: string) => {
    setNotices((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, status: 'archived', updatedAt: new Date().toISOString() }
          : n,
      ),
    );
  }, []);

  const deleteNotice = useCallback((id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const resetDemo = useCallback(() => {
    setNotices(SEED_NOTICES);
  }, []);

  return {
    notices,
    createNotice,
    updateNotice,
    publishNotice,
    unpublishNotice,
    archiveNotice,
    deleteNotice,
    resetDemo,
  };
}
