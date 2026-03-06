"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────

interface JobSearchResult {
  id: string;
  number: string;
  name: string;
  description: string | null;
}

interface TaskData {
  id: string;
  name: string;
  stepName?: string;
  step_id: string;
  status: string;
  progress: number;
  start_date: string | null;
  target_date: string | null;
  target_date_locked: boolean;
}

interface JobWithTasks {
  id: string;
  number: string;
  name: string;
  tasks: TaskData[];
}

interface CascadeStepResult {
  step: number;
  description: string;
  success: boolean;
  error?: string;
  jobId?: string;
  jobNumber?: string;
  taskId?: string;
  taskName?: string;
  dateSet?: string;
  direction?: string;
}

// ─── Date Utilities ───────────────────────────────────────────

function formatDateStr(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const cleaned = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const d = new Date(cleaned + "T00:00:00Z");
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dateToYMD(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  if (dateStr.includes("T")) return dateStr.split("T")[0];
  return dateStr;
}

// ─── Inline Task Date Editor ──────────────────────────────────

function TaskDateCell({
  date,
  dateType,
  jobId,
  taskId,
  onDateUpdated,
}: {
  date: string | null;
  dateType: "target" | "start";
  jobId: string;
  taskId: string;
  onDateUpdated: (taskId: string, dateType: "target" | "start", newDate: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(dateToYMD(date) || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!editValue) return;
    setIsSaving(true);
    try {
      const payload: Record<string, string> = {};
      payload[dateType === "target" ? "targetDate" : "startDate"] = editValue;

      const res = await fetch("/api/jobman/task-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, taskId, ...payload }),
      });
      const data = await res.json();
      if (data.success) {
        onDateUpdated(taskId, dateType, editValue);
        setIsEditing(false);
      } else {
        alert(data.error || "Failed to save date");
      }
    } catch {
      alert("Failed to save date");
    }
    setIsSaving(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="rounded border px-1.5 py-0.5 text-xs outline-none"
          style={{
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            color: "var(--color-text)",
          }}
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={isSaving || !editValue}
          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
          style={{ background: "var(--color-success)" }}
        >
          {isSaving ? "…" : "✓"}
        </button>
        <button
          onClick={() => setIsEditing(false)}
          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ color: "var(--color-text-muted)" }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setEditValue(dateToYMD(date) || "");
        setIsEditing(true);
      }}
      className="group flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors"
      style={{
        background: date ? "var(--color-primary-light)" : "var(--color-surface-alt)",
        color: date ? "var(--color-primary)" : "var(--color-text-muted)",
      }}
      title={`Click to ${date ? "edit" : "set"} ${dateType} date`}
    >
      {date ? formatDateStr(date) : "Set date"}
      <span className="text-[10px] opacity-0 group-hover:opacity-60 transition-opacity">✎</span>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function Home() {
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<JobSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Selected job state
  const [parentJob, setParentJob] = useState<JobWithTasks | null>(null);
  const [relatedJobs, setRelatedJobs] = useState<JobWithTasks[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Smart cascade state
  const [selectedAnchorTaskId, setSelectedAnchorTaskId] = useState<string | null>(null);
  const [installDate, setInstallDate] = useState("");
  const [isCascading, setIsCascading] = useState(false);
  const [cascadeResults, setCascadeResults] = useState<CascadeStepResult[] | null>(null);
  const [cascadeSummary, setCascadeSummary] = useState<{
    total: number;
    success: number;
    failed: number;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);

  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Handle inline date update — update local state
  const handleTaskDateUpdated = useCallback(
    (taskId: string, dateType: "target" | "start", newDate: string) => {
      const updateTasks = (jobs: JobWithTasks[]) =>
        jobs.map((job) => ({
          ...job,
          tasks: job.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  [dateType === "target" ? "target_date" : "start_date"]: newDate,
                }
              : t
          ),
        }));

      if (parentJob) {
        const updated = updateTasks([parentJob]);
        setParentJob(updated[0]);
      }
      setRelatedJobs((prev) => updateTasks(prev));
    },
    [parentJob]
  );

  // Debounced search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setError(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (query.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/jobman/jobs?search=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.error) {
          setError(data.error);
          setSearchResults([]);
        } else {
          setSearchResults(data.jobs || []);
          setShowDropdown(true);
        }
      } catch {
        setError("Failed to search jobs. Check your connection.");
      }
      setIsSearching(false);
    }, 300);
  }, []);

  // Select a job
  const handleSelectJob = useCallback(async (job: JobSearchResult) => {
    setShowDropdown(false);
    setSearchQuery(job.name);
    setIsLoadingDetails(true);
    setError(null);
    setSelectedAnchorTaskId(null);
    setInstallDate("");
    setCascadeResults(null);
    setCascadeSummary(null);

    try {
      const res = await fetch(`/api/jobman/jobs/${job.id}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setParentJob(data.parent);
        setRelatedJobs(data.relatedJobs || []);
      }
    } catch {
      setError("Failed to load job details.");
    }
    setIsLoadingDetails(false);
  }, []);

  // Smart cascade — trigger the 3-step cascade
  const handleSmartCascade = useCallback(async () => {
    if (!parentJob || !selectedAnchorTaskId || !installDate) return;
    setIsCascading(true);
    setError(null);

    try {
      const res = await fetch("/api/jobman/smart-cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: parentJob.id,
          anchorTaskId: selectedAnchorTaskId,
          newStartDate: installDate,
        }),
      });
      const data = await res.json();
      if (data.error && !data.steps) {
        setError(data.error);
      } else {
        setCascadeResults(data.steps || []);
        setCascadeSummary(data.summary || null);
      }
    } catch {
      setError("Failed to run smart cascade.");
    }
    setIsCascading(false);
  }, [parentJob, selectedAnchorTaskId, installDate]);

  const handleReset = () => {
    setSearchQuery("");
    setSearchResults([]);
    setParentJob(null);
    setRelatedJobs([]);
    setSelectedAnchorTaskId(null);
    setInstallDate("");
    setCascadeResults(null);
    setCascadeSummary(null);
    setError(null);
  };

  // Computed
  const allJobs = parentJob ? [parentJob, ...relatedJobs] : [];
  const selectedAnchorTask = parentJob
    ? parentJob.tasks.find((t) => t.id === selectedAnchorTaskId)
    : null;
  const canCascade = !!selectedAnchorTaskId && !!installDate && !isCascading && !cascadeResults;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-50 border-b backdrop-blur-xl"
        style={{
          background: "color-mix(in srgb, var(--color-surface) 85%, transparent)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white text-sm font-bold" style={{ background: "var(--color-primary)" }}>
              JM
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>Date Cascade</h1>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Jobman Task Date Tool</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/calendar"
              className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--color-primary)", background: "var(--color-primary-light)" }}
            >
              Calendar View
            </Link>
            {parentJob && !cascadeResults && (
              <button onClick={handleReset} className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80" style={{ color: "var(--color-text-secondary)", background: "var(--color-surface-alt)" }}>
                Start Over
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 fade-in" style={{ background: "var(--color-danger-light)", borderColor: "var(--color-danger)" }}>
            <span className="mt-0.5 text-lg">!</span>
            <p className="flex-1 text-sm font-medium" style={{ color: "var(--color-danger)" }}>{error}</p>
            <button onClick={() => setError(null)} className="text-sm opacity-60 hover:opacity-100" style={{ color: "var(--color-danger)" }}>✕</button>
          </div>
        )}

        {/* ── STEP 1: Search ───────────────────────────────── */}
        <section className="mb-8 slide-up">
          <StepHeader step={1} label="Search for a Job" />
          <div className="relative" ref={dropdownRef}>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                placeholder="Search by job name, number, or description..."
                className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all focus:ring-2"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
              />
              {isSearching && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>

            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-40 mt-2 w-full rounded-xl border shadow-xl fade-in" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                <div className="max-h-64 overflow-y-auto py-1">
                  {searchResults.map((job) => (
                    <button key={job.id} onClick={() => handleSelectJob(job)} className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors" style={{ color: "var(--color-text)" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "var(--color-surface-alt)")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div>
                        <p className="text-sm font-medium">{job.name}</p>
                        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>#{job.number}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showDropdown && searchResults.length === 0 && !isSearching && searchQuery.length >= 2 && (
              <div className="absolute z-40 mt-2 w-full rounded-xl border px-4 py-6 text-center text-sm shadow-xl" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                No jobs found matching &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
        </section>

        {/* Loading */}
        {isLoadingDetails && (
          <div className="mb-8 flex items-center justify-center rounded-xl border px-6 py-12 fade-in" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
            <Spinner className="mr-3" />
            <span className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>Loading job tasks...</span>
          </div>
        )}

        {/* ── STEP 2: Job Details + Tasks ──────────────────── */}
        {parentJob && !isLoadingDetails && !cascadeResults && (
          <section className="mb-8 slide-up">
            <StepHeader step={2} label="Job Tasks & Current Dates" />
            <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Click any date cell to edit directly. Select an anchor task below to run the smart cascade.
            </p>
            <div className="space-y-4">
              {allJobs.map((job) => (
                <div key={job.id} className="rounded-xl border" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="border-b px-5 py-3 flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                        {job.name}
                        {job.id === parentJob.id && (
                          <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "var(--color-primary)", color: "white" }}>Parent</span>
                        )}
                      </p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>#{job.number}</p>
                    </div>
                    <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: "var(--color-surface-alt)", color: "var(--color-text-muted)" }}>
                      {job.tasks.length} task{job.tasks.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {job.tasks.length > 0 ? (
                    <div className="overflow-x-auto px-5 py-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs font-medium uppercase tracking-wider" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                            {job.id === parentJob.id && <th className="pb-2 pr-2 w-8">Anchor</th>}
                            <th className="pb-2 pr-4">Task</th>
                            <th className="pb-2 pr-4">Step</th>
                            <th className="pb-2 pr-4">Target Date</th>
                            <th className="pb-2">Start Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {job.tasks.map((task) => (
                            <tr
                              key={task.id}
                              className="border-b last:border-0"
                              style={{
                                borderColor: "var(--color-border)",
                                background: selectedAnchorTaskId === task.id ? "var(--color-primary-light)" : undefined,
                              }}
                            >
                              {job.id === parentJob.id && (
                                <td className="py-2 pr-2">
                                  <input
                                    type="radio"
                                    name="anchorTask"
                                    checked={selectedAnchorTaskId === task.id}
                                    onChange={() => setSelectedAnchorTaskId(task.id)}
                                    className="h-4 w-4 cursor-pointer"
                                    style={{ accentColor: "var(--color-primary)" }}
                                  />
                                </td>
                              )}
                              <td className="py-2 pr-4 font-medium" style={{ color: "var(--color-text)" }}>
                                {task.name}
                                {selectedAnchorTaskId === task.id && (
                                  <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "var(--color-success)", color: "white" }}>Anchor</span>
                                )}
                              </td>
                              <td className="py-2 pr-4 text-xs" style={{ color: "var(--color-text-muted)" }}>{task.stepName || "—"}</td>
                              <td className="py-2 pr-4">
                                <TaskDateCell
                                  date={task.target_date}
                                  dateType="target"
                                  jobId={job.id}
                                  taskId={task.id}
                                  onDateUpdated={handleTaskDateUpdated}
                                />
                              </td>
                              <td className="py-2">
                                <TaskDateCell
                                  date={task.start_date}
                                  dateType="start"
                                  jobId={job.id}
                                  taskId={task.id}
                                  onDateUpdated={handleTaskDateUpdated}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-5 py-4 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
                      No tasks found for this job
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── STEP 3: Set Install Date + Run Cascade ─────── */}
        {parentJob && selectedAnchorTaskId && !isLoadingDetails && !cascadeResults && (
          <section className="mb-8 slide-up">
            <StepHeader step={3} label="Set Install Date & Cascade" />
            <div className="rounded-xl border px-5 py-5" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
              <p className="mb-4 text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Set the new start date for <strong style={{ color: "var(--color-text)" }}>{selectedAnchorTask?.name || "selected task"}</strong>.
                The app will automatically:
              </p>
              <ol className="mb-5 ml-4 space-y-1.5 text-sm list-decimal" style={{ color: "var(--color-text-secondary)" }}>
                <li>Reverse-calculate all tasks <strong>before</strong> the anchor task</li>
                <li>Forward-calculate all tasks <strong>after</strong> the next task (using anchor&apos;s finish date)</li>
                <li>Cascade each <strong>work order</strong> (reverse-calculate from their last task)</li>
              </ol>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    New install start date
                  </label>
                  <input
                    type="date"
                    value={installDate}
                    onChange={(e) => setInstallDate(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-2"
                    style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                  />
                </div>
                <button
                  onClick={handleSmartCascade}
                  disabled={!canCascade}
                  className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: canCascade ? "var(--color-primary)" : "var(--color-text-muted)" }}
                >
                  {isCascading ? (
                    <span className="flex items-center gap-2"><Spinner /> Running cascade...</span>
                  ) : (
                    "Run Smart Cascade"
                  )}
                </button>
              </div>

              {installDate && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border px-4 py-3 fade-in" style={{ background: "var(--color-warning-light)", borderColor: "var(--color-warning)" }}>
                  <span className="mt-0.5 text-lg">!</span>
                  <p className="text-sm font-medium" style={{ color: "var(--color-warning)" }}>
                    This will update dates across the parent job and all work orders. This action <strong>cannot be undone</strong>.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── STEP 4: Results ─────────────────────────────── */}
        {cascadeResults && cascadeSummary && (
          <section className="mb-8 slide-up">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: cascadeSummary.failed === 0 ? "var(--color-success)" : "var(--color-warning)" }}>✓</span>
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Cascade Results</h2>
            </div>
            <div className="rounded-xl border" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
              <div className="border-b px-5 py-4" style={{ borderColor: "var(--color-border)", background: cascadeSummary.failed === 0 ? "var(--color-success-light)" : "var(--color-warning-light)" }}>
                <p className="text-lg font-semibold" style={{ color: cascadeSummary.failed === 0 ? "var(--color-success)" : "var(--color-warning)" }}>
                  {cascadeSummary.success} of {cascadeSummary.total} steps completed
                </p>
                {cascadeSummary.failed > 0 && (
                  <p className="mt-1 text-sm" style={{ color: "var(--color-danger)" }}>
                    {cascadeSummary.failed} failed — see details below.
                  </p>
                )}
              </div>
              <div className="px-5 py-4 space-y-2">
                {cascadeResults.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: r.success ? "var(--color-success-light)" : "var(--color-danger-light)" }}>
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: r.success ? "var(--color-success)" : "var(--color-danger)" }}>
                      {r.step}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                        {r.description}
                      </p>
                      {r.dateSet && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>
                          Date set: {formatDateStr(r.dateSet)}
                          {r.direction && <span className="ml-2">({r.direction} recalculation)</span>}
                        </p>
                      )}
                      {r.taskName && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                          Task: {r.taskName}
                          {r.jobNumber && <span className="ml-2">Job: #{r.jobNumber}</span>}
                        </p>
                      )}
                      {!r.success && r.error && <p className="mt-0.5 text-xs" style={{ color: "var(--color-danger)" }}>{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
                <button onClick={handleReset} className="w-full rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg" style={{ background: "var(--color-primary)" }}>
                  Start Over
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Empty state */}
        {!parentJob && !isLoadingDetails && (
          <div className="mt-12 text-center fade-in" style={{ color: "var(--color-text-muted)" }}>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl" style={{ background: "var(--color-surface-alt)" }}>📅</div>
            <p className="text-sm font-medium">Search for a job above to get started</p>
            <p className="mt-1 text-xs">Select a parent job, choose an anchor task, and cascade dates automatically</p>
          </div>
        )}
      </main>

      <footer className="border-t py-4 text-center text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
        Jobman Date Cascade Tool — Internal Use Only
      </footer>
    </div>
  );
}

// ─── Shared Sub-Components ────────────────────────────────────

function StepHeader({ step, label }: { step: number; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: "var(--color-primary)" }}>{step}</span>
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>{label}</h2>
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} fill="none" viewBox="0 0 24 24" style={{ color: "var(--color-primary)" }}>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
