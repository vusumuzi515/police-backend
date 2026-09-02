import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { StatusBadge } from '../components/NoticePreview';
import { isNoticeLive } from '../data/seedNotices';
import { useNotices } from '../store/NoticesContext';
import { fetchActiveDistress, fetchReports } from '../services/api';
import { formatRelativeTime, formatExpiry } from '../utils/formatTime';
import { CATEGORY_LABELS } from '../types/notice';

const WORKSPACE_CARDS = [
  {
    to: '/monitoring',
    label: 'Live monitoring',
    accent: 'monitor',
  },
  {
    to: '/reports',
    label: 'Citizen reports',
    accent: 'reports',
  },
  {
    to: '/notices',
    label: 'All notices',
    accent: 'notices',
  },
  {
    to: '/notices/new',
    label: 'Create notice',
    accent: 'create',
  },
  {
    to: '/live',
    label: 'Notice feed',
    accent: 'feed',
  },
] as const;

export function DashboardPage() {
  const { notices } = useNotices();
  const [activeSessions, setActiveSessions] = useState(0);
  const [reportTotal, setReportTotal] = useState(0);
  const [newReports, setNewReports] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async (forceRefresh = false) => {
      const [distressResult, reports] = await Promise.all([
        fetchActiveDistress(),
        fetchReports(forceRefresh),
      ]);
      if (!mounted) return;
      if (distressResult.ok) setActiveSessions(distressResult.sessions.length);
      setReportTotal(reports.length);
      setNewReports(reports.filter((r) => r.status === 'new').length);
    };

    void load();
    const id = window.setInterval(() => void load(true), 15_000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const live = notices.filter(isNoticeLive);
  const drafts = notices.filter((n) => n.status === 'draft');

  const recent = [...notices]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const cardValues: Record<string, number> = {
    monitor: activeSessions,
    reports: newReports > 0 ? newReports : reportTotal,
    notices: notices.length,
    create: drafts.length,
    feed: live.length,
  };

  const cardDesc: Record<string, string> = {
    monitor: activeSessions === 1 ? 'Active session now' : `${activeSessions} active sessions`,
    reports: newReports > 0 ? `${newReports} new · ${reportTotal} total` : `${reportTotal} in inbox`,
    notices: `${notices.length} in system`,
    create: drafts.length === 1 ? '1 draft waiting' : `${drafts.length} drafts waiting`,
    feed: live.length === 1 ? '1 live on citizen app' : `${live.length} live on citizen app`,
  };

  return (
    <Layout
      title="Dashboard"
      actions={
        <Link to="/notices/new" className="btn btn-primary">
          <span className="btn-icon">+</span> New notice
        </Link>
      }
    >
      <div className="stats-grid stats-grid-nav">
        {WORKSPACE_CARDS.map((card) => (
          <Link key={card.to} to={card.to} className={`stat-card stat-card-link stat-${card.accent}`}>
            <div className="stat-top">
              <span className="label">{card.label}</span>
            </div>
            <div className="value">{cardValues[card.accent]}</div>
            <p className="stat-desc">{cardDesc[card.accent]}</p>
          </Link>
        ))}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>Recently updated</h3>
          </div>
          <Link to="/notices" className="btn btn-ghost btn-sm">View all</Link>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((n) => (
                <tr key={n.id}>
                  <td className="title-cell">
                    <Link to={`/notices/${n.id}`} className="table-link">
                      {n.title}
                    </Link>
                  </td>
                  <td><span className="cell-muted">{CATEGORY_LABELS[n.category]}</span></td>
                  <td>
                    <StatusBadge status={n.status} live={isNoticeLive(n)} />
                  </td>
                  <td><span className="cell-muted">{formatRelativeTime(n.updatedAt)}</span></td>
                  <td><span className="cell-muted">{formatExpiry(n.expiresAt)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
