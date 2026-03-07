import React, { useEffect, useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { api, type Job, type Run, type RunStats } from '../api';
import { Badge, Button, Card, Empty, Spinner } from './ui';

function outcomeVariant(o: string): 'success' | 'danger' | 'warning' {
  if (o === 'success') return 'success';
  if (o === 'timeout') return 'warning';
  return 'danger';
}

export function JobDetail({ job, onEdit, onBack }: {
  job: Job;
  onEdit: () => void;
  onBack: () => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getRuns(job.id);
      setRuns(res.data);
      setStats(res.stats);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [job.id]);

  async function trigger() {
    setTriggering(true);
    try {
      await api.runJob(job.id);
      setTimeout(load, 2000);
    } finally {
      setTriggering(false);
    }
  }

  const successRate = stats ? Math.round((stats.success / (stats.total || 1)) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: 'var(--text-1)',
          cursor: 'pointer', fontSize: 18, padding: '0 4px',
        }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{job.name}</h2>
            <StatusBadge status={job.status} />
            <Badge variant="muted">{job.collectorConfig.type}</Badge>
            {job.tags.map(t => <Badge key={t} variant="muted">{t}</Badge>)}
          </div>
          {job.description && (
            <p style={{ color: 'var(--text-1)', fontSize: 13, marginTop: 2 }}>{job.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={trigger} disabled={triggering} variant="ghost">
            {triggering ? <Spinner /> : '▶'} Run now
          </Button>
          <Button size="sm" onClick={onEdit} variant="ghost">✎ Edit</Button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Runs', value: stats.total },
            { label: 'Success Rate', value: `${successRate}%` },
            { label: 'Avg Duration', value: `${stats.avgDurationMs}ms` },
            { label: 'Schedule', value: job.schedule },
          ].map(s => (
            <Card key={s.label} style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{s.value}</div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Runs list */}
        <Card>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
            Run History
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center' }}><Spinner /></div>
          ) : runs.length === 0 ? (
            <Empty message="No runs yet" />
          ) : (
            <div style={{ maxHeight: 460, overflow: 'auto' }}>
              {runs.map(run => (
                <div key={run.id}
                  onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}
                  style={{
                    padding: '10px 16px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    background: selectedRun?.id === run.id ? 'var(--bg-3)' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                  <Badge variant={outcomeVariant(run.outcome)}>{run.outcome}</Badge>
                  {run.changed && <Badge variant="changed">changed</Badge>}
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>
                    {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                  </span>
                  {run.durationMs && (
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                      {run.durationMs}ms
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Run detail */}
        <Card>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
            {selectedRun ? `Run Detail — ${format(new Date(selectedRun.startedAt), 'MMM d, HH:mm:ss')}` : 'Select a run'}
          </div>
          {selectedRun ? (
            <div style={{ padding: 16, maxHeight: 460, overflow: 'auto' }}>
              {selectedRun.error ? (
                <pre style={{ color: 'var(--danger)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {selectedRun.error}
                </pre>
              ) : (
                <pre style={{ fontSize: 11, color: 'var(--text-0)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)' }}>
                  {JSON.stringify(selectedRun.result, null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <Empty message="← Select a run to view its result" />
          )}
        </Card>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: Job['status'] }) {
  const v = status === 'active' ? 'success' : status === 'error' ? 'danger' : 'muted';
  return <Badge variant={v}>{status}</Badge>;
}
