import React, { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { api, type Job } from './api';
import { Badge, Button, Card, Empty, Modal, Spinner } from './components/ui';
import { JobForm } from './components/JobForm';
import { JobDetail, StatusBadge } from './components/JobDetail';

type View = { type: 'list' } | { type: 'detail'; job: Job };

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ type: 'list' });
  const [showCreate, setShowCreate] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const loadJobs = useCallback(async () => {
    try {
      const res = await api.getJobs();
      setJobs(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(loadJobs, 30000);
    return () => clearInterval(id);
  }, [loadJobs]);

  async function createJob(data: object) {
    await api.createJob(data);
    await loadJobs();
    setShowCreate(false);
  }

  async function updateJob(data: object) {
    if (!editJob) return;
    await api.updateJob(editJob.id, data);
    await loadJobs();
    setEditJob(null);
  }

  async function toggleJob(job: Job) {
    if (job.status === 'paused') await api.resumeJob(job.id);
    else await api.pauseJob(job.id);
    await loadJobs();
  }

  async function deleteJob(job: Job) {
    if (!confirm(`Delete "${job.name}"?`)) return;
    await api.deleteJob(job.id);
    if (view.type === 'detail' && view.job.id === job.id) setView({ type: 'list' });
    await loadJobs();
  }

  const types = [...new Set(jobs.map(j => j.collectorConfig.type))];

  const filtered = jobs.filter(j => {
    if (filterStatus !== 'all' && j.status !== filterStatus) return false;
    if (filterType !== 'all' && j.collectorConfig.type !== filterType) return false;
    if (search && !j.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: jobs.length,
    active: jobs.filter(j => j.status === 'active').length,
    errors: jobs.filter(j => j.status === 'error').length,
  };

  if (view.type === 'detail') {
    const currentJob = jobs.find(j => j.id === view.job.id) ?? view.job;
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
        <Header />
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
          <JobDetail
            job={currentJob}
            onEdit={() => setEditJob(currentJob)}
            onBack={() => setView({ type: 'list' })}
          />
        </div>
        {editJob && (
          <Modal title="Edit Job" onClose={() => setEditJob(null)}>
            <JobForm initial={editJob} onSubmit={updateJob} onCancel={() => setEditJob(null)} />
          </Modal>
        )}
        <GlobalStyles />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
      <Header />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        {/* Stats bar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Jobs', value: stats.total, color: 'var(--text-0)' },
            { label: 'Active', value: stats.active, color: 'var(--success)' },
            { label: 'Errors', value: stats.errors, color: 'var(--danger)' },
          ].map(s => (
            <Card key={s.label} style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 11, color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</span>
            </Card>
          ))}
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={() => setShowCreate(true)}>+ New Job</Button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs..."
            style={{ width: 220 }}
          />
          <FilterChip label="All" active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
          <FilterChip label="Active" active={filterStatus === 'active'} onClick={() => setFilterStatus('active')} />
          <FilterChip label="Paused" active={filterStatus === 'paused'} onClick={() => setFilterStatus('paused')} />
          <FilterChip label="Error" active={filterStatus === 'error'} onClick={() => setFilterStatus('error')} />
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <FilterChip label="All types" active={filterType === 'all'} onClick={() => setFilterType('all')} />
          {types.map(t => (
            <FilterChip key={t} label={t} active={filterType === t} onClick={() => setFilterType(t)} />
          ))}
        </div>

        {/* Job list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <Empty message={jobs.length === 0 ? "No jobs yet — create your first job to get started" : "No jobs match your filters"} />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map(job => (
              <JobRow
                key={job.id}
                job={job}
                onClick={() => setView({ type: 'detail', job })}
                onEdit={() => setEditJob(job)}
                onToggle={() => toggleJob(job)}
                onDelete={() => deleteJob(job)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="New Job" onClose={() => setShowCreate(false)}>
          <JobForm onSubmit={createJob} onCancel={() => setShowCreate(false)} />
        </Modal>
      )}
      {editJob && (
        <Modal title="Edit Job" onClose={() => setEditJob(null)}>
          <JobForm initial={editJob} onSubmit={updateJob} onCancel={() => setEditJob(null)} />
        </Modal>
      )}

      <GlobalStyles />
    </div>
  );
}

function Header() {
  return (
    <div style={{
      background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
      padding: '0 20px', height: 52,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>
        <span style={{ color: 'var(--accent)' }}>⬡</span> croniq
      </span>
      <span style={{ color: 'var(--text-2)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        scheduled data collection
      </span>
    </div>
  );
}

function JobRow({ job, onClick, onEdit, onToggle, onDelete }: {
  job: Job;
  onClick: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <Card style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }} onClick={onClick}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{job.name}</span>
          <StatusBadge status={job.status} />
          <Badge variant="muted">{job.collectorConfig.type}</Badge>
          {job.tags.slice(0, 3).map(t => <Badge key={t} variant="muted">{t}</Badge>)}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
          <span>⏱ {job.schedule}</span>
          <span title={job.collectorConfig.url as string}>
            🔗 {(job.collectorConfig.url as string)?.replace(/^https?:\/\//, '').slice(0, 40)}
          </span>
          {job.lastRunAt && (
            <span>last: {formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })}</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {job.status === 'paused' ? '▶' : '⏸'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>✎</Button>
        <Button size="sm" variant="danger" onClick={onDelete}>✕</Button>
      </div>
    </Card>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
      background: active ? 'var(--accent-dim)' : 'transparent',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      color: active ? 'var(--accent)' : 'var(--text-1)',
      fontFamily: 'var(--font-mono)',
    }}>
      {label}
    </button>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      @keyframes spin { to { transform: rotate(360deg); } }
      button:hover { opacity: 0.85; }
    `}</style>
  );
}
