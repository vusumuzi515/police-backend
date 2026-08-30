import { useRef, useState, type ChangeEvent } from 'react';
import type { NoticeFormData, NoticeUrgency, NoticeCategory, NoticeScope } from '../types/notice';
import { CATEGORY_LABELS } from '../types/notice';
import { API_BASE, getAuthToken, uploadNoticeAttachment } from '../services/api';

interface NoticeFormProps {
  value: NoticeFormData;
  onChange: (value: NoticeFormData) => void;
}

type CreationMode = 'write' | 'upload';

const URGENCIES: NoticeUrgency[] = ['emergency', 'advisory', 'info'];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as NoticeCategory[];
const SCOPES: NoticeScope[] = ['national', 'regional'];

const emptyForm = (): NoticeFormData => ({
  title: '',
  message: '',
  urgency: 'advisory',
  category: 'national',
  scope: 'national',
  region: '',
  verified: true,
  reference: '',
  acknowledgeable: false,
  expiresAt: '',
});

export { emptyForm };

export function NoticeForm({ value, onChange }: NoticeFormProps) {
  const [mode, setMode] = useState<CreationMode>('write');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof NoticeFormData>(key: K, val: NoticeFormData[K]) => {
    onChange({ ...value, [key]: val });
  };

  const handleTextFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result.trim() : '';
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      onChange({
        ...value,
        title: value.title.trim() || baseName,
        message: text,
        attachmentUrl: undefined,
      });
      setUploadError(null);
    };
    reader.onerror = () => setUploadError('Could not read that file.');
    reader.readAsText(file);
  };

  const handleImageFile = async (file: File) => {
    if (!getAuthToken()) {
      setUploadError('Sign in again to upload files.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    const result = await uploadNoticeAttachment(file);
    setUploading(false);
    if (!result) {
      setUploadError('Upload failed. Check that the police server is running.');
      return;
    }
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    onChange({
      ...value,
      title: value.title.trim() || baseName,
      message: value.message.trim() || 'See attached notice image.',
      attachmentUrl: result.url,
    });
  };

  const onFilePick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isText = file.type === 'text/plain' || /\.txt$/i.test(file.name);
    const isImage = file.type.startsWith('image/');

    if (isText) {
      handleTextFile(file);
      return;
    }
    if (isImage) {
      await handleImageFile(file);
      return;
    }
    setUploadError('Use a .txt file or an image (JPG, PNG).');
  };

  return (
    <div className="notice-form-wrap">
      <div className="notice-mode-tabs">
        <button
          type="button"
          className={`notice-mode-tab${mode === 'write' ? ' active' : ''}`}
          onClick={() => setMode('write')}
        >
          Write notice
        </button>
        <button
          type="button"
          className={`notice-mode-tab${mode === 'upload' ? ' active' : ''}`}
          onClick={() => setMode('upload')}
        >
          Upload file
        </button>
      </div>

      {mode === 'upload' ? (
        <div className="notice-upload-panel">
          <p className="notice-upload-hint">
            Upload a <strong>.txt</strong> advisory (fills the message) or an <strong>image</strong> (JPG/PNG) shown in the citizen app.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain,image/jpeg,image/png,image/webp"
            className="notice-upload-input"
            onChange={(e) => void onFilePick(e)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Choose file'}
          </button>
          {uploadError ? <p className="notice-upload-error">{uploadError}</p> : null}
          {value.attachmentUrl ? (
            <div className="notice-upload-preview">
              <img src={`${API_BASE}${value.attachmentUrl}`} alt="Uploaded notice" />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="form-grid">
        <div className="form-field">
          <label>Title</label>
          <input
            value={value.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Flood alert — Lowveld routes"
          />
        </div>

        <div className="form-field">
          <label>Message</label>
          <textarea
            value={value.message}
            onChange={(e) => set('message', e.target.value)}
            placeholder="Full advisory text citizens will read…"
          />
        </div>

        <div className="form-row-2">
          <div className="form-field">
            <label>Urgency</label>
            <select value={value.urgency} onChange={(e) => set('urgency', e.target.value as NoticeUrgency)}>
              {URGENCIES.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Category</label>
            <select value={value.category} onChange={(e) => set('category', e.target.value as NoticeCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row-2">
          <div className="form-field">
            <label>Scope</label>
            <select value={value.scope} onChange={(e) => set('scope', e.target.value as NoticeScope)}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Region {value.scope === 'national' ? '(optional)' : ''}</label>
            <input
              value={value.region ?? ''}
              onChange={(e) => set('region', e.target.value)}
              placeholder="e.g. Manzini, Mbabane"
              disabled={value.scope === 'national'}
            />
          </div>
        </div>

        <div className="form-row-2">
          <div className="form-field">
            <label>Reference number</label>
            <input
              value={value.reference ?? ''}
              onChange={(e) => set('reference', e.target.value)}
              placeholder="REPS/ADV/2026-0000"
            />
          </div>
          <div className="form-field">
            <label>Expires (optional)</label>
            <input
              type="datetime-local"
              value={value.expiresAt ? value.expiresAt.slice(0, 16) : ''}
              onChange={(e) =>
                set('expiresAt', e.target.value ? new Date(e.target.value).toISOString() : '')
              }
            />
          </div>
        </div>

        <div className="form-field">
          <label>
            <input
              type="checkbox"
              checked={value.acknowledgeable ?? false}
              onChange={(e) => set('acknowledgeable', e.target.checked)}
              style={{ marginRight: '0.5rem' }}
            />
            Citizens can mark as seen (for critical alerts)
          </label>
        </div>
      </div>
    </div>
  );
}
