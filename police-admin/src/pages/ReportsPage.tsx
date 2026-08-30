import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useReportsInbox } from '../hooks/useReportsInbox';
import { formatRelativeTime, formatDateTime } from '../utils/formatTime';
import {
  APP_REPORT_CATEGORIES,
  allSolvedReports,
  countActiveByType,
  countByStatus,
  countNewByType,
  countSolvedThisMonth,
  formatPhoneDisplay,
  formatReportStatus,
  isImageEvidence,
  isReportClosed,
  isVideoEvidence,
  mapsUrl,
  monthLabel,
  phoneDialUrl,
  reportPreviewLine,
  reportSolvedAt,
  reportTypeMeta,
  statusCssClass,
} from '../utils/reportDisplay';
import { getAuthToken, mediaUrl, type CitizenReport } from '../services/api';

type StatusFilter = 'active' | 'new' | 'reviewing' | 'closed';
type HomeView = 'categories' | 'solved';

function ReportCategoryCard({
  label,
  color,
  count,
  newCount,
  onSelect,
}: {
  label: string;
  color: string;
  count: number;
  newCount: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="report-category-card report-category-card-lg"
      style={{ '--cat-color': color } as CSSProperties}
      onClick={onSelect}
    >
      <div className="report-category-card-top">
        <span className="report-category-count">{count}</span>
        {newCount > 0 ? <span className="report-category-new">{newCount} new</span> : null}
      </div>
      <span className="report-category-title">{label}</span>
    </button>
  );
}

function SolvedCasesCard({
  total,
  thisMonth,
  onOpen,
}: {
  total: number;
  thisMonth: number;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="solved-cases-card" onClick={onOpen}>
      <div className="solved-cases-card-text">
        <p className="solved-cases-card-eyebrow">Archive</p>
        <h3 className="solved-cases-card-title">Solved & attended</h3>
        <p className="solved-cases-card-hint">
          {thisMonth > 0
            ? `${thisMonth} in ${monthLabel()} · tap to view all`
            : 'Tap to view all closed cases'}
        </p>
      </div>
      <div className="solved-cases-card-total">
        <span className="solved-cases-card-num">{total}</span>
        <span className="solved-cases-card-label">cases</span>
      </div>
    </button>
  );
}

function ReportInboxItem({
  report,
  selected,
  onSelect,
  showSolvedTime,
}: {
  report: CitizenReport;
  selected: boolean;
  onSelect: () => void;
  showSolvedTime?: boolean;
}) {
  const meta = reportTypeMeta(report.type);

  return (
    <button
      type="button"
      className={`inbox-item${selected ? ' selected' : ''}${report.status === 'new' ? ' unread' : ''}`}
      onClick={onSelect}
    >
      <div className="inbox-item-top">
        <span className="inbox-item-type">{report.title || meta.label}</span>
        <span className={`inbox-status inbox-status-${statusCssClass(report.status)}`}>
          {formatReportStatus(report.status)}
        </span>
      </div>
      <p className="inbox-item-preview">{reportPreviewLine(report)}</p>
      <span className="inbox-item-time">
        {showSolvedTime
          ? `Solved ${formatRelativeTime(reportSolvedAt(report))}`
          : formatRelativeTime(report.timestamp)}
      </span>
    </button>
  );
}

function ReportDetailView({
  report,
  onSetStatus,
  busy,
}: {
  report: CitizenReport;
  onSetStatus: (id: string, status: string) => Promise<boolean>;
  busy: boolean;
}) {
  const meta = reportTypeMeta(report.type);
  const mapLink = mapsUrl(report.location);
  const dialLink = phoneDialUrl(report.phone);
  const showAssist = !isReportClosed(report.status) && report.type !== 'emergency';

  return (
    <div className="report-detail-inner">
      <div className="report-detail-header report-detail-card">
        <div className="report-detail-topline">
          <span className="report-type-pill" style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
            {meta.label}
          </span>
          {report.anonymous ? <span className="report-anon-badge">Anonymous</span> : null}
          <span className={`badge badge-${report.status === 'new' ? 'emergency' : 'info'}`}>
            {formatReportStatus(report.status)}
          </span>
        </div>
        <p className="report-detail-meta">{report.id} · {formatDateTime(report.timestamp)}</p>
      </div>

      <div className="report-detail-body inbox-detail-scroll">
        {showAssist ? (
          <div className="report-detail-card report-detail-card-assist">
            <p className="report-assist-inline">{meta.assist}</p>
          </div>
        ) : null}

        <div className="report-detail-card">
          <h4 className="detail-section-title">Report</h4>
          <p className="detail-message">{report.message || '—'}</p>
        </div>

        {!report.anonymous && (report.phone || report.location) ? (
          <div className="report-detail-card">
            <h4 className="detail-section-title">Contact</h4>
            <div className="report-contact-row">
              {report.phone ? (
                <div className="report-contact-item">
                  <span className="report-contact-label">Phone</span>
                  {dialLink ? (
                    <a href={dialLink} className="report-phone-link">{formatPhoneDisplay(report.phone)}</a>
                  ) : (
                    <span className="report-contact-value">{formatPhoneDisplay(report.phone)}</span>
                  )}
                </div>
              ) : null}
              {report.location ? (
                <div className="report-contact-item">
                  <span className="report-contact-label">Location</span>
                  <span className="report-contact-value">{report.location}</span>
                  {mapLink ? (
                    <a href={mapLink} target="_blank" rel="noreferrer" className="report-map-link">Map</a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {report.evidenceFiles && report.evidenceFiles.length > 0 ? (
          <div className="report-detail-card">
            <h4 className="detail-section-title">Evidence · {report.evidenceFiles.length}</h4>
            <div className="evidence-gallery">
              {report.evidenceFiles.map((f) => {
                const url = mediaUrl(f.url);
                const image = isImageEvidence(f.type);
                const video = isVideoEvidence(f.type);
                return (
                  <div key={f.url} className="evidence-tile">
                    {image ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt="" className="evidence-thumb" />
                      </a>
                    ) : video ? (
                      <video src={url} controls className="evidence-thumb" />
                    ) : (
                      <a href={url} target="_blank" rel="noreferrer" className="evidence-file-link">File</a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="report-detail-card report-detail-card-actions">
          <div className="btn-group report-actions">
            {report.status === 'new' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void onSetStatus(report.id, 'reviewing')}
              >
                In review
              </button>
            ) : null}
            {!isReportClosed(report.status) ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void onSetStatus(report.id, 'closed')}
              >
                Mark as solved
              </button>
            ) : (
              <p className="report-solved-note">
                Solved {formatDateTime(reportSolvedAt(report))}
              </p>
            )}
            {report.type === 'emergency' ? (
              <Link to="/monitoring" className="btn btn-ghost">Live map</Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportsWorkspace({
  title,
  subtitle,
  list,
  loading,
  selected,
  selectedId,
  onBack,
  onSelect,
  onSetStatus,
  actionBusy,
  statusTabs,
  statusFilter,
  onStatusFilter,
  tabCounts,
  showSolvedTime,
}: {
  title: string;
  subtitle: string;
  list: CitizenReport[];
  loading: boolean;
  selected: CitizenReport | null;
  selectedId: string | null;
  onBack: () => void;
  onSelect: (id: string) => void;
  onSetStatus: (id: string, status: string) => Promise<boolean>;
  actionBusy: boolean;
  statusTabs?: { id: StatusFilter; label: string }[];
  statusFilter?: StatusFilter;
  onStatusFilter?: (id: StatusFilter) => void;
  tabCounts?: Record<StatusFilter, number>;
  showSolvedTime?: boolean;
}) {
  return (
    <div className="panel reports-workspace-panel">
      <div className="panel-header reports-workspace-header">
        <div className="reports-filter-context">
          <button type="button" className="btn btn-ghost reports-back-btn" onClick={onBack}>
            ← Back
          </button>
          <h3>{title}</h3>
          <p className="panel-subtitle reports-filter-sub">{subtitle}</p>
        </div>
        {statusTabs && statusFilter && onStatusFilter && tabCounts ? (
          <div className="filter-tabs">
            {statusTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`filter-tab${statusFilter === tab.id ? ' active' : ''}`}
                onClick={() => onStatusFilter(tab.id)}
              >
                {tab.label}
                <span className="filter-tab-count">{tabCounts[tab.id]}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="reports-workspace-body">
        <div className="reports-list-column">
          {loading && list.length === 0 ? (
            <div className="empty-state"><p>Loading…</p></div>
          ) : list.length === 0 ? (
            <div className="empty-state">
              <h3>No cases here</h3>
            </div>
          ) : (
            <div className="inbox-list inbox-scroll">
              {list.map((r) => (
                <ReportInboxItem
                  key={r.id}
                  report={r}
                  selected={selectedId === r.id || selected?.id === r.id}
                  onSelect={() => onSelect(r.id)}
                  showSolvedTime={showSolvedTime}
                />
              ))}
            </div>
          )}
        </div>

        <div className="reports-detail-column">
          {selected ? (
            <ReportDetailView
              report={selected}
              busy={actionBusy}
              onSetStatus={onSetStatus}
            />
          ) : (
            <div className="empty-state">
              <p>Select a case</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { reports, loading, refresh, setStatus } = useReportsInbox();
  const [homeView, setHomeView] = useState<HomeView>('categories');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [solvedToast, setSolvedToast] = useState<string | null>(null);

  useEffect(() => {
    if (!solvedToast) return;
    const id = window.setTimeout(() => setSolvedToast(null), 2800);
    return () => window.clearTimeout(id);
  }, [solvedToast]);

  const sorted = useMemo(
    () => [...reports].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [reports],
  );

  const solvedAll = useMemo(() => allSolvedReports(reports), [reports]);
  const solvedThisMonth = countSolvedThisMonth(reports);

  const byType = useMemo(() => {
    if (!typeFilter) return [];
    return sorted.filter((r) => r.type === typeFilter);
  }, [sorted, typeFilter]);

  const filtered = useMemo(() => {
    if (statusFilter === 'active') return byType.filter((r) => !isReportClosed(r.status));
    if (statusFilter === 'closed') return byType.filter((r) => isReportClosed(r.status));
    return byType.filter((r) => r.status === statusFilter);
  }, [byType, statusFilter]);

  const categorySelected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;
  const solvedSelected = solvedAll.find((r) => r.id === selectedId) ?? solvedAll[0] ?? null;
  const activeCategory = APP_REPORT_CATEGORIES.find((c) => c.id === typeFilter);

  const statusTabs: { id: StatusFilter; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'new', label: 'New' },
    { id: 'reviewing', label: 'In review' },
    { id: 'closed', label: 'Solved' },
  ];

  const openCategory = (id: string) => {
    setHomeView('categories');
    setTypeFilter(id);
    setStatusFilter('active');
    setSelectedId(null);
  };

  const openSolved = () => {
    setTypeFilter(null);
    setHomeView('solved');
    setSelectedId(null);
  };

  const goHome = () => {
    setTypeFilter(null);
    setHomeView('categories');
    setSelectedId(null);
    setStatusFilter('active');
  };

  const handleSetStatus = async (id: string, status: string) => {
    setActionBusy(true);
    try {
      const ok = await setStatus(id, status);
      if (!ok) return false;
      if (status === 'closed' || status === 'resolved') {
        const report = reports.find((r) => r.id === id);
        const label = report?.title || reportTypeMeta(report?.type || '').label || 'Case';
        setSolvedToast(`${label} marked as solved`);
        setSelectedId(null);
        if (homeView !== 'solved') {
          setStatusFilter('active');
        }
      }
      return true;
    } finally {
      setActionBusy(false);
    }
  };

  const showingSolved = homeView === 'solved' && !typeFilter;
  const showingCategory = Boolean(typeFilter && activeCategory);

  return (
    <Layout
      title="Citizen reports"
      pageClass="reports-page"
      actions={
        <>
          <Link to="/monitoring" className="btn btn-secondary">Live map</Link>
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
            Refresh
          </button>
        </>
      }
    >
      {solvedToast ? (
        <div className="solved-toast" role="status" aria-live="polite">
          <span className="solved-toast-check">✓</span>
          <div>
            <strong>Solved</strong>
            <p>{solvedToast}</p>
          </div>
        </div>
      ) : null}

      {!getAuthToken() ? (
        <div className="panel">
          <div className="panel-body">
            <p className="integration-hint">Sign in to load reports.</p>
          </div>
        </div>
      ) : null}

      {!showingSolved && !showingCategory ? (
        <div className="reports-home">
          <SolvedCasesCard
            total={solvedAll.length}
            thisMonth={solvedThisMonth}
            onOpen={openSolved}
          />
          <div className="report-category-grid report-category-grid-main">
            {APP_REPORT_CATEGORIES.map((cat) => (
              <ReportCategoryCard
                key={cat.id}
                label={cat.label}
                color={cat.color}
                count={countActiveByType(reports, cat.id)}
                newCount={countNewByType(reports, cat.id)}
                onSelect={() => openCategory(cat.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {showingSolved ? (
        <ReportsWorkspace
          title="Solved & attended"
          subtitle={`${solvedAll.length} case${solvedAll.length === 1 ? '' : 's'}`}
          list={solvedAll}
          loading={loading}
          selected={solvedSelected}
          selectedId={selectedId}
          onBack={goHome}
          onSelect={setSelectedId}
          onSetStatus={handleSetStatus}
          actionBusy={actionBusy}
          showSolvedTime
        />
      ) : null}

      {showingCategory && activeCategory ? (
        <ReportsWorkspace
          title={activeCategory.label}
          subtitle={`${filtered.length} report${filtered.length === 1 ? '' : 's'}${
            statusFilter !== 'active' ? ` · ${statusTabs.find((t) => t.id === statusFilter)?.label}` : ' · Active'
          }`}
          list={filtered}
          loading={loading}
          selected={categorySelected}
          selectedId={selectedId}
          onBack={goHome}
          onSelect={setSelectedId}
          onSetStatus={handleSetStatus}
          actionBusy={actionBusy}
          statusTabs={statusTabs}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          tabCounts={{
            active: byType.filter((r) => !isReportClosed(r.status)).length,
            new: countByStatus(byType, 'new'),
            reviewing: countByStatus(byType, 'reviewing'),
            closed: countByStatus(byType, 'closed'),
          }}
        />
      ) : null}
    </Layout>
  );
}
