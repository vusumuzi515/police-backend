import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useNoticesStore } from './useNoticesStore';

type NoticesContextValue = ReturnType<typeof useNoticesStore>;

const NoticesContext = createContext<NoticesContextValue | null>(null);

export function NoticesProvider({ children }: { children: ReactNode }) {
  const store = useNoticesStore();
  return <NoticesContext.Provider value={store}>{children}</NoticesContext.Provider>;
}

export function useNotices() {
  const ctx = useContext(NoticesContext);
  if (!ctx) throw new Error('useNotices must be used within NoticesProvider');
  return ctx;
}
