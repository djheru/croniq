import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useAuth } from '../App';
import { apiFetch, getAuthStatus } from '../api';
import { Button, Card, Spinner } from '../components/ui';

type Tab = 'register' | 'login' | 'recover';

export default function Auth() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownRecoveryCode, setShownRecoveryCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // On mount: check if any users exist; default to register tab if none
  useEffect(() => {
    getAuthStatus().then(s => { if (!s.hasUsers) setTab('register'); });
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Step 1: get options
      const optionsData = await apiFetch<Record<string, unknown>>('/api/auth/register/options', {
        method: 'POST',
        body: JSON.stringify({ email, deviceCode: deviceCode || undefined }),
      });
      // Step 2: browser ceremony
      const attResp = await startRegistration({ optionsJSON: optionsData as unknown as PublicKeyCredentialCreationOptionsJSON });
      // Step 3: verify
      const result = await apiFetch<{ verified: boolean; recoveryCode?: string; error?: string }>('/api/auth/register/verify', {
        method: 'POST',
        body: JSON.stringify(attResp),
      });
      if (result.verified) {
        if (result.recoveryCode) {
          setShownRecoveryCode(result.recoveryCode);
        } else {
          await refresh();
          navigate('/app');
        }
      } else {
        setError(result.error ?? 'Registration failed');
      }
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === 'NotAllowedError') setError('Ceremony cancelled — try again.');
      else setError(e.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const optionsData = await apiFetch<Record<string, unknown>>('/api/auth/login/options', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      const authResp = await startAuthentication({ optionsJSON: optionsData as unknown as PublicKeyCredentialRequestOptionsJSON });
      const result = await apiFetch<{ verified: boolean; error?: string }>('/api/auth/login/verify', {
        method: 'POST',
        body: JSON.stringify(authResp),
      });
      if (result.verified) {
        await refresh();
        navigate('/app');
      } else {
        setError(result.error ?? 'Login failed');
      }
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === 'NotAllowedError') setError('Ceremony cancelled — try again.');
      else setError(e.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<{ verified?: boolean; newRecoveryCode?: string; error?: string }>('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ email, recoveryCode }),
      });
      if (result.newRecoveryCode) {
        setShownRecoveryCode(result.newRecoveryCode);
      } else if (result.verified) {
        await refresh();
        navigate('/app');
      } else {
        setError(result.error ?? 'Recovery failed');
      }
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Recovery failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleContinueAfterCode() {
    const isRecovery = tab === 'recover';
    setShownRecoveryCode(null);
    try {
      await refresh();
      navigate(isRecovery ? '/app?openPasskeys=1' : '/app');
    } catch {
      setError('Failed to verify session — please sign in.');
      navigate('/auth');
    }
  }

  async function copyCode() {
    if (!shownRecoveryCode) return;
    await navigator.clipboard.writeText(shownRecoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Recovery code interstitial
  if (shownRecoveryCode) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
        <div style={{ maxWidth: 480, width: '100%' }}>
          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '32px' }}>
            <div style={{ fontSize: 22, marginBottom: 8, color: 'var(--warning)' }}>⚠ Save your recovery code</div>
            <p style={{ color: 'var(--text-1)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              This code is shown only once. If you lose access to all your passkeys, you'll need it to regain access.
            </p>
            <div style={{ background: 'var(--bg-0)', border: '1px solid var(--border-bright)', borderRadius: 6, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--accent)', letterSpacing: '0.05em', wordBreak: 'break-all' }}>
                {shownRecoveryCode}
              </code>
              <button
                onClick={copyCode}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 12px', color: copied ? 'var(--success)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0 }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <button
              onClick={handleContinueAfterCode}
              style={{ width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            >
              I've saved my code — Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-sans)' }}>
      {/* Back link */}
      <div style={{ padding: '16px 24px' }}>
        <Link to="/" style={{ color: 'var(--text-1)', textDecoration: 'none', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
          ← Back to croniq
        </Link>
      </div>

      {/* Centered form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: 420, width: '100%' }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 24, marginBottom: 8 }}>
              <span style={{ color: 'var(--accent)' }}>⬡</span> croniq
            </div>
            <div style={{ color: 'var(--text-1)', fontSize: 14 }}>Scheduled intelligence for your Pi</div>
          </div>

          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {/* Tab switcher */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              {(['login', 'register', 'recover'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(null); }}
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    background: tab === t ? 'var(--bg-2)' : 'transparent',
                    border: 'none',
                    borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                    color: tab === t ? 'var(--text-0)' : 'var(--text-2)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: tab === t ? 600 : 400,
                    textTransform: 'capitalize',
                    transition: 'color 0.15s, background 0.15s',
                  }}
                >
                  {t === 'login' ? 'Sign In' : t === 'register' ? 'Register' : 'Recover'}
                </button>
              ))}
            </div>

            {/* Form body */}
            <div style={{ padding: '28px 28px 32px' }}>
              {tab === 'login' && (
                <form onSubmit={handleLogin}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, color: 'var(--text-1)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email webauthn"
                      placeholder="you@example.com"
                      style={{ width: '100%', fontSize: 14, padding: '10px 14px', boxSizing: 'border-box' }}
                    />
                  </div>
                  {error && (
                    <div style={{ background: 'var(--danger-dim)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    style={{ width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '12px', fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}
                  >
                    {loading ? <Spinner /> : null}
                    {loading ? 'Signing in…' : 'Sign in with Passkey'}
                  </button>
                </form>
              )}

              {tab === 'register' && (
                <form onSubmit={handleRegister}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, color: 'var(--text-1)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      style={{ width: '100%', fontSize: 14, padding: '10px 14px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, color: 'var(--text-1)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                      Device Code <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={deviceCode}
                      onChange={(e) => setDeviceCode(e.target.value)}
                      placeholder="123456"
                      maxLength={6}
                      style={{ width: '100%', fontSize: 14, padding: '10px 14px', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', letterSpacing: 2 }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                      Required if adding a new device to an existing account
                    </div>
                  </div>
                  {error && (
                    <div style={{ background: 'var(--danger-dim)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    style={{ width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '12px', fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}
                  >
                    {loading ? <Spinner /> : null}
                    {loading ? 'Registering…' : 'Register with Passkey'}
                  </button>
                </form>
              )}

              {tab === 'recover' && (
                <form onSubmit={handleRecover}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, color: 'var(--text-1)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      style={{ width: '100%', fontSize: 14, padding: '10px 14px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, color: 'var(--text-1)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                      Recovery Code
                    </label>
                    <input
                      type="text"
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      required
                      autoComplete="off"
                      placeholder="Enter your recovery code"
                      style={{ width: '100%', fontSize: 14, padding: '10px 14px', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }}
                    />
                  </div>
                  {error && (
                    <div style={{ background: 'var(--danger-dim)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    style={{ width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '12px', fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}
                  >
                    {loading ? <Spinner /> : null}
                    {loading ? 'Recovering…' : 'Recover Account'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
