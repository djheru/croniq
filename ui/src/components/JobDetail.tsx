import React, { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Job, type Run, type RunStats, type Analysis } from '../api';
import { Badge, Button, Card, Empty, Spinner } from './ui';

function outcomeVariant(o: string): 'success' | 'danger' | 'warning' {
  if (o === 'success') return 'success';
  if (o === 'timeout') return 'warning';
  return 'danger';
}

export function JobDetail({ job, onEdit, onBack, onJobUpdated }: {
  job: Job;
  onEdit: () => void;
  onBack: () => void;
  onJobUpdated?: () => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [runsExpanded, setRunsExpanded] = useState(!job.analysisPrompt);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState(job.schedule);
  const [savingSchedule, setSavingSchedule] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getRuns(job.id);
      setRuns(res.data);
      setStats(res.stats);
      if (job.analysisPrompt) {
        const analysisRes = await api.getAnalyses(job.id);
        setAnalyses(analysisRes.data);
        if (analysisRes.data.length > 0) {
          setSelectedAnalysis((prev: Analysis | null) => prev ?? analysisRes.data[0]);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const saveSchedule = async () => {
    if (scheduleInput === job.schedule) {
      setEditingSchedule(false);
      return;
    }
    setSavingSchedule(true);
    try {
      await api.updateJob(job.id, { schedule: scheduleInput });
      setEditingSchedule(false);
      onJobUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

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

  async function triggerAnalysis() {
    setAnalyzing(true);
    try {
      await api.triggerAnalysis(job.id);
      setTimeout(load, 5000);
    } finally {
      setAnalyzing(false);
    }
  }

  const successRate = stats ? Math.round((stats.success / (stats.total || 1)) * 100) : 0;
  const hasAnalysis = !!job.analysisPrompt;

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
          ].map(s => (
            <Card key={s.label} style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{s.value}</div>
            </Card>
          ))}
          <Card
            style={{ padding: '12px 16px', cursor: editingSchedule ? 'default' : 'pointer' }}
            onClick={() => { if (!editingSchedule) { setScheduleInput(job.schedule); setEditingSchedule(true); } }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Schedule {!editingSchedule && <span style={{ fontSize: 9, opacity: 0.5 }}>✎</span>}
            </div>
            {editingSchedule ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  autoFocus
                  value={scheduleInput}
                  onChange={e => setScheduleInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveSchedule();
                    if (e.key === 'Escape') setEditingSchedule(false);
                  }}
                  style={{
                    flex: 1, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    background: 'var(--bg-0)', border: '1px solid var(--accent)',
                    borderRadius: 'var(--radius)', padding: '4px 8px', color: 'var(--text-0)',
                    width: '100%',
                  }}
                  disabled={savingSchedule}
                />
                <button onClick={saveSchedule} disabled={savingSchedule} style={{
                  background: 'none', border: 'none', color: 'var(--success)', cursor: 'pointer', fontSize: 16, padding: 0,
                }}>✓</button>
                <button onClick={() => setEditingSchedule(false)} style={{
                  background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: 16, padding: 0,
                }}>✕</button>
              </div>
            ) : (
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{job.schedule}</div>
            )}
          </Card>
        </div>
      )}

      {/* Analysis section — shown first when present */}
      {hasAnalysis && (
        <div style={{ marginBottom: 20 }}>
          <Card>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                LLM Analysis
              </span>
              <Button size="sm" variant="ghost" onClick={triggerAnalysis} disabled={analyzing}>
                {analyzing ? <Spinner /> : '⚡'} Analyze now
              </Button>
            </div>

            {analyses.length === 0 ? (
              <Empty message="No analyses yet — waiting for scheduled run or trigger manually" />
            ) : (
              <div>
                {/* Analysis selector */}
                <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  {analyses.slice(0, 10).map(a => (
                    <button key={a.id} onClick={() => setSelectedAnalysis(a)} style={{
                      padding: '3px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
                      background: selectedAnalysis?.id === a.id ? 'var(--accent-dim)' : 'transparent',
                      border: `1px solid ${selectedAnalysis?.id === a.id ? 'var(--accent)' : 'var(--border)'}`,
                      color: selectedAnalysis?.id === a.id ? 'var(--accent)' : 'var(--text-1)',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {format(new Date(a.createdAt), 'MMM d, HH:mm')}
                    </button>
                  ))}
                </div>

                {/* Analysis content */}
                <div style={{ padding: 16, maxHeight: 500, overflow: 'auto' }}>
                  {(selectedAnalysis ?? analyses[0]) && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                        {(selectedAnalysis ?? analyses[0]).durationMs}ms
                        {' \u00b7 '}
                        {(selectedAnalysis ?? analyses[0]).runIds.length} runs analyzed
                      </div>
                      <div className="analysis-markdown">
                        <Markdown
                          remarkPlugins={[remarkGfm]}
                          components={{ a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                          )}}
                        >{(selectedAnalysis ?? analyses[0]).response}</Markdown>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Run History — collapsible when analysis is present */}
      <CollapsibleSection
        title="Run History"
        expanded={runsExpanded}
        onToggle={() => setRunsExpanded(!runsExpanded)}
        collapsible={hasAnalysis}
        count={runs.length}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Runs list */}
          <Card>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              Runs
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
              <div style={{ maxHeight: 460, overflow: 'auto' }}>
                {selectedRun.error ? (
                  <div style={{ padding: 16 }}>
                    <RunError error={selectedRun.error} />
                  </div>
                ) : (
                  <RunDetailPanel result={selectedRun.result} />
                )}
              </div>
            ) : (
              <Empty message="← Select a run to view its result" />
            )}
          </Card>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function CollapsibleSection({ title, expanded, onToggle, collapsible, count, children }: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  collapsible: boolean;
  count: number;
  children: React.ReactNode;
}) {
  if (!collapsible) {
    return <>{children}</>;
  }

  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', color: 'var(--text-1)',
          cursor: 'pointer', padding: '8px 0', marginBottom: expanded ? 12 : 0,
          fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase',
          letterSpacing: '0.05em', width: '100%',
        }}
      >
        <span style={{
          display: 'inline-block', transition: 'transform 0.15s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 10,
        }}>▶</span>
        {title}
        <Badge variant="muted">{count}</Badge>
      </button>
      {expanded && children}
    </div>
  );
}

function RunDetailPanel({ result }: { result?: unknown }) {
  const [replInput, setReplInput] = useState('');
  const [replOutput, setReplOutput] = useState<string | null>(null);
  const [replError, setReplError] = useState<string | null>(null);
  const [showRepl, setShowRepl] = useState(false);

  const runExpression = useCallback(() => {
    if (!replInput.trim()) return;
    setReplError(null);
    setReplOutput(null);
    try {
      // data is the run result, available in the expression
      const fn = new Function('data', `return ${replInput}`);
      const output = fn(result);
      setReplOutput(JSON.stringify(output, null, 2));
    } catch (err) {
      setReplError(err instanceof Error ? err.message : String(err));
    }
  }, [replInput, result]);

  return (
    <div>
      {/* Raw result */}
      <pre style={{
        fontSize: 11, color: 'var(--text-0)', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', fontFamily: 'var(--font-mono)',
        padding: 16, margin: 0,
      }}>
        {JSON.stringify(result, null, 2)}
      </pre>

      {/* REPL toggle */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => setShowRepl(!showRepl)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', color: 'var(--accent)',
            cursor: 'pointer', padding: '8px 16px',
            fontFamily: 'var(--font-mono)', fontSize: 11,
          }}
        >
          <span style={{ fontSize: 10 }}>{showRepl ? '▼' : '▶'}</span>
          JS Console
        </button>

        {showRepl && (
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
              <code>data</code> = run result. Write any JS expression.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={replInput}
                onChange={e => setReplInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runExpression(); }}
                placeholder="data.prices.length"
                style={{
                  flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-0)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '6px 10px',
                  color: 'var(--text-0)',
                }}
              />
              <Button size="sm" variant="ghost" onClick={runExpression}>Run</Button>
            </div>
            {replOutput !== null && (
              <pre style={{
                marginTop: 8, padding: 10, background: 'var(--bg-0)',
                borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-mono)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto',
              }}>
                {replOutput}
              </pre>
            )}
            {replError && (
              <pre style={{
                marginTop: 8, padding: 10, background: 'var(--bg-0)',
                borderRadius: 'var(--radius)', border: '1px solid var(--danger-dim, var(--border))',
                fontSize: 11, color: 'var(--danger)', fontFamily: 'var(--font-mono)',
                whiteSpace: 'pre-wrap',
              }}>
                {replError}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RunError({ error }: { error: string }) {
  const lines = error.split('\n');
  const mainError = lines[0];
  const diagLines = lines.filter(l => l.startsWith('[diag]'));
  const otherLines = lines.slice(1).filter(l => !l.startsWith('[diag]'));

  return (
    <div>
      <div style={{
        color: 'var(--danger)', fontSize: 13, fontWeight: 500, marginBottom: 8,
        fontFamily: 'var(--font-mono)',
      }}>
        {mainError}
      </div>
      {diagLines.length > 0 && (
        <div style={{
          background: 'var(--bg-3)', borderRadius: 'var(--radius)', padding: '10px 14px',
          marginBottom: 8, borderLeft: '3px solid var(--warning)',
        }}>
          <div style={{ fontSize: 10, color: 'var(--warning)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>
            Diagnostics
          </div>
          {diagLines.map((line, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-0)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
              {line.replace('[diag] ', '')}
            </div>
          ))}
        </div>
      )}
      {otherLines.length > 0 && (
        <pre style={{ fontSize: 11, color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)' }}>
          {otherLines.join('\n')}
        </pre>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: Job['status'] }) {
  const v = status === 'active' ? 'success' : status === 'error' ? 'danger' : 'muted';
  return <Badge variant={v}>{status}</Badge>;
}
