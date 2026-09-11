import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { emptyForm, NoticeForm } from '../components/NoticeForm';
import { MobilePreview, NoticePreviewCard, StatusBadge } from '../components/NoticePreview';
import { isNoticeLive } from '../data/seedNotices';
import { useNotices } from '../store/NoticesContext';
import type { NoticeFormData } from '../types/notice';
import { publishNoticeToApi } from '../services/api';
import { formatDateTime } from '../utils/formatTime';

function noticeToForm(notice: ReturnType<typeof useNotices>['notices'][0]): NoticeFormData {
  return {
    title: notice.title,
    message: notice.message,
    urgency: notice.urgency,
    category: notice.category,
    scope: notice.scope,
    region: notice.region,
    latitude: notice.latitude,
    longitude: notice.longitude,
    radiusKm: notice.radiusKm,
    verified: notice.verified,
    reference: notice.reference,
    acknowledgeable: notice.acknowledgeable,
    expiresAt: notice.expiresAt,
    actions: notice.actions,
  };
}

export function NoticeEditPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isNew = !id;
  const {
    notices,
    createNotice,
    updateNotice,
    publishNotice,
    unpublishNotice,
    archiveNotice,
    deleteNotice,
  } = useNotices();

  const existing = useMemo(
    () => (isNew ? null : notices.find((n) => n.id === id) ?? null),
    [notices, id, isNew],
  );

  const [form, setForm] = useState<NoticeFormData>(() =>
    existing ? noticeToForm(existing) : emptyForm(),
  );

  useEffect(() => {
    if (existing) setForm(noticeToForm(existing));
  }, [existing?.id]);

  if (!isNew && !existing) {
    return (
      <Layout title="Notice not found">
        <div className="empty-state">
          <h3>Notice not found</h3>
          <Link to="/notices" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to notices
          </Link>
        </div>
      </Layout>
    );
  }

  const previewNotice = {
    ...form,
    timestamp: existing?.timestamp ?? new Date().toISOString(),
    actions: form.actions,
  };

  const save = () => {
    if (!form.title.trim()) {
      alert('Title is required.');
      return;
    }
    if (!form.message.trim() && !form.attachmentUrl) {
      alert('Add a message or upload a notice file.');
      return;
    }
    if (isNew) {
      const newId = createNotice(form);
      navigate(`/notices/${newId}`);
    } else if (existing) {
      updateNotice(existing.id, form);
    }
  };

  const publish = async () => {
    if (!form.title.trim()) {
      alert('Title is required.');
      return;
    }
    if (!form.message.trim() && !form.attachmentUrl) {
      alert('Add a message or upload a notice file.');
      return;
    }
    if (isNew) {
      const newId = createNotice(form);
      publishNotice(newId);
      const sent = await publishNoticeToApi(form);
      if (!sent) {
        alert(
          'Saved in this browser, but could not reach the police server. Run npm start in the POLICE APP folder, then publish again.',
        );
      }
      navigate(`/notices/${newId}`);
      return;
    }
    if (existing) {
      updateNotice(existing.id, form);
      publishNotice(existing.id);
      const sent = await publishNoticeToApi(form);
      if (!sent) {
        alert(
          'Updated locally, but could not reach the police server. Run npm start in the POLICE APP folder, then publish again.',
        );
      }
    }
  };

  return (
    <Layout
      title={isNew ? 'Create notice' : 'Edit notice'}
      subtitle={existing ? `Ref: ${existing.reference ?? '—'}` : 'New draft'}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/notices')}>
            Cancel
          </button>
          <button type="button" className="btn btn-secondary" onClick={save}>
            Save draft
          </button>
          {(isNew || existing?.status !== 'published') ? (
            <button type="button" className="btn btn-primary" onClick={publish}>
              Publish live
            </button>
          ) : null}
        </>
      }
    >
      {existing ? (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <StatusBadge status={existing.status} live={isNoticeLive(existing)} />
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            Updated {formatDateTime(existing.updatedAt)}
            {existing.publishedAt ? ` · Published ${formatDateTime(existing.publishedAt)}` : ''}
          </span>
        </div>
      ) : null}

      <div className="edit-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Notice content</h3>
            </div>
          </div>
          <div className="panel-body">
            <NoticeForm value={form} onChange={setForm} />
          </div>
        </div>

        <MobilePreview>
          <NoticePreviewCard notice={previewNotice} nearYou={form.scope === 'regional'} />
        </MobilePreview>
      </div>

      {!isNew && existing ? (
        <div className="panel" style={{ marginTop: '1.5rem' }}>
          <div className="panel-header">
            <h3>Actions</h3>
          </div>
          <div className="panel-body btn-group">
            {existing.status === 'published' ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => unpublishNotice(existing.id)}
              >
                Unpublish (back to draft)
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void publish()}
              >
                Publish live
              </button>
            )}
            {existing.status !== 'archived' ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => archiveNotice(existing.id)}
              >
                Archive
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (confirm('Delete this notice permanently?')) {
                  deleteNotice(existing.id);
                  navigate('/notices');
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
