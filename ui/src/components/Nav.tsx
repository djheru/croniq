import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { authLogout } from '../api';
import { useState } from 'react';
import PasskeyManager from './PasskeyManager';

interface NavProps {
  passkeyManagerOpen: boolean;
  setPasskeyManagerOpen: (open: boolean) => void;
}

export default function Nav({ passkeyManagerOpen, setPasskeyManagerOpen }: NavProps) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  async function handleLogout() {
    await authLogout();
    await refresh();
    navigate('/');
  }

  return (
    <>
      <div style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 20 }}>
        {/* Logo */}
        <Link to="/app" style={{ textDecoration: 'none', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: 'var(--text-0)' }}>
          <span style={{ color: 'var(--accent)' }}>⬡</span> croniq
        </Link>

        {/* User dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-1)', cursor: 'pointer', padding: '6px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ fontSize: 14 }}>◉</span>
            {user?.email}
            <span style={{ fontSize: 10 }}>▾</span>
          </button>

          {dropdownOpen && (
            <div
              style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 50 }}
              onMouseLeave={() => setDropdownOpen(false)}
            >
              <button
                onClick={() => { setDropdownOpen(false); setPasskeyManagerOpen(true); }}
                style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--text-0)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
              >
                ⬖ Manage passkeys
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
              <button
                onClick={handleLogout}
                style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
              >
                ← Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {passkeyManagerOpen && (
        <PasskeyManager onClose={() => setPasskeyManagerOpen(false)} />
      )}
    </>
  );
}
