import { useState, useEffect, useCallback } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { Modal } from './ui';
import { fetchPasskeys, renamePasskeyApi, deletePasskeyApi, apiFetch, regenerateRecoveryCode, generateDeviceCode, getActiveDeviceCode, type AuthPasskey } from '../api';
import { format } from 'date-fns';

interface PasskeyManagerProps {
  onClose: () => void;
}

export default function PasskeyManager({ onClose }: PasskeyManagerProps) {
  const [passkeys, setPasskeys] = useState<AuthPasskey[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [regeneratedCode, setRegeneratedCode] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [deviceCodeExpiry, setDeviceCodeExpiry] = useState<string | null>(null);
  const [generatingDeviceCode, setGeneratingDeviceCode] = useState(false);
  const [deviceCodeCopied, setDeviceCodeCopied] = useState(false);

  const loadPasskeys = useCallback(async () => {
    try {
      setLoadingPasskeys(true);
      setError(null);
      const keys = await fetchPasskeys();
      setPasskeys(keys);
    } catch (err) {
      setError((err as Error).message);
      setPasskeys([]); // Set empty array on error to prevent undefined access
    } finally {
      setLoadingPasskeys(false);
    }
  }, []);

  useEffect(() => { loadPasskeys(); }, [loadPasskeys]);

  async function handleRename(id: string) {
    try {
      await renamePasskeyApi(id, editingLabel);
      setEditingId(null);
      await loadPasskeys();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this passkey? This cannot be undone.')) return;
    try {
      await deletePasskeyApi(id);
      await loadPasskeys();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddPasskey() {
    setAddingPasskey(true);
    setError(null);
    try {
      const optionsData = await apiFetch<Record<string, unknown>>('/api/passkeys', { method: 'POST' });
      const attResp = await startRegistration({ optionsJSON: optionsData as unknown as PublicKeyCredentialCreationOptionsJSON });
      await apiFetch('/api/passkeys/verify', { method: 'POST', body: JSON.stringify(attResp) });
      await loadPasskeys();
    } catch (err) {
      const e = err as Error;
      if (e.name === 'NotAllowedError') setError('Ceremony cancelled — try again.');
      else setError(e.message);
    } finally {
      setAddingPasskey(false);
    }
  }

  async function handleRegenerateCode() {
    setRegenerating(true);
    setError(null);
    try {
      const result = await regenerateRecoveryCode();
      setRegeneratedCode(result.recoveryCode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  async function copyCode() {
    if (!regeneratedCode) return;
    await navigator.clipboard.writeText(regeneratedCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  async function handleGenerateDeviceCode() {
    setGeneratingDeviceCode(true);
    setError(null);
    try {
      const result = await generateDeviceCode();
      setDeviceCode(result.code);
      setDeviceCodeExpiry(result.expiresAt);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingDeviceCode(false);
    }
  }

  async function copyDeviceCode() {
    if (!deviceCode) return;
    await navigator.clipboard.writeText(deviceCode);
    setDeviceCodeCopied(true);
    setTimeout(() => setDeviceCodeCopied(false), 2000);
  }

  useEffect(() => {
    async function checkActiveCode() {
      try {
        const result = await getActiveDeviceCode();
        if (result.code) {
          setDeviceCode(result.code);
          setDeviceCodeExpiry(result.expiresAt);
        }
      } catch {
        // Ignore errors
      }
    }
    checkActiveCode();
  }, []);

  function formatDate(dateStr: string | null) {
    if (!dateStr) return 'never';
    try {
      return format(new Date(dateStr), 'MMM d, yyyy');
    } catch {
      return dateStr;
    }
  }

  return (
    <Modal title="Manage Passkeys" onClose={onClose}>
      <div style={{ minWidth: 400, maxWidth: 540 }}>
        {error && (
          <div style={{ background: 'var(--danger-dim)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
            {error}
          </div>
        )}

        {/* Passkeys list */}
        <div style={{ marginBottom: 20 }}>
          {loadingPasskeys ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-1)', fontSize: 13 }}>Loading…</div>
          ) : !passkeys || passkeys.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-2)', fontSize: 13 }}>No passkeys found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {passkeys.map((pk, i) => (
                <div key={pk.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 16, color: 'var(--accent)', flexShrink: 0 }}>
                        {pk.deviceType === 'multiDevice' ? '◉' : '○'}
                      </span>
                      {editingId === pk.id ? (
                        <input
                          autoFocus
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onBlur={() => handleRename(pk.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(pk.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          style={{ flex: 1, fontSize: 14, padding: '4px 8px', fontFamily: 'var(--font-sans)' }}
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingId(pk.id); setEditingLabel(pk.label ?? `Passkey ${i + 1}`); }}
                          style={{ fontSize: 14, fontWeight: 500, cursor: 'text', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title="Click to rename"
                        >
                          {pk.label ?? `Passkey ${i + 1}`}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(pk.id)}
                      disabled={(passkeys?.length ?? 0) <= 1}
                      style={{ background: 'none', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 'var(--radius)', color: (passkeys?.length ?? 0) <= 1 ? 'var(--text-2)' : 'var(--danger)', cursor: (passkeys?.length ?? 0) <= 1 ? 'not-allowed' : 'pointer', padding: '4px 10px', fontSize: 12, flexShrink: 0 }}
                      title={(passkeys?.length ?? 0) <= 1 ? 'Cannot delete the only passkey' : 'Delete passkey'}
                    >
                      Delete
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                    <span>Added: {formatDate(pk.createdAt)}</span>
                    <span>Last used: {formatDate(pk.lastUsedAt)}</span>
                    {pk.backedUp && <span style={{ color: 'var(--success)' }}>● synced</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={handleAddPasskey}
            disabled={addingPasskey}
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', color: 'var(--accent)', cursor: addingPasskey ? 'not-allowed' : 'pointer', padding: '10px 16px', fontSize: 13, fontWeight: 500, textAlign: 'left', opacity: addingPasskey ? 0.7 : 1 }}
          >
            {addingPasskey ? '⏳ Adding passkey…' : '+ Add another passkey'}
          </button>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* Device code section */}
          <div>
            {deviceCode ? (
              <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border-bright)', borderRadius: 'var(--radius)', padding: '16px' }}>
                <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 8, fontWeight: 500 }}>🔐 Device code for new device</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
                  Use this code on your new device during registration. Expires in 5 minutes.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600, color: 'var(--accent)', flex: 1, letterSpacing: 2 }}>
                    {deviceCode}
                  </code>
                  <button
                    onClick={copyDeviceCode}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '5px 10px', color: deviceCodeCopied ? 'var(--success)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0 }}
                  >
                    {deviceCodeCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  onClick={() => { setDeviceCode(null); setDeviceCodeExpiry(null); }}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-1)', cursor: 'pointer', padding: '8px 14px', fontSize: 13, width: '100%' }}
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <button
                onClick={handleGenerateDeviceCode}
                disabled={generatingDeviceCode}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-1)', cursor: generatingDeviceCode ? 'not-allowed' : 'pointer', padding: '10px 16px', fontSize: 13, textAlign: 'left', width: '100%', opacity: generatingDeviceCode ? 0.7 : 1 }}
              >
                {generatingDeviceCode ? 'Generating…' : '📱 Generate code for new device'}
              </button>
            )}
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* Recovery code section */}
          <div>
            {regeneratedCode ? (
              <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border-bright)', borderRadius: 'var(--radius)', padding: '16px' }}>
                <div style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 8, fontWeight: 500 }}>⚠ New recovery code — save it now</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', flex: 1, wordBreak: 'break-all' }}>
                    {regeneratedCode}
                  </code>
                  <button
                    onClick={copyCode}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '5px 10px', color: codeCopied ? 'var(--success)' : 'var(--text-1)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0 }}
                  >
                    {codeCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  onClick={() => setRegeneratedCode(null)}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-1)', cursor: 'pointer', padding: '8px 14px', fontSize: 13, width: '100%' }}
                >
                  I've saved it
                </button>
              </div>
            ) : (
              <button
                onClick={handleRegenerateCode}
                disabled={regenerating}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-1)', cursor: regenerating ? 'not-allowed' : 'pointer', padding: '10px 16px', fontSize: 13, textAlign: 'left', width: '100%', opacity: regenerating ? 0.7 : 1 }}
              >
                {regenerating ? 'Regenerating…' : '⟳ Regenerate recovery code'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
