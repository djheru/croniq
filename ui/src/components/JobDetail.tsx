import { format, formatDistanceToNow } from "date-fns";
import React, { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Job, type Run, type RunStage, type RunStats } from "../api";
import { Badge, Button, Card, Empty, Spinner } from "./ui";

function outcomeVariant(o: string): "success" | "danger" | "warning" {
  if (o === "success") return "success";
  if (o === "timeout") return "warning";
  return "danger";
}

function StageBadge({ status }: { status: "success" | "error" | "skipped" }) {
  const config = {
    success: {
      label: "success",
      color: "var(--success)",
      bg: "rgba(63,185,80,0.1)",
    },
    error: {
      label: "error",
      color: "var(--danger)",
      bg: "rgba(248,81,73,0.1)",
    },
    skipped: { label: "skipped", color: "var(--text-2)", bg: "var(--bg-2)" },
  }[status];

  return (
    <span
      style={{
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        padding: "3px 8px",
        borderRadius: 4,
        color: config.color,
        background: config.bg,
        fontWeight: 500,
      }}
    >
      {config.label}
    </span>
  );
}

function StagePanel({
  stage,
  children,
}: {
  stage: RunStage;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card style={{ marginBottom: 10 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontFamily: "var(--font-mono)" }}>
            {open ? "▾" : "▸"}
          </span>
          <span
            style={{
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              textTransform: "capitalize",
              fontWeight: 500,
            }}
          >
            {stage.stage}
          </span>
          <StageBadge status={stage.status} />
        </div>
        <span
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {stage.durationMs ? `${(stage.durationMs / 1000).toFixed(1)}s` : ""}
          {stage.tokenCount
            ? ` · ${stage.tokenCount.toLocaleString()} tokens`
            : ""}
        </span>
      </div>
      {open && (
        <div
          style={{
            padding: "0 14px 14px",
            borderTop: "1px solid var(--border)",
          }}
        >
          {stage.status === "error" && (
            <div
              style={{
                padding: "8px 10px",
                marginTop: 10,
                background: "rgba(248,81,73,0.08)",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--danger)",
              }}
            >
              {stage.errorType}: {stage.error}
            </div>
          )}
          <div style={{ marginTop: 10 }}>{children}</div>
        </div>
      )}
    </Card>
  );
}

function CollectorPanel({ data }: { data: unknown }) {
  const [expr, setExpr] = useState("");
  const [replOutput, setReplOutput] = useState("");

  const evalExpression = (input: string) => {
    try {
      // Safe property-access evaluator — supports dot paths and bracket indexing
      // e.g. "data.items[0].title", "data.rawData.length"
      const result = input.split(".").reduce(
        (curr: unknown, segment: string) => {
          if (curr == null) return undefined;
          // Handle bracket notation like items[0]
          const bracketMatch = segment.match(/^(\w+)\[(\d+)\]$/);
          if (bracketMatch) {
            const obj = (curr as Record<string, unknown>)[bracketMatch[1]];
            return Array.isArray(obj)
              ? obj[Number(bracketMatch[2])]
              : undefined;
          }
          return (curr as Record<string, unknown>)[segment];
        },
        { data } as Record<string, unknown>,
      );
      setReplOutput(JSON.stringify(result, null, 2));
    } catch (e) {
      setReplOutput(String(e));
    }
  };

  return (
    <div>
      <pre
        style={{
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 300,
          overflow: "auto",
          marginBottom: 10,
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") evalExpression(expr);
          }}
          placeholder="data.items[0].title"
          style={{
            flex: 1,
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            padding: "8px 12px",
          }}
        />
      </div>
      {replOutput && (
        <pre
          style={{
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            color: "var(--accent)",
            marginTop: 6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {replOutput}
        </pre>
      )}
    </div>
  );
}

function SummaryView({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const summary = data as {
    title?: string;
    overallSummary?: string;
    items?: Array<{
      headline: string;
      summary: string;
      url?: string;
      relevance: string;
    }>;
  };

  return (
    <div>
      {summary.overallSummary && (
        <p style={{ fontSize: 14, color: "var(--text-1)", marginBottom: 12 }}>
          {summary.overallSummary}
        </p>
      )}
      {summary.items?.map((item, i) => (
        <div
          key={i}
          style={{
            padding: "10px 0",
            borderBottom:
              i < (summary.items?.length ?? 0) - 1
                ? "1px solid var(--border)"
                : undefined,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <Badge variant={item.relevance === "high" ? "accent" : "muted"}>
              {item.relevance}
            </Badge>
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.headline}
                </a>
              ) : (
                item.headline
              )}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0 }}>
            {item.summary}
          </p>
        </div>
      ))}
    </div>
  );
}

function ResearchView({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const research = data as {
    trends?: Array<{
      description: string;
      confidence: string;
      supportingEvidence: string[];
    }>;
    relatedFindings?: Array<{
      fromJob: string;
      connection: string;
      items: string[];
    }>;
    anomalies?: Array<{ description: string; severity: string }>;
  };

  return (
    <div>
      {research.trends && research.trends.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              textTransform: "uppercase",
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            Trends
          </div>
          {research.trends.map((t, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge variant={t.confidence === "high" ? "accent" : "muted"}>
                  {t.confidence}
                </Badge>
                <span style={{ fontSize: 14 }}>{t.description}</span>
              </div>
              <ul
                style={{
                  fontSize: 13,
                  color: "var(--text-2)",
                  margin: "6px 0 0 24px",
                  padding: 0,
                }}
              >
                {t.supportingEvidence.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {research.relatedFindings && research.relatedFindings.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              textTransform: "uppercase",
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            Related
          </div>
          {research.relatedFindings.map((f, i) => (
            <div key={i} style={{ marginBottom: 8, fontSize: 14 }}>
              <strong>{f.fromJob}</strong>: {f.connection}
            </div>
          ))}
        </div>
      )}
      {research.anomalies && research.anomalies.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              textTransform: "uppercase",
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            Anomalies
          </div>
          {research.anomalies.map((a, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <Badge variant={a.severity === "high" ? "danger" : "muted"}>
                {a.severity}
              </Badge>
              <span style={{ fontSize: 14 }}>{a.description}</span>
            </div>
          ))}
        </div>
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
  const [stats, setStats] = useState<RunStats | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [stages, setStages] = useState<RunStage[]>([]);
  const [runsExpanded, setRunsExpanded] = useState(true);
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
      setStats(res.stats);
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

  useEffect(() => {
    if (!selectedRun) return;
    api.getRunStages(job.id, selectedRun.id).then((res) => setStages(res.data));
  }, [selectedRun, job.id]);

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
      // Create a copy of the job with "Copy of " prefix
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
      // Refresh the parent job list and go back
      onJobUpdated?.();
      onBack();
    } catch (err) {
      console.error("Failed to clone job:", err);
      alert("Failed to clone job");
    } finally {
      setCloning(false);
    }
  }

  const successRate = stats
    ? Math.round((stats.success / (stats.total || 1)) * 100)
    : 0;

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

      {/* Stats row */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 14,
            marginBottom: 24,
          }}
        >
          {[
            { label: "Total Runs", value: stats.total },
            { label: "Success Rate", value: `${successRate}%` },
            { label: "Avg Duration", value: `${stats.avgDurationMs}ms` },
          ].map((s) => (
            <Card key={s.label} style={{ padding: "14px 18px" }}>
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
                {s.label}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {s.value}
              </div>
            </Card>
          ))}
          <Card
            style={{
              padding: "14px 18px",
              cursor: editingSchedule ? "default" : "pointer",
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
      )}

      {/* Run History */}
      <CollapsibleSection
        title="Run History"
        expanded={runsExpanded}
        onToggle={() => setRunsExpanded(!runsExpanded)}
        collapsible={false}
        count={runs.length}
      >
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
                        <Badge variant={outcomeVariant(run.outcome)}>
                          {run.outcome}
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
                        {run.durationMs && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--text-2)",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {run.durationMs}ms
                          </span>
                        )}
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
                {selectedRun.error ? (
                  <RunError error={selectedRun.error} />
                ) : (
                  <div>
                    {/* Report (editor output) */}
                    {selectedRun?.result != null && (
                      <div style={{ marginBottom: 16 }}>
                        <div className="analysis-markdown">
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ href, children }) => (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {children}
                                </a>
                              ),
                            }}
                          >
                            {typeof selectedRun.result === "string"
                              ? selectedRun.result
                              : JSON.stringify(selectedRun.result, null, 2)}
                          </Markdown>
                        </div>
                      </div>
                    )}

                    {/* Stage panels */}
                    {stages
                      .filter((s) => s.stage !== "editor")
                      .map((stage) => (
                        <StagePanel key={stage.id} stage={stage}>
                          {stage.stage === "collector" ? (
                            <CollectorPanel data={stage.output} />
                          ) : stage.stage === "summarizer" ? (
                            <SummaryView data={stage.output} />
                          ) : stage.stage === "researcher" ? (
                            <ResearchView data={stage.output} />
                          ) : null}
                        </StagePanel>
                      ))}
                  </div>
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

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  collapsible,
  count,
  children,
}: {
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
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          color: "var(--text-1)",
          cursor: "pointer",
          padding: "8px 0",
          marginBottom: expanded ? 12 : 0,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          width: "100%",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transition: "transform 0.15s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            fontSize: 10,
          }}
        >
          ▶
        </span>
        {title}
        <Badge variant="muted">{count}</Badge>
      </button>
      {expanded && children}
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
