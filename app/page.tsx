"use client";

import { useState, useCallback, useRef, useEffect } from "react";

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

interface TaskResult {
  jobId: string;
  jobName: string;
  taskId: string;
  taskName: string;
  success: boolean;
  error?: string;
  previousTargetDate?: string | null;
  newTargetDate?: string | null;
  previousStartDate?: string | null;
  newStartDate?: string | null;
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

function applyOffset(dateStr: string | null, offsetDays: number): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const d = new Date(cleaned + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

function calculateOffset(currentDate: string, newDate: string): number {
  const current = new Date(currentDate + "T00:00:00Z");
  const target = new Date(newDate + "T00:00:00Z");
  return Math.round((target.getTime() - current.getTime()) / (1000 * 60 * 60 * 24));
}

function formatOffset(days: number): string {
  if (days === 0) return "No change";
  const absDays = Math.abs(days);
  const sign = days > 0 ? "+" : "−";
  return `${sign}${absDays} day${absDays === 1 ? "" : "s"}`;
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

  // Date cascade state
  const [referenceDate, setReferenceDate] = useState("");
  const [newDate, setNewDate] = useState("");
  const [offsetDays, setOffsetDays] = useState(0);

  // Cascade execution
  const [isCascading, setIsCascading] = useState(false);
  const [cascadeResults, setCascadeResults] = useState<TaskResult[] | null>(null);
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

  // Find earliest target_date
  function findEarliestDate(jobs: JobWithTasks[]): string | null {
    let earliest: string | null = null;
    for (const job of jobs) {
      for (const task of job.tasks) {
        const td = dateToYMD(task.target_date);
        if (td && (!earliest || td < earliest)) earliest = td;
      }
    }
    return earliest;
  }

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
    setNewDate("");
    setOffsetDays(0);
    setReferenceDate("");
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
        const allJobs = [data.parent, ...(data.relatedJobs || [])];
        const earliest = findEarliestDate(allJobs);
        if (earliest) setReferenceDate(earliest);
      }
    } catch {
      setError("Failed to load job details.");
    }
    setIsLoadingDetails(false);
  }, []);

  const handleNewDateChange = useCallback(
    (value: string) => {
      setNewDate(value);
      if (referenceDate && value) setOffsetDays(calculateOffset(referenceDate, value));
      else setOffsetDays(0);
    },
    [referenceDate]
  );

  const handleReferenceDateChange = useCallback(
    (value: string) => {
      setReferenceDate(value);
      if (value && newDate) setOffsetDays(calculateOffset(value, newDate));
      else setOffsetDays(0);
    },
    [newDate]
  );

  function getTasksForCascade() {
    const allJobs = parentJob ? [parentJob, ...relatedJobs] : [];
    const tasks: {
      jobId: string;
      jobName: string;
      taskId: string;
      taskName: string;
      currentTargetDate: string | null;
      currentStartDate: string | null;
    }[] = [];
    for (const job of allJobs) {
      for (const task of job.tasks) {
        const td = dateToYMD(task.target_date);
        const sd = dateToYMD(task.start_date);
        if (td || sd) {
          tasks.push({
            jobId: job.id,
            jobName: job.name,
            taskId: task.id,
            taskName: task.name,
            currentTargetDate: td,
            currentStartDate: sd,
          });
        }
      }
    }
    return tasks;
  }

  const handleCascade = useCallback(async () => {
    if (offsetDays === 0) return;
    setIsCascading(true);
    setError(null);
    const tasks = getTasksForCascade();
    try {
      const res = await fetch("/api/jobman/cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offsetDays, tasks }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setCascadeResults(data.results);
        setCascadeSummary(data.summary);
      }
    } catch {
      setError("Failed to apply cascade.");
    }
    setIsCascading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetDays, parentJob, relatedJobs]);

  const handleReset = () => {
    setSearchQuery("");
    setSearchResults([]);
    setParentJob(null);
    setRelatedJobs([]);
    setReferenceDate("");
    setNewDate("");
    setOffsetDays(0);
    setCascadeResults(null);
    setCascadeSummary(null);
    setError(null);
  };

  // Computed
  const allJobs = parentJob ? [parentJob, ...relatedJobs] : [];
  const allTasks = allJobs.flatMap((j) =>
    j.tasks.map((t) => ({ ...t, jobName: j.name, jobNumber: j.number, jobId: j.id }))
  );
  const tasksWithDates = allTasks.filter((t) => t.target_date || t.start_date);
  const tasksWithoutDates = allTasks.filter((t) => !t.target_date && !t.start_date);
  const canCascade = offsetDays !== 0 && tasksWithDates.length > 0 && !isCascading && !cascadeResults;

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
          {parentJob && !cascadeResults && (
            <button onClick={handleReset} className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80" style={{ color: "var(--color-text-secondary)", background: "var(--color-surface-alt)" }}>
              Start Over
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 fade-in" style={{ background: "var(--color-danger-light)", borderColor: "var(--color-danger)" }}>
            <span className="mt-0.5 text-lg">⚠️</span>
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
              💡 Click any date cell to set or edit a date directly on Jobman.
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
                            <th className="pb-2 pr-4">Task</th>
                            <th className="pb-2 pr-4">Step</th>
                            <th className="pb-2 pr-4">Target Date</th>
                            <th className="pb-2">Start Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {job.tasks.map((task) => (
                            <tr key={task.id} className="border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
                              <td className="py-2 pr-4 font-medium" style={{ color: "var(--color-text)" }}>{task.name}</td>
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

        {/* ── STEP 3: Set Date Offset ─────────────────────── */}
        {parentJob && !isLoadingDetails && !cascadeResults && tasksWithDates.length > 0 && (
          <section className="mb-8 slide-up">
            <StepHeader step={3} label="Set Date Offset" />
            <div className="rounded-xl border px-5 py-5" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
              <p className="mb-4 text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Choose a reference date and a new target date. All task dates will be shifted by the same offset.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Reference date (current)
                  </label>
                  <input type="date" value={referenceDate} onChange={(e) => handleReferenceDateChange(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-2"
                    style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                  />
                </div>
                <div className="flex items-center justify-center text-xl" style={{ color: "var(--color-text-muted)" }}>→</div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    New target date
                  </label>
                  <input type="date" value={newDate} onChange={(e) => handleNewDateChange(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-2"
                    style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                  />
                </div>
              </div>

              {referenceDate && newDate && (
                <div className="mt-4 fade-in">
                  {offsetDays !== 0 ? (
                    <div className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: offsetDays > 0 ? "var(--color-primary-light)" : "var(--color-warning-light)", color: offsetDays > 0 ? "var(--color-primary)" : "var(--color-warning)" }}>
                      <span className="text-lg">{offsetDays > 0 ? "→" : "←"}</span>
                      Shifting all task dates by {formatOffset(offsetDays)}
                    </div>
                  ) : (
                    <div className="rounded-lg px-4 py-3 text-sm font-medium" style={{ background: "var(--color-surface-alt)", color: "var(--color-text-muted)" }}>
                      No change — dates are the same
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── STEP 4: Preview + Confirm ───────────────────── */}
        {parentJob && offsetDays !== 0 && !cascadeResults && (
          <section className="mb-8 slide-up">
            <StepHeader step={4} label="Preview Changes" />
            <div className="rounded-xl border" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
              <div className="overflow-x-auto px-5 py-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs font-medium uppercase tracking-wider" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                      <th className="pb-2 pr-3">Job</th>
                      <th className="pb-2 pr-3">Task</th>
                      <th className="pb-2 pr-3">Current Date</th>
                      <th className="pb-2 pr-3">New Date</th>
                      <th className="pb-2">Offset</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasksWithDates.map((task) => (
                      <tr key={task.id} className="border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
                        <td className="py-2 pr-3 text-xs" style={{ color: "var(--color-text-muted)" }}>{task.jobName}</td>
                        <td className="py-2 pr-3 font-medium" style={{ color: "var(--color-text)" }}>{task.name}</td>
                        <td className="py-2 pr-3" style={{ color: "var(--color-text-secondary)" }}>
                          {formatDateStr(task.target_date || task.start_date)}
                        </td>
                        <td className="py-2 pr-3 font-semibold" style={{ color: "var(--color-primary)" }}>
                          {formatDateStr(applyOffset(dateToYMD(task.target_date || task.start_date), offsetDays))}
                        </td>
                        <td className="py-2" style={{ color: "var(--color-text-muted)" }}>{formatOffset(offsetDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {tasksWithoutDates.length > 0 && (
                <div className="mx-5 mb-4 rounded-lg border px-4 py-3 text-xs" style={{ background: "var(--color-warning-light)", borderColor: "var(--color-warning)", color: "var(--color-warning)" }}>
                  <strong>{tasksWithoutDates.length}</strong> task{tasksWithoutDates.length > 1 ? "s have" : " has"} no dates and will be skipped.
                </div>
              )}

              <div className="border-t px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
                <div className="mb-4 flex items-start gap-3 rounded-lg border px-4 py-3" style={{ background: "var(--color-warning-light)", borderColor: "var(--color-warning)" }}>
                  <span className="mt-0.5 text-lg">⚠️</span>
                  <p className="text-sm font-medium" style={{ color: "var(--color-warning)" }}>
                    You are about to update <strong>{tasksWithDates.length}</strong> task{tasksWithDates.length > 1 ? "s" : ""} across{" "}
                    <strong>{allJobs.length}</strong> job{allJobs.length > 1 ? "s" : ""}. This action <strong>cannot be undone</strong>.
                  </p>
                </div>
                <button onClick={handleCascade} disabled={!canCascade}
                  className="w-full rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: canCascade ? "var(--color-primary)" : "var(--color-text-muted)" }}
                >
                  {isCascading ? (
                    <span className="flex items-center justify-center gap-2"><Spinner /> Updating tasks...</span>
                  ) : (
                    `Apply Date Cascade — ${formatOffset(offsetDays)} to ${tasksWithDates.length} tasks`
                  )}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── STEP 5: Results ─────────────────────────────── */}
        {cascadeResults && cascadeSummary && (
          <section className="mb-8 slide-up">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: cascadeSummary.failed === 0 ? "var(--color-success)" : "var(--color-warning)" }}>✓</span>
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Results</h2>
            </div>
            <div className="rounded-xl border" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
              <div className="border-b px-5 py-4" style={{ borderColor: "var(--color-border)", background: cascadeSummary.failed === 0 ? "var(--color-success-light)" : "var(--color-warning-light)" }}>
                <p className="text-lg font-semibold" style={{ color: cascadeSummary.failed === 0 ? "var(--color-success)" : "var(--color-warning)" }}>
                  {cascadeSummary.success} of {cascadeSummary.total} tasks updated
                </p>
                {cascadeSummary.failed > 0 && (
                  <p className="mt-1 text-sm" style={{ color: "var(--color-danger)" }}>
                    {cascadeSummary.failed} failed — see below.
                  </p>
                )}
              </div>
              <div className="px-5 py-4 space-y-2">
                {cascadeResults.map((r) => (
                  <div key={r.taskId} className="flex items-start gap-3 rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: r.success ? "var(--color-success-light)" : "var(--color-danger-light)" }}>
                    <span className="mt-0.5 text-lg">{r.success ? "✅" : "❌"}</span>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                        {r.taskName} <span className="ml-1 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>({r.jobName})</span>
                      </p>
                      {r.success && r.previousTargetDate && r.newTargetDate && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>Target: {formatDateStr(r.previousTargetDate)} → {formatDateStr(r.newTargetDate)}</p>
                      )}
                      {r.success && r.previousStartDate && r.newStartDate && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>Start: {formatDateStr(r.previousStartDate)} → {formatDateStr(r.newStartDate)}</p>
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
            <p className="mt-1 text-xs">Select a parent job to view and cascade task date changes</p>
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
