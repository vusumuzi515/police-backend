import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import {
  fetchSettings,
  updateSettings,
  type RetentionSettings,
} from '../services/api';

export function SettingsPage() {
  const [settings, setSettings] = useState<RetentionSettings>({
    reportRetentionDays: 30,
    liveAlertRetentionDays: 30,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      const result = await fetchSettings();
      if (!active) return;
      if (result.ok) {
        setSettings(result.settings);
      } else {
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await updateSettings({
      reportRetentionDays: Number(settings.reportRetentionDays),
      liveAlertRetentionDays: Number(settings.liveAlertRetentionDays),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSettings(result.settings);
    setMessage(
      result.purged
        ? 'Saved. Old records that passed the new limit were removed now.'
        : 'Saved. Records will auto-remove after the number of days you set.',
    );
  };

  return (
    <Layout
      title="Data retention"
      subtitle="Choose how long citizen reports and closed live alerts stay on the dashboard."
    >
      <div className="panel" style={{ maxWidth: 640 }}>
        <div className="panel-header">
          <h3>Auto-remove schedule</h3>
          <p className="panel-subtitle">
            Set <strong>0</strong> to keep data forever. Active Get Help alerts are never removed
            automatically.
          </p>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: '1.25rem' }}>
          {loading ? <p>Loading settings…</p> : null}

          {!loading ? (
            <>
              <label style={{ display: 'grid', gap: '0.4rem' }}>
                <span style={{ fontWeight: 700 }}>Citizen reports — remove after (days)</span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={settings.reportRetentionDays}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      reportRetentionDays: Number(e.target.value),
                    }))
                  }
                  style={{
                    padding: '0.7rem 0.85rem',
                    borderRadius: 10,
                    border: '1px solid #d5deea',
                    fontSize: '1rem',
                  }}
                />
                <span style={{ color: '#64748b', fontSize: '0.9rem' }}>
                  Counted from the day the citizen sent the report. Photos/videos are removed too.
                </span>
              </label>

              <label style={{ display: 'grid', gap: '0.4rem' }}>
                <span style={{ fontWeight: 700 }}>
                  Closed live / Get Help alerts — remove after (days)
                </span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={settings.liveAlertRetentionDays}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      liveAlertRetentionDays: Number(e.target.value),
                    }))
                  }
                  style={{
                    padding: '0.7rem 0.85rem',
                    borderRadius: 10,
                    border: '1px solid #d5deea',
                    fontSize: '1rem',
                  }}
                />
                <span style={{ color: '#64748b', fontSize: '0.9rem' }}>
                  Applies only to resolved, expired, or ended alerts. Live ones stay until an officer
                  closes them.
                </span>
              </label>

              {error ? (
                <p style={{ color: '#c53030', fontWeight: 600, margin: 0 }}>{error}</p>
              ) : null}
              {message ? (
                <p style={{ color: '#276749', fontWeight: 600, margin: 0 }}>{message}</p>
              ) : null}

              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void onSave()}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save retention settings'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
