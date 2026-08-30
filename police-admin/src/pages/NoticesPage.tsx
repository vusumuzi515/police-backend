import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { StatusBadge, UrgencyBadge } from '../components/NoticePreview';
import { isNoticeLive } from '../data/seedNotices';
import { useNotices } from '../store/NoticesContext';
import { formatRelativeTime, formatExpiry } from '../utils/formatTime';
import type { NoticeStatus } from '../types/notice';
import { CATEGORY_LABELS } from '../types/notice';

type Filter = 'all' | NoticeStatus | 'live';

export function NoticesPage() {
  const { notices } = useNotices();
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return notices;
    if (filter === 'live') return notices.filter(isNoticeLive);
    return notices.filter((n) => n.status === filter);
  }, [notices, filter]);

  const tabs: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'live', label: 'Live' },
    { id: 'draft', label: 'Drafts' },
    { id: 'published', label: 'Published' },
    { id: 'archived', label: 'Archived' },
  ];

  return (
    <Layout
      title="All notices"
      actions={
        <Link to="/notices/new" className="btn btn-primary">
          <span className="btn-icon">+</span> Create notice
        </Link>
      }
    >
      <div className="filter-bar">
        <div className="filter-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`filter-tab${filter === tab.id ? ' active' : ''}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="filter-count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Urgency</th>
                <th>Category</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Expiry</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <h3>No notices found</h3>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((n) => (
                  <tr key={n.id}>
                    <td className="title-cell">
                      <Link to={`/notices/${n.id}`} className="table-link">{n.title}</Link>
                    </td>
                    <td><UrgencyBadge urgency={n.urgency} /></td>
                    <td><span className="cell-muted">{CATEGORY_LABELS[n.category]}</span></td>
                    <td><span className="cell-muted">{n.scope === 'national' ? 'Nationwide' : n.region ?? 'Regional'}</span></td>
                    <td><StatusBadge status={n.status} live={isNoticeLive(n)} /></td>
                    <td><span className="cell-muted">{formatRelativeTime(n.updatedAt)}</span></td>
                    <td><span className="cell-muted">{formatExpiry(n.expiresAt)}</span></td>
                    <td>
                      <Link to={`/notices/${n.id}`} className="btn btn-ghost btn-sm">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
