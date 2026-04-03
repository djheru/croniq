import { format, formatDistanceToNow } from "date-fns";
import React, { useEffect, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Job, type Run } from "../api";
import { Badge, Button, Card, Empty, Spinner } from "./ui";

function runStatusVariant(s: string): 'success' | 'danger' | 'warning' | 'accent' | 'muted' {
  if (s === 'complete') return 'success';
  if (s === 'error') return 'danger';
  if (s === 'skipped') return 'warning';
  if (s === 'collecting' || s === 'analyzing') return 'accent';
  return 'muted'; // pending
}

function AnalysisMarkdown({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: (({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        )) as Components['a'],
      }}
    >
      {content}
    </Markdown>
  );
}

function CollapsibleJson({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13, padding: '0 0 8px', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <span>{open ? '▾' : '▸'}</span> Raw data
      </button>
      {open && (
        <pre
          style={{
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 400,
            overflow: "auto",
            background: "var(--bg-3)",
            borderRadius: "var(--radius)",
            padding: "14px",
            color: "var(--text-1)",
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function JobDetail({
  job,
  onEdit,
  onBack,
  onJobUpdated,
}: {
  job: Job;
  onEdit: () => void;
  onBack: () => void;
  onJobUpdated?: () => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [runsListExpanded, setRunsListExpanded] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState(job.schedule);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [cloning, setCloning] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getRuns(job.id);
      setRuns(res.data);
      if (!selectedRun && res.data.length > 0) {
        setSelectedRun(res.data[0]);
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
      alert(err instanceof Error ? err.message : "Failed to update schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  useEffect(() => {
    load();
  }, [job.id]);

  async function trigger() {
    setTriggering(true);
    try {
      await api.runJob(job.id);
      setTimeout(load, 2000);
    } finally {
      setTriggering(false);
    }
  }

  async function clone() {
    setCloning(true);
    try {
      await api.createJob({
        name: `Copy of ${job.name}`,
        description: job.description,
        schedule: job.schedule,
        sources: job.sources,
        outputFormat: job.outputFormat,
        tags: job.tags,
        notifyOnChange: job.notifyOnChange,
        webhookUrl: job.webhookUrl || undefined,
        jobPrompt: job.jobPrompt,
        jobParams: job.jobParams,
        retries: job.retries,
        timeoutMs: job.timeoutMs,
      });
      onJobUpdated?.();
      onBack();
    } catch (err) {
      console.error("Failed to clone job:", err);
      alert("Failed to clone job");
    } finally {
      setCloning(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-1)",
            cursor: "pointer",
            fontSize: 22,
            padding: "0 4px",
            minHeight: 44,
            minWidth: 44,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 600 }}>{job.name}</h2>
            <StatusBadge status={job.status} />
            {job.sources.length > 1 ? (
              <Badge variant="muted">{job.sources.length} sources</Badge>
            ) : (
              <Badge variant="muted">
                {job.sources[0]?.config.type ?? "unknown"}
              </Badge>
            )}
            {job.tags.map((t) => (
              <Badge key={t} variant="muted">
                {t}
              </Badge>
            ))}
          </div>
          {job.description && (
            <p style={{ color: "var(--text-1)", fontSize: 14, marginTop: 4 }}>
              {job.description}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="sm"
            onClick={trigger}
            disabled={triggering}
            variant="ghost"
          >
            {triggering ? <Spinner /> : "▶"} Run now
          </Button>
          <Button size="sm" onClick={clone} disabled={cloning} variant="ghost">
            {cloning ? <Spinner /> : "⎘"} Clone
          </Button>
          <Button size="sm" onClick={onEdit} variant="ghost">
            ✎ Edit
          </Button>
        </div>
      </div>

      {/* Schedule card */}
      <div style={{ marginBottom: 24 }}>
        <Card
          style={{
            padding: "14px 18px",
            cursor: editingSchedule ? "default" : "pointer",
            display: "inline-block",
            minWidth: 200,
          }}
          onClick={() => {
            if (!editingSchedule) {
              setScheduleInput(job.schedule);
              setEditingSchedule(true);
            }
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--text-1)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            Schedule{" "}
            {!editingSchedule && (
              <span style={{ fontSize: 10, opacity: 0.6 }}>✎</span>
            )}
          </div>
          {editingSchedule ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                autoFocus
                value={scheduleInput}
                onChange={(e) => setScheduleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveSchedule();
                  if (e.key === "Escape") setEditingSchedule(false);
                }}
                style={{
                  flex: 1,
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-0)",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--radius)",
                  padding: "6px 10px",
                  color: "var(--text-0)",
                  width: "100%",
                }}
                disabled={savingSchedule}
              />
              <button
                onClick={saveSchedule}
                disabled={savingSchedule}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--success)",
                  cursor: "pointer",
                  fontSize: 18,
                  padding: 4,
                  minHeight: 36,
                  minWidth: 36,
                }}
              >
                ✓
              </button>
              <button
                onClick={() => setEditingSchedule(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-2)",
                  cursor: "pointer",
                  fontSize: 18,
                  padding: 4,
                  minHeight: 36,
                  minWidth: 36,
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
              }}
            >
              {job.schedule}
            </div>
          )}
        </Card>
      </div>

      {/* Run History */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: runsListExpanded ? "1fr 3fr" : "auto 1fr",
          gap: 20,
        }}
      >
        {/* Runs list */}
        <Card>
          <div
            style={{
              padding: "4px 12px",
              borderBottom: "1px solid var(--border)",
              fontSize: 15,
              color: "var(--text-1)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            {runsListExpanded && <span>Runs</span>}
            <button
              onClick={() => setRunsListExpanded(!runsListExpanded)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-1)",
                cursor: "pointer",
                fontSize: 16,
                padding: 6,
                minHeight: 40,
                minWidth: 40,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={
                runsListExpanded ? "Collapse runs list" : "Expand runs list"
              }
            >
              {runsListExpanded ? "<" : ">"}
            </button>
          </div>
          {runsListExpanded &&
            (loading ? (
              <div style={{ padding: 20, textAlign: "center" }}>
                <Spinner />
              </div>
            ) : runs.length === 0 ? (
              <Empty message="No runs yet" />
            ) : (
              <div>
                {runs.map((run) => (
                  <div
                    key={run.id}
                    onClick={() =>
                      setSelectedRun(selectedRun?.id === run.id ? null : run)
                    }
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border)",
                      background:
                        selectedRun?.id === run.id
                          ? "var(--bg-3)"
                          : "transparent",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 6,
                      }}
                    >
                      <Badge variant={runStatusVariant(run.status)}>
                        {run.status}
                      </Badge>
                      {run.changed && (
                        <Badge variant="changed">changed</Badge>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 11,
                          color: "var(--text-1)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {formatDistanceToNow(new Date(run.startedAt), {
                          addSuffix: true,
                        })}
                      </span>
                      {run.durationMs ? (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--text-2)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {run.durationMs}ms
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </Card>

        {/* Run detail */}
        <Card>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              fontSize: 15,
              color: "var(--text-1)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {selectedRun
              ? `Run Detail — ${format(new Date(selectedRun.startedAt), "MMM d, HH:mm:ss")}`
              : "Select a run"}
          </div>
          {selectedRun ? (
            <div style={{ padding: 18 }}>
              {/* Status + meta row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <Badge variant={runStatusVariant(selectedRun.status)}>
                  {selectedRun.status}
                </Badge>
                {selectedRun.changed && (
                  <Badge variant="changed">changed</Badge>
                )}
                {selectedRun.durationMs ? (
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                    {selectedRun.durationMs}ms
                  </span>
                ) : null}
                {selectedRun.contentHash && (
                  <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                    #{selectedRun.contentHash.slice(0, 8)}
                  </span>
                )}
              </div>

              {/* Token usage row */}
              {(selectedRun.inputTokens > 0 || selectedRun.outputTokens > 0) && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
                  <span>in: {selectedRun.inputTokens.toLocaleString()} tokens</span>
                  <span>out: {selectedRun.outputTokens.toLocaleString()} tokens</span>
                  {selectedRun.bedrockInvoked && (
                    <span style={{ color: 'var(--accent)' }}>● bedrock</span>
                  )}
                </div>
              )}

              {/* Timing row */}
              {selectedRun.finishedAt && (
                <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 14 }}>
                  {format(new Date(selectedRun.startedAt), 'HH:mm:ss')} → {format(new Date(selectedRun.finishedAt), 'HH:mm:ss')}
                </div>
              )}

              {selectedRun.error ? (
                <RunError error={selectedRun.error} />
              ) : (
                <div>
                  {/* Analysis (editor output) */}
                  {selectedRun.analysis ? (
                    <div style={{ marginBottom: 16 }}>
                      <div className="analysis-markdown">
                        <AnalysisMarkdown content={selectedRun.analysis} />
                      </div>
                    </div>
                  ) : null}

                  {/* Raw data (collapsible) */}
                  {selectedRun.rawData != null ? (
                    <CollapsibleJson data={selectedRun.rawData} />
                  ) : null}
                </div>
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

function RunError({ error }: { error: string }) {
  const lines = error.split("\n");
  const mainError = lines[0];
  const diagLines = lines.filter((l) => l.startsWith("[diag]"));
  const otherLines = lines.slice(1).filter((l) => !l.startsWith("[diag]"));

  return (
    <div>
      <div
        style={{
          color: "var(--danger)",
          fontSize: 16,
          fontWeight: 500,
          marginBottom: 10,
          fontFamily: "var(--font-mono)",
        }}
      >
        {mainError}
      </div>
      {diagLines.length > 0 && (
        <div
          style={{
            background: "var(--bg-3)",
            borderRadius: "var(--radius)",
            padding: "12px 16px",
            marginBottom: 10,
            borderLeft: "3px solid var(--warning)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--warning)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              marginBottom: 8,
              letterSpacing: "0.05em",
              fontWeight: 500,
            }}
          >
            Diagnostics
          </div>
          {diagLines.map((line, i) => (
            <div
              key={i}
              style={{
                fontSize: 14,
                color: "var(--text-0)",
                fontFamily: "var(--font-mono)",
                lineHeight: 1.6,
              }}
            >
              {line.replace("[diag] ", "")}
            </div>
          ))}
        </div>
      )}
      {otherLines.length > 0 && (
        <pre
          style={{
            fontSize: 13,
            color: "var(--text-1)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "var(--font-mono)",
          }}
        >
          {otherLines.join("\n")}
        </pre>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: Job["status"] }) {
  const v =
    status === "active" ? "success" : status === "error" ? "danger" : "muted";
  return <Badge variant={v}>{status}</Badge>;
}
