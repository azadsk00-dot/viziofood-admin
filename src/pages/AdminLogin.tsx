/**
 * Admin/staff login. Allows admin + staff (kitchen display needs staff
 * access too); non-staff roles are rejected with a clear message.
 */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { Button, Card, Field, Input, Toggle } from '../ui';

export default function AdminLogin() {
  const { signIn, resetPassword, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const profile = await signIn(email, password);
      if (!remember) sessionStorage.setItem('vizio-session-only', 'true');
      if (profile.role !== 'admin' && profile.role !== 'staff' && profile.role !== 'kitchen') {
        setError('Access denied. This account does not have staff access.');
        return;
      }
      navigate('/admin', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(140deg, var(--espresso), #3d2c1f 55%, #584030)',
      padding: 'var(--gutter)',
    }}>
      <div className="center-page" style={{ padding: 0, maxWidth: 440 }}>
        <Link to="/" className="site-logo__word" style={{ display: 'block', textAlign: 'center', color: 'var(--cream)', marginBottom: 22, fontSize: '1.6rem' }}>
          Vizio Food
        </Link>
        <Card pad>
          <p className="vz-eyebrow">Staff access</p>
          <h1 style={{ fontSize: '1.6rem', marginBottom: 18 }}>Welcome back.</h1>
          <form onSubmit={submit} noValidate>
            <Field label="Email" htmlFor="al-email">
              <Input id="al-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@viziofood.com" required />
            </Field>
            <Field label="Password" htmlFor="al-password">
              <Input id="al-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
            </Field>
            <div className="vz-row vz-row--between" style={{ marginBottom: 16 }}>
              <Toggle checked={remember} onChange={setRemember} label="Remember me" />
              <button
                type="button"
                className="vz-btn vz-btn--ghost vz-btn--sm"
                onClick={async () => {
                  if (!email) {
                    setError('Enter your email address first.');
                    return;
                  }
                  try {
                    await resetPassword(email);
                    setMessage('Password reset email sent.');
                    setError(undefined);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : 'Unable to send reset email.');
                  }
                }}
              >
                Forgot password?
              </button>
            </div>
            {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
            {message && <p className="vz-field__hint" role="status" style={{ marginBottom: 12, color: 'var(--olive)' }}>{message}</p>}
            <Button type="submit" block disabled={busy || loading}>
              {busy || loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="vz-muted" style={{ textAlign: 'center', marginTop: 14, marginBottom: 0, fontSize: '0.82rem' }}>
            Secure access for Vizio Food staff.
          </p>
        </Card>
      </div>
    </main>
  );
}
