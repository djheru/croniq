import { Link } from 'react-router-dom';
import { useAuth } from '../App';

const features = [
  { symbol: '◈', title: 'Multi-Source Collection', desc: 'RSS feeds, REST APIs, HTML scraping, browser automation, and GraphQL — combine multiple sources per job.' },
  { symbol: '⬡', title: 'AI Analysis on Change', desc: 'Claude Haiku 4.5 via AWS Bedrock analyzes collected data. Content-hash gating skips Bedrock when nothing changed.' },
  { symbol: '◉', title: 'Scheduled Runs', desc: 'Cron expressions power every job. Always-on Pi runs your schedule 24/7 without cloud costs.' },
  { symbol: '⬖', title: 'Passkey Authentication', desc: 'WebAuthn passkeys — Touch ID, Face ID, or security key. No passwords stored anywhere.' },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', color: 'var(--text-0)' }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18 }}>
          <span style={{ color: 'var(--accent)' }}>⬡</span> croniq
        </span>
        <Link to={user ? '/app' : '/auth'} style={{ background: 'var(--accent)', color: '#fff', padding: '8px 20px', borderRadius: 'var(--radius)', fontWeight: 500, fontSize: 14, textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
          {user ? 'Dashboard →' : 'Get Started →'}
        </Link>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '80px 24px 60px' }}>
        <div style={{ display: 'inline-block', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 14px', marginBottom: 28, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)' }}>
          <span style={{ color: 'var(--success)', marginRight: 8 }}>●</span>
          RSS · API · HTML · Browser · GraphQL · Bedrock
        </div>
        <h1 style={{ fontSize: 'clamp(42px, 8vw, 72px)', fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1.1, marginBottom: 20, letterSpacing: '-0.03em' }}>
          Scheduled intelligence<br />
          <span style={{ color: 'var(--accent)' }}>for your Pi</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--text-1)', lineHeight: 1.6, maxWidth: 560, marginBottom: 36 }}>
          Define collection jobs. Combine multiple data sources. Let Claude analyze the results on schedule — only when data actually changes.
        </p>
        <Link to="/auth" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--accent)', color: '#fff', padding: '12px 28px', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: 15, textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
          ☁ Start with a Passkey
        </Link>
      </section>

      {/* Divider */}
      <div style={{ maxWidth: 900, margin: '0 auto 60px', height: 1, background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

      {/* Features */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 80px' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 8 }}>How it works</h2>
        <p style={{ color: 'var(--text-1)', marginBottom: 40 }}>Cost-effective by design — AI only runs when your data changes.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {features.map((f) => (
            <div key={f.title} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '24px' }}>
              <div style={{ fontSize: 22, marginBottom: 12, color: 'var(--accent)' }}>{f.symbol}</div>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 15 }}>{f.title}</div>
              <div style={{ color: 'var(--text-1)', fontSize: 13, lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-2)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        <span>croniq</span>
        <span>WebAuthn · Bedrock · SQLite · Pi</span>
      </footer>
    </div>
  );
}
