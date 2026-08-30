import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginOfficer } from '../services/api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const navigate = useNavigate();
  const [badge, setBadge] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const badgeValue = badge.trim();
    const passwordValue = password;

    if (!badgeValue || !passwordValue) {
      setError('Enter your badge number and password.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const result = await loginOfficer(badgeValue, passwordValue);
      if (!result.ok) {
        if (result.reason === 'network') {
          setError(
            `Cannot reach the police server. Make sure the API is running, then try again.`,
          );
        } else if (result.reason === 'invalid') {
          setError('Invalid badge or password.');
        } else if (result.reason === 'locked') {
          setError('Account locked after too many attempts. Wait a few minutes and try again.');
        } else {
          setError('Sign in failed. Check that the police server is running.');
        }
        return;
      }
      onLogin();
      navigate('/monitoring');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-card">
          <header className="login-brand">
            <div className="login-brand-stripe" aria-hidden />
            <div className="login-badge">
              <img
                src="/police-badge.jpeg"
                alt="Royal Eswatini Police Service"
                className="brand-badge-img"
              />
            </div>
            <p className="login-org">Royal Eswatini Police Service</p>
            <h1>Communications Admin</h1>
          </header>

          <form className="login-form" onSubmit={submit} noValidate>
            <div className="login-form-intro">
              <h2>Sign in</h2>
              <p>Authorised communications staff only</p>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="badge">Officer badge</label>
                <input
                  id="badge"
                  value={badge}
                  onChange={(e) => {
                    setBadge(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Badge number"
                  autoComplete="username"
                  disabled={submitting}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {error ? <p className="login-error" role="alert">{error}</p> : null}

            <button
              type="submit"
              className="btn btn-primary btn-lg login-submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="login-page-footer">© Royal Eswatini Police Service</p>
      </div>
    </div>
  );
}
