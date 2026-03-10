import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { api, type Job } from './api';
import { Badge, Button, Card, Empty, Modal, Spinner } from './components/ui';
import { JobForm } from './components/JobForm';
import { JobDetail, StatusBadge } from './components/JobDetail';

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [editJob, setEditJob] = useState<Job | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await api.getJobs();
      setJobs(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    const id = setInterval(loadJobs, 30000);
    return () => clearInterval(id);
  }, [loadJobs]);

  async function updateJob(data: object) {
    if (!editJob) return;
    await api.updateJob(editJob.id, data);
    await loadJobs();
    setEditJob(null);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
      <Header />
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        <Routes>
          <Route path="/" element={
            <JobList jobs={jobs} loading={loading} loadJobs={loadJobs} editJob={editJob} setEditJob={setEditJob} updateJob={updateJob} />
          } />
          <Route path="/jobs/:id" element={
            <JobDetailRoute jobs={jobs} loading={loading} editJob={editJob} setEditJob={setEditJob} updateJob={updateJob} loadJobs={loadJobs} />
          } />
        </Routes>
      </div>
      <Footer />
      <GlobalStyles />
    </div>
  );
}

function JobDetailRoute({ jobs, loading, editJob, setEditJob, updateJob, loadJobs }: {
  jobs: Job[];
  loading: boolean;
  editJob: Job | null;
  setEditJob: (j: Job | null) => void;
  updateJob: (data: object) => Promise<void>;
  loadJobs: () => Promise<void>;
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [directJob, setDirectJob] = useState<Job | null>(null);

  // If navigated directly to URL and jobs haven't loaded yet, fetch the job
  useEffect(() => {
    if (!loading && jobs.length === 0 && id) return;
    if (jobs.length > 0 || directJob) return;
    if (!id) return;
    api.getJob(id).then(res => setDirectJob(res.data)).catch(() => navigate('/'));
  }, [id, jobs, loading, directJob, navigate]);

  const job = jobs.find(j => j.id === id) ?? directJob;

  if (loading && !job) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spinner /></div>;
  }

  if (!job) {
    return <Empty message="Job not found" />;
  }

  return (
    <>
      <JobDetail
        job={job}
        onEdit={() => setEditJob(job)}
        onBack={() => navigate('/')}
        onJobUpdated={loadJobs}
      />
      {editJob && (
        <Modal title="Edit Job" onClose={() => setEditJob(null)}>
          <JobForm initial={editJob} onSubmit={updateJob} onCancel={() => setEditJob(null)} />
        </Modal>
      )}
    </>
  );
}

function JobList({ jobs, loading, loadJobs, editJob, setEditJob, updateJob }: {
  jobs: Job[];
  loading: boolean;
  loadJobs: () => Promise<void>;
  editJob: Job | null;
  setEditJob: (j: Job | null) => void;
  updateJob: (data: object) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isFiltered = filterStatus !== 'all' || filterType !== 'all' || search !== '';
  const canDrag = !isFiltered;

  async function createJob(data: object) {
    await api.createJob(data);
    await loadJobs();
    setShowCreate(false);
  }

  async function toggleJob(job: Job) {
    if (job.status === 'paused') await api.resumeJob(job.id);
    else await api.pauseJob(job.id);
    await loadJobs();
  }

  async function deleteJob(job: Job) {
    if (!confirm(`Delete "${job.name}"?`)) return;
    await api.deleteJob(job.id);
    await loadJobs();
  }

  const handleDragStart = (index: number) => {
    dragItem.current = index;
    setDragIndex(index);
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
    setDragOverIndex(index);
  };

  const handleDragEnd = async () => {
    const from = dragItem.current;
    const over = dragOverItem.current;
    setDragIndex(null);
    setDragOverIndex(null);
    dragItem.current = null;
    dragOverItem.current = null;

    if (from === null || over === null || from === over) return;

    // Reorder optimistically
    const reordered = [...filtered];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(over, 0, moved);

    // Persist
    await api.reorderJobs(reordered.map(j => j.id));
    await loadJobs();
  };

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

  return (
    <>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 10 }}>
          {filtered.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              onClick={() => navigate(`/jobs/${job.id}`)}
              onEdit={() => setEditJob(job)}
              onToggle={() => toggleJob(job)}
              onDelete={() => deleteJob(job)}
              draggable={canDrag}
              isDragging={dragIndex === index}
              isDragOver={dragOverIndex === index}
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e: React.DragEvent) => e.preventDefault()}
            />
          ))}
        </div>
      )}

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
    </>
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

function statusBorderColor(status: Job['status']): string {
  if (status === 'active') return 'var(--success)';
  if (status === 'error') return 'var(--danger)';
  return 'var(--border)';
}

function JobCard({ job, onClick, onEdit, onToggle, onDelete, draggable, isDragging, isDragOver, onDragStart, onDragEnter, onDragEnd, onDragOver }: {
  job: Job;
  onClick: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      style={{
        opacity: isDragging ? 0.4 : 1,
        borderTop: isDragOver ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'opacity 0.15s',
      }}
    >
      <Card
        onClick={onClick}
        style={{
          padding: '14px',
          cursor: 'pointer',
          borderLeft: `3px solid ${statusBorderColor(job.status)}`,
          borderColor: job.status === 'error'
            ? 'rgba(248,81,73,0.25)'
            : undefined,
          borderLeftColor: statusBorderColor(job.status),
        }}
      >
        {/* Header: drag handle + name + status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            {draggable && (
              <span
                onClick={e => e.stopPropagation()}
                style={{
                  cursor: 'grab', color: 'var(--text-2)', fontSize: 12,
                  userSelect: 'none', flexShrink: 0, lineHeight: 1,
                }}
                title="Drag to reorder"
              >⠿</span>
            )}
            <span style={{
              fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{job.name}</span>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          <Badge variant="muted">{job.collectorConfig.type}</Badge>
          {job.tags.slice(0, 3).map(t => <Badge key={t} variant="muted">{t}</Badge>)}
        </div>

        {/* Schedule */}
        <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
          {job.schedule}
        </div>

        {/* URL */}
        <div style={{
          fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 10,
        }} title={job.collectorConfig.url as string}>
          {(job.collectorConfig.url as string)?.replace(/^https?:\/\//, '').slice(0, 40)}
        </div>

        {/* Footer: last run + actions */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: '1px solid var(--border)', paddingTop: 8,
          }}
        >
          <span style={{ fontSize: 10, color: job.status === 'error' ? 'var(--danger)' : 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
            {job.lastRunAt
              ? `${job.status === 'error' ? 'failed' : 'last'} ${formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })}`
              : 'no runs yet'}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={onToggle}>
              {job.status === 'paused' ? '▶' : '⏸'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>✎</Button>
            <Button size="sm" variant="danger" onClick={onDelete}>✕</Button>
          </div>
        </div>
      </Card>
    </div>
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

function Footer() {
  return (
    <div style={{
      padding: '16px 20px',
      textAlign: 'center',
      color: 'var(--text-2)',
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
    }}>
      192.168.0.45
    </div>
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
