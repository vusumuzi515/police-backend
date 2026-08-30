import type { AdminNotice, NoticeStatus, NoticeUrgency } from '../types/notice';

const URGENCY_CLASS: Record<NoticeUrgency, string> = {
  emergency: 'badge-emergency',
  advisory: 'badge-advisory',
  info: 'badge-info',
};

const STATUS_CLASS: Record<NoticeStatus, string> = {
  draft: 'badge-draft',
  published: 'badge-published',
  archived: 'badge-archived',
};

export function UrgencyBadge({ urgency }: { urgency: NoticeUrgency }) {
  return (
    <span className={`badge ${URGENCY_CLASS[urgency]}`}>
      {urgency}
    </span>
  );
}

export function StatusBadge({ status, live }: { status: NoticeStatus; live?: boolean }) {
  if (live) {
    return <span className="badge badge-live">Live</span>;
  }
  return <span className={`badge ${STATUS_CLASS[status]}`}>{status}</span>;
}

export function NoticePreviewCard({
  notice,
  nearYou,
}: {
  notice: Pick<
    AdminNotice,
    'title' | 'message' | 'urgency' | 'scope' | 'region' | 'timestamp' | 'actions' | 'acknowledgeable'
  >;
  nearYou?: boolean;
}) {
  const urgencyColors = {
    emergency: '#e53e3e',
    advisory: '#dd6b20',
    info: '#2c5282',
  };

  const locationLabel = nearYou
    ? 'Near you'
    : notice.scope === 'national'
      ? 'Nationwide'
      : notice.region ?? null;

  return (
    <div className="notice-preview-card">
      <div
        className="notice-preview-bar"
        style={{ backgroundColor: urgencyColors[notice.urgency] }}
      />
      <div className="notice-preview-body">
        <div className="notice-preview-meta">
          <span
            className="notice-preview-urgency"
            style={{ color: urgencyColors[notice.urgency] }}
          >
            {notice.urgency}
          </span>
          {locationLabel ? (
            <>
              <span className="notice-preview-dot">·</span>
              <span>{locationLabel}</span>
            </>
          ) : null}
        </div>
        <div className="notice-preview-title">{notice.title || 'Notice title'}</div>
        <div className="notice-preview-message">
          {notice.message || 'Notice message will appear here…'}
        </div>
        {notice.actions && notice.actions.length > 0 ? (
          <div className="notice-preview-actions">
            {notice.actions.map((action, i) => (
              <span
                key={`${action.type}-${action.label}`}
                className={`notice-preview-action ${i === 0 ? 'primary' : 'secondary'}`}
              >
                {action.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MobilePreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="preview-panel">
      <div className="preview-label">
        <span className="preview-label-dot" />
        Citizen app preview
      </div>
      <div className="phone-frame">
        <div className="phone-screen">
          <div className="phone-header">POLICE EMASWATI</div>
          <div className="phone-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
