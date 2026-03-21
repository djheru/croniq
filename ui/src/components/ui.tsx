import React from 'react';

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'danger' | 'warning' | 'accent' | 'muted' | 'changed';

export function Badge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }) {
  const colors: Record<BadgeVariant, { bg: string; color: string }> = {
    success: { bg: 'var(--success-dim)', color: 'var(--success)' },
    danger:  { bg: 'var(--danger-dim)',  color: 'var(--danger)' },
    warning: { bg: 'var(--warning-dim)', color: 'var(--warning)' },
    accent:  { bg: 'var(--accent-dim)',  color: 'var(--accent)' },
    muted:   { bg: 'var(--bg-3)',        color: 'var(--text-1)' },
    changed: { bg: 'var(--changed-dim)', color: 'var(--changed)' },
  };
  const c = colors[variant];
  return (
    <span style={{
      background: c.bg, color: c.color,
      padding: '4px 10px', borderRadius: 5, fontSize: 13,
      fontFamily: 'var(--font-mono)', fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'ghost', size = 'md', style, children, ...props }: ButtonProps) {
  const base: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: size === 'sm' ? '8px 14px' : '10px 18px',
    fontSize: size === 'sm' ? 14 : 15,
    minHeight: size === 'sm' ? 38 : 44,
  };
  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' },
    ghost:   { background: 'transparent', color: 'var(--text-0)' },
    danger:  { background: 'var(--danger-dim)', borderColor: 'var(--danger)', color: 'var(--danger)' },
    success: { background: 'var(--success-dim)', borderColor: 'var(--success)', color: 'var(--success)' },
  };
  return (
    <button style={{ ...base, ...variants[variant], ...style }} {...props}>
      {children}
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--bg-1)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 14, height: 14,
      border: '2px solid var(--border-bright)',
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    }} />
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-2)', border: '1px solid var(--border)',
        borderRadius: 10, width: '100%', maxWidth: 680,
        maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-1)',
            cursor: 'pointer', fontSize: 20, lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function Empty({ message }: { message: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '60px 20px',
      color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 13,
    }}>
      {message}
    </div>
  );
}
