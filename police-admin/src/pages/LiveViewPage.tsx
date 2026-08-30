import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { MobilePreview, NoticePreviewCard, UrgencyBadge } from '../components/NoticePreview';
import { isNoticeLive } from '../data/seedNotices';
import { useNotices } from '../store/NoticesContext';
import { formatDateTime, formatExpiry } from '../utils/formatTime';
import { CATEGORY_LABELS } from '../types/notice';

export function LiveViewPage() {
  const { notices } = useNotices();
  const live = notices.filter(isNoticeLive).sort(
    (a, b) => new Date(b.publishedAt ?? b.timestamp).getTime() - new Date(a.publishedAt ?? a.timestamp).getTime(),
  );

  return (
    <Layout title="Notice feed">
      <div className="live-banner">
        <span className="live-dot" />
        <span>
          <strong>{live.length}</strong> live notice{live.length === 1 ? '' : 's'}
        </span>
      </div>

      {live.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-icon" aria-hidden>◎</div>
            <h3>No live notices</h3>
            <Link to="/notices/new" className="btn btn-primary" style={{ marginTop: '1.25rem' }}>
              Create notice
            </Link>
          </div>
        </div>
      ) : (
        <div className="live-grid">
          {live.map((notice) => (
            <article key={notice.id} className="live-card">
              <div className="live-card-header">
                <div className="live-card-badges">
                  <UrgencyBadge urgency={notice.urgency} />
                  <span className="badge badge-live">Live</span>
                </div>
                <Link to={`/notices/${notice.id}`} className="btn btn-ghost btn-sm">
                  Edit
                </Link>
              </div>
              <MobilePreview>
                <NoticePreviewCard notice={notice} />
              </MobilePreview>
              <dl className="live-meta">
                <div>
                  <dt>Category</dt>
                  <dd>{CATEGORY_LABELS[notice.category]}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{notice.scope === 'national' ? 'Nationwide' : notice.region}</dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>{formatDateTime(notice.publishedAt ?? notice.timestamp)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{formatExpiry(notice.expiresAt)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </Layout>
  );
}
