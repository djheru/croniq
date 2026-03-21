import cronstrue from "cronstrue";
import { formatDistanceToNow } from "date-fns";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, type Job } from "./api";
import { JobDetail, StatusBadge } from "./components/JobDetail";
import { JobForm } from "./components/JobForm";
import { Badge, Button, Card, Empty, Spinner } from "./components/ui";

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    try {
      const res = await api.getJobs();
      setJobs(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    const id = setInterval(loadJobs, 30000);
    return () => clearInterval(id);
  }, [loadJobs]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)" }}>
      <Header />
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "24px 12px" }}>
        <Routes>
          <Route
            path="/"
            element={
              <JobList jobs={jobs} loading={loading} loadJobs={loadJobs} />
            }
          />
          <Route
            path="/jobs/new"
            element={<JobFormRoute loadJobs={loadJobs} />}
          />
          <Route
            path="/jobs/:id"
            element={
              <JobDetailRoute
                jobs={jobs}
                loading={loading}
                loadJobs={loadJobs}
              />
            }
          />
          <Route
            path="/jobs/:id/edit"
            element={<JobEditRoute jobs={jobs} loadJobs={loadJobs} />}
          />
        </Routes>
      </div>
      <Footer />
      <GlobalStyles />
    </div>
  );
}

function JobFormRoute({ loadJobs }: { loadJobs: () => Promise<void> }) {
  const navigate = useNavigate();

  async function createJob(data: object) {
    await api.createJob(data);
    await loadJobs();
    navigate("/");
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <button
          onClick={() => navigate("/")}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-1)",
            cursor: "pointer",
            fontSize: 20,
            padding: "0 4px",
            minHeight: 44,
            minWidth: 44,
          }}
        >
          ←
        </button>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>New Job</h2>
      </div>
      <Card style={{ padding: 20 }}>
        <JobForm onSubmit={createJob} onCancel={() => navigate("/")} />
      </Card>
    </div>
  );
}

function JobEditRoute({
  jobs,
  loadJobs,
}: {
  jobs: Job[];
  loadJobs: () => Promise<void>;
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    const found = jobs.find((j) => j.id === id);
    if (found) {
      setJob(found);
    } else if (id) {
      api
        .getJob(id)
        .then((res) => setJob(res.data))
        .catch(() => navigate("/"));
    }
  }, [id, jobs, navigate]);

  async function updateJob(data: object) {
    if (!id) return;
    await api.updateJob(id, data);
    await loadJobs();
    navigate(`/jobs/${id}`);
  }

  if (!job) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <button
          onClick={() => navigate(`/jobs/${id}`)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-1)",
            cursor: "pointer",
            fontSize: 20,
            padding: "0 4px",
            minHeight: 44,
            minWidth: 44,
          }}
        >
          ←
        </button>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Edit Job</h2>
      </div>
      <Card style={{ padding: 20 }}>
        <JobForm
          initial={job}
          onSubmit={updateJob}
          onCancel={() => navigate(`/jobs/${id}`)}
        />
      </Card>
    </div>
  );
}

function JobDetailRoute({
  jobs,
  loading,
  loadJobs,
}: {
  jobs: Job[];
  loading: boolean;
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
    api
      .getJob(id)
      .then((res) => setDirectJob(res.data))
      .catch(() => navigate("/"));
  }, [id, jobs, loading, directJob, navigate]);

  const job = jobs.find((j) => j.id === id) ?? directJob;

  if (loading && !job) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Spinner />
      </div>
    );
  }

  if (!job) {
    return <Empty message="Job not found" />;
  }

  return (
    <JobDetail
      job={job}
      onEdit={() => navigate(`/jobs/${id}/edit`)}
      onBack={() => navigate("/")}
      onJobUpdated={loadJobs}
    />
  );
}

function JobList({
  jobs,
  loading,
  loadJobs,
}: {
  jobs: Job[];
  loading: boolean;
  loadJobs: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isFiltered =
    filterStatus !== "all" || filterType !== "all" || search !== "";
  const canDrag = !isFiltered;

  async function toggleJob(job: Job) {
    if (job.status === "paused") await api.resumeJob(job.id);
    else await api.pauseJob(job.id);
    await loadJobs();
  }

  async function deleteJob(job: Job) {
    // if (!confirm(`Delete "${job.name}"?`)) return;
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
    await api.reorderJobs(reordered.map((j) => j.id));
    await loadJobs();
  };

  const types = [
    ...new Set(jobs.flatMap((j) => j.sources.map((s) => s.config.type))),
  ];

  const filtered = jobs.filter((j) => {
    if (filterStatus !== "all" && j.status !== filterStatus) return false;
    if (
      filterType !== "all" &&
      !j.sources.some((s) => s.config.type === filterType)
    )
      return false;
    if (search && !j.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const stats = {
    total: jobs.length,
    active: jobs.filter((j) => j.status === "active").length,
    errors: jobs.filter((j) => j.status === "error").length,
  };

  return (
    <>
      {/* Stats bar */}
      {/*<div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
         {[
          { label: "Total Jobs", value: stats.total, color: "var(--text-0)" },
          { label: "Active", value: stats.active, color: "var(--success)" },
          { label: "Errors", value: stats.errors, color: "var(--danger)" },
        ].map((s) => (
          <Card
            key={s.label}
            style={{
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flex: "1 1 auto",
              minWidth: 140,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                color: s.color,
              }}
            >
              {s.value}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-1)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 500,
              }}
            >
              {s.label}
            </span>
          </Card>
        ))} 
        <div style={{ flex: 1 }} />
        <Button variant="primary" onClick={() => navigate("/jobs/new")}>
          + New Job
        </Button>
      </div>*/}

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 18,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Button
          variant="primary"
          onClick={() => navigate("/jobs/new")}
          style={{ padding: "3px 20px 3px 14px", marginRight: "20px" }}
        >
          + New Job
        </Button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs..."
          style={{
            width: 220,
            fontSize: 14,
            padding: "10px 14px",
            minHeight: 42,
          }}
        />
        <FilterChip
          label="All"
          active={filterStatus === "all"}
          onClick={() => setFilterStatus("all")}
        />
        <FilterChip
          label="Active"
          active={filterStatus === "active"}
          onClick={() => setFilterStatus("active")}
        />
        <FilterChip
          label="Paused"
          active={filterStatus === "paused"}
          onClick={() => setFilterStatus("paused")}
        />
        <FilterChip
          label="Error"
          active={filterStatus === "error"}
          onClick={() => setFilterStatus("error")}
        />
        <div
          style={{
            width: 1,
            height: 16,
            background: "var(--border)",
            margin: "0 4px",
          }}
        />
        <FilterChip
          label="All types"
          active={filterType === "all"}
          onClick={() => setFilterType("all")}
        />
        {types.map((t) => (
          <FilterChip
            key={t}
            label={t}
            active={filterType === t}
            onClick={() => setFilterType(t)}
          />
        ))}
      </div>

      {/* Job list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <Empty
          message={
            jobs.length === 0
              ? "No jobs yet — create your first job to get started"
              : "No jobs match your filters"
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill, minmax(min(350px, 100%), 1fr))",
            gap: 14,
            gridAutoRows: "1fr",
          }}
        >
          {filtered.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              onClick={() => navigate(`/jobs/${job.id}`)}
              onEdit={() => navigate(`/jobs/${job.id}/edit`)}
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
    </>
  );
}

function Header() {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        borderBottom: "1px solid var(--border)",
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 20,
          letterSpacing: "-0.02em",
        }}
      >
        <span style={{ color: "var(--accent)" }}>⬡</span> croniq
      </span>
    </div>
  );
}

function statusDividerColor(status: Job["status"]): string {
  if (status === "active") return "rgba(63,185,80,0.2)";
  if (status === "error") return "rgba(248,81,73,0.2)";
  return "var(--border)";
}

function JobCard({
  job,
  onClick,
  onEdit,
  onToggle,
  onDelete,
  draggable,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDragOver,
}: {
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
        borderTop: isDragOver
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        transition: "opacity 0.15s",
        height: "100%",
      }}
    >
      <Card
        onClick={onClick}
        style={{
          padding: "18px",
          cursor: "pointer",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header: drag handle + name + status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
            flex: "0 0 auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              flex: 1,
            }}
          >
            {draggable && (
              <span
                onClick={(e) => e.stopPropagation()}
                style={{
                  cursor: "grab",
                  color: "var(--text-2)",
                  fontSize: 14,
                  userSelect: "none",
                  flexShrink: 0,
                  lineHeight: 1,
                }}
                title="Drag to reorder"
              >
                ⠿
              </span>
            )}
            <span
              style={{
                fontWeight: 600,
                fontSize: 16,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {job.name}
            </span>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {/* Content area - grows to fill available space */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Tags */}
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            {job.sources.length > 1 ? (
              <Badge variant="muted">{job.sources.length} sources</Badge>
            ) : (
              <Badge variant="muted">
                {job.sources[0]?.config.type ?? "unknown"}
              </Badge>
            )}
            {job.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="muted">
                {t}
              </Badge>
            ))}
          </div>

          {/* Schedule */}
          <CronChip schedule={job.schedule} />

          {/* Sources - constrained height with overflow */}
          <div
            style={{
              fontSize: 10,
              color: "var(--text-2)",
              fontFamily: "var(--font-mono)",
              marginBottom: 10,
              maxHeight: "3.6em", // ~3 lines
              overflow: "hidden",
              flex: "0 0 auto",
            }}
          >
            {job.sources
              .map((s, i) => (
                <div
                  key={i}
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: "1.2",
                  }}
                  title={s.config.url as string}
                >
                  {s.name && `${s.name}: `}
                  {(s.config.url as string)
                    ?.replace(/^https?:\/\//, "")
                    .slice(0, 35)}
                </div>
              ))
              .slice(0, 2)}
            {job.sources.length > 2 && (
              <div style={{ fontStyle: "italic", opacity: 0.7 }}>
                +{job.sources.length - 2} more
              </div>
            )}
          </div>
        </div>

        {/* Footer: last run + actions - always at bottom */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${statusDividerColor(job.status)}`,
            paddingTop: 8,
            flex: "0 0 auto",
            marginTop: "auto",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: job.status === "error" ? "var(--danger)" : "var(--text-2)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {job.lastRunAt
              ? `${job.status === "error" ? "failed" : "last"} ${formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })}`
              : "no runs yet"}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={onToggle}>
              {job.status === "paused" ? "▶" : "⏸"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              ✎
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              style={{
                color: "rgba(248,81,73,0.45)",
                borderColor: "rgba(248,81,73,0.2)",
              }}
            >
              ✕
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CronChip({ schedule }: { schedule: string }) {
  let description: string;
  try {
    description = cronstrue.toString(schedule, { use24HourTimeFormat: false });
  } catch {
    description = schedule;
  }

  return (
    <span
      title={description}
      style={{
        display: "inline-block",
        fontSize: 13,
        color: "var(--text-1)",
        fontFamily: "var(--font-mono)",
        background: "var(--bg-0)",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "4px 10px",
        marginBottom: 6,
        cursor: "default",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.color = "var(--text-0)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color = "var(--text-1)";
      }}
    >
      {schedule}
    </span>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        fontSize: 13,
        borderRadius: 5,
        cursor: "pointer",
        background: active ? "var(--accent-dim)" : "transparent",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        color: active ? "var(--accent)" : "var(--text-1)",
        fontFamily: "var(--font-mono)",
        minHeight: 38,
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}

function Footer() {
  return (
    <div
      style={{
        padding: "16px 20px",
        textAlign: "center",
        color: "var(--text-2)",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
      }}
    >
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
