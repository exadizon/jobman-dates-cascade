"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────

interface CalendarTask {
  id: string;
  name: string;
  stepName: string;
  startDate: string | null;
  targetDate: string | null;
  status: string;
  progress: number;
  locked: boolean;
}

interface CalendarJob {
  id: string;
  number: string;
  name: string;
  isWorkOrder: boolean;
  parentNumber?: string;
  tasks: CalendarTask[];
}

interface CascadeStepResult {
  step: number;
  description: string;
  success: boolean;
  error?: string;
  dateSet?: string;
  direction?: string;
  taskName?: string;
  jobNumber?: string;
}

// ─── Constants ────────────────────────────────────────────────

// Column width in pixels — used for both CSS widths and task bar positioning
const COL_W = 148;
const JOB_COL_W = 280;
const BAR_H = 32;
const BAR_GAP = 40;

const TASK_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  drafting: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  design: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  manufacturing: { bg: "#ffedd5", border: "#f97316", text: "#c2410c" },
  manufacture: { bg: "#ffedd5", border: "#f97316", text: "#c2410c" },
  assembly: { bg: "#fef3c7", border: "#f59e0b", text: "#b45309" },
  install: { bg: "#dcfce7", border: "#22c55e", text: "#15803d" },
  installation: { bg: "#dcfce7", border: "#22c55e", text: "#15803d" },
  delivery: { bg: "#e0e7ff", border: "#6366f1", text: "#4338ca" },
  freight: { bg: "#e0e7ff", border: "#6366f1", text: "#4338ca" },
  site: { bg: "#e0e7ff", border: "#6366f1", text: "#4338ca" },
  qa: { bg: "#fce7f3", border: "#ec4899", text: "#be185d" },
  order: { bg: "#f3e8ff", border: "#a855f7", text: "#7e22ce" },
  finalising: { bg: "#fce7f3", border: "#ec4899", text: "#be185d" },
  book: { bg: "#ccfbf1", border: "#14b8a6", text: "#0f766e" },
  ready: { bg: "#ccfbf1", border: "#14b8a6", text: "#0f766e" },
  update: { bg: "#f1f5f9", border: "#64748b", text: "#334155" },
  create: { bg: "#f3e8ff", border: "#a855f7", text: "#7e22ce" },
  default: { bg: "#f1f5f9", border: "#94a3b8", text: "#475569" },
};

function getTaskColor(taskName: string) {
  const lower = taskName.toLowerCase();
  for (const [key, val] of Object.entries(TASK_COLORS)) {
    if (key !== "default" && lower.includes(key)) return val;
  }
  return TASK_COLORS.default;
}

// ─── Date Helpers ─────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toYMD(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseYMD(str: string): Date {
  return new Date(str + "T00:00:00");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatDayHeader(date: Date): { day: string; weekday: string; month: string } {
  return {
    day: date.getDate().toString(),
    weekday: date.toLocaleDateString("en-AU", { weekday: "short" }),
    month: date.toLocaleDateString("en-AU", { month: "short" }),
  };
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return toYMD(a) === toYMD(b);
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// ─── Main Component ───────────────────────────────────────────

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<"week" | "2week" | "month">("2week");
  const [viewStart, setViewStart] = useState<Date>(() => getMonday(new Date()));

  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [jobs, setJobs] = useState<CalendarJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [draggingTask, setDraggingTask] = useState<{
    jobId: string;
    task: CalendarTask;
    jobNumber: string;
    originalStartDate: string;
  } | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const [cascadeModal, setCascadeModal] = useState<{
    jobId: string;
    taskId: string;
    taskName: string;
    newDate: string;
  } | null>(null);
  const [isCascading, setIsCascading] = useState(false);
  const [cascadeResults, setCascadeResults] = useState<CascadeStepResult[] | null>(null);

  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const daysToShow = viewMode === "week" ? 7 : viewMode === "2week" ? 14 : 28;
  const dates = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < daysToShow; i++) {
      arr.push(addDays(viewStart, i));
    }
    return arr;
  }, [viewStart, daysToShow]);

  const today = useMemo(() => new Date(), []);

  const navigateView = useCallback((direction: number) => {
    setViewStart((prev) => addDays(prev, direction * daysToShow));
  }, [daysToShow]);

  const goToToday = useCallback(() => {
    setViewStart(getMonday(new Date()));
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setError(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (query.trim().length < 2) return;

    searchTimeout.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/jobman/calendar?search=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setJobs(data.jobs || []);
          const allDates: string[] = [];
          for (const job of data.jobs || []) {
            for (const task of job.tasks) {
              if (task.startDate) allDates.push(task.startDate);
              if (task.targetDate) allDates.push(task.targetDate);
            }
          }
          if (allDates.length > 0) {
            allDates.sort();
            setViewStart(getMonday(addDays(parseYMD(allDates[0]), -2)));
          }
        }
      } catch {
        setError("Failed to load calendar data.");
      }
      setIsLoading(false);
    }, 400);
  }, []);

  const reloadJobs = useCallback(async () => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    try {
      const res = await fetch(`/api/jobman/calendar?search=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (!data.error) setJobs(data.jobs || []);
    } catch { /* silently fail */ }
  }, [searchQuery]);

  const handleDragStart = useCallback((jobId: string, task: CalendarTask, jobNumber: string) => {
    if (!task.startDate) return;
    setDraggingTask({ jobId, task, jobNumber, originalStartDate: task.startDate });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(dateStr);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(null);
    if (!draggingTask) return;
    if (dateStr !== draggingTask.originalStartDate) {
      setCascadeModal({
        jobId: draggingTask.jobId,
        taskId: draggingTask.task.id,
        taskName: draggingTask.task.name,
        newDate: dateStr,
      });
    }
    setDraggingTask(null);
  }, [draggingTask]);

  const handleDragEnd = useCallback(() => {
    setDraggingTask(null);
    setDragOverDate(null);
  }, []);

  const runCascade = useCallback(async () => {
    if (!cascadeModal) return;
    setIsCascading(true);
    try {
      const res = await fetch("/api/jobman/smart-cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: cascadeModal.jobId,
          anchorTaskId: cascadeModal.taskId,
          newStartDate: cascadeModal.newDate,
        }),
      });
      const data = await res.json();
      setCascadeResults(data.steps || []);
      await reloadJobs();
    } catch {
      setError("Failed to run cascade.");
    }
    setIsCascading(false);
  }, [cascadeModal, reloadJobs]);

  const groupedJobs = useMemo(() => {
    const parents = jobs.filter((j) => !j.isWorkOrder);
    const workOrders = jobs.filter((j) => j.isWorkOrder);
    return parents.map((parent) => ({
      ...parent,
      workOrders: workOrders.filter((wo) => wo.parentNumber === parent.number),
    }));
  }, [jobs]);

  function getTaskBar(task: CalendarTask) {
    const start = task.startDate ? parseYMD(task.startDate) : null;
    const end = task.targetDate ? parseYMD(task.targetDate) : null;
    if (!start && !end) return null;

    const barStart = start || end!;
    const barEnd = end || start!;
    const viewStartTime = dates[0].getTime();
    const viewEndTime = dates[dates.length - 1].getTime();

    if (barEnd.getTime() < viewStartTime || barStart.getTime() > viewEndTime) return null;

    const startCol = Math.max(0, daysBetween(dates[0], barStart));
    const endCol = Math.min(daysToShow - 1, daysBetween(dates[0], barEnd));
    const span = endCol - startCol + 1;

    return { startCol, span };
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--color-bg)" }}>
      {/* ── Header ────────────────────────────────── */}
      <header
        className="shrink-0 border-b"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white text-sm font-bold" style={{ background: "var(--color-primary)" }}>
              JM
            </div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--color-text)" }}>Schedule Calendar</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search jobs..."
                className="w-72 rounded-xl border px-4 py-2.5 text-base outline-none focus:ring-2"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
              />
              {isLoading && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>
            <Link
              href="/"
              className="rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--color-text-secondary)", background: "var(--color-surface-alt)" }}
            >
              Cascade Tool
            </Link>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between border-t px-6 py-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigateView(-1)}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: "var(--color-surface-alt)", color: "var(--color-text-secondary)" }}
            >
              ← Prev
            </button>
            <button
              onClick={goToToday}
              className="rounded-lg px-5 py-2 text-sm font-semibold transition-colors hover:opacity-80"
              style={{ background: "var(--color-primary-light)", color: "var(--color-primary)" }}
            >
              Today
            </button>
            <button
              onClick={() => navigateView(1)}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: "var(--color-surface-alt)", color: "var(--color-text-secondary)" }}
            >
              Next →
            </button>
          </div>

          <p className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
            {formatShortDate(dates[0])} — {formatShortDate(dates[dates.length - 1])}
          </p>

          <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-alt)" }}>
            {(["week", "2week", "month"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  background: viewMode === mode ? "var(--color-primary)" : "transparent",
                  color: viewMode === mode ? "white" : "var(--color-text-secondary)",
                }}
              >
                {mode === "week" ? "1 Week" : mode === "2week" ? "2 Weeks" : "Month"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Error ─────────────────────────────────── */}
      {error && (
        <div className="mx-6 mt-3 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm" style={{ background: "var(--color-danger-light)", borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          <span className="text-base">!</span>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100 text-base">✕</button>
        </div>
      )}

      {/* ── Timeline Grid ─────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {jobs.length === 0 ? (
          <div className="flex h-full items-center justify-center" style={{ color: "var(--color-text-muted)" }}>
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl text-4xl" style={{ background: "var(--color-surface-alt)" }}>📅</div>
              <p className="text-lg font-medium">Search for a job to view the schedule</p>
              <p className="mt-2 text-sm">Drag tasks to new dates to trigger a cascade</p>
            </div>
          </div>
        ) : (
          <div className="min-w-max">
            {/* Date header row */}
            <div className="sticky top-0 z-20 flex border-b" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
              {/* Job label column */}
              <div className="shrink-0 border-r px-4 py-3 flex items-end" style={{ width: JOB_COL_W, borderColor: "var(--color-border)" }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Job</span>
              </div>
              {/* Date columns */}
              {dates.map((date) => {
                const { day, weekday, month } = formatDayHeader(date);
                const isToday = isSameDay(date, today);
                const weekend = isWeekend(date);
                return (
                  <div
                    key={toYMD(date)}
                    className="shrink-0 flex flex-col items-center justify-center border-r py-2"
                    style={{
                      width: COL_W,
                      borderColor: "var(--color-border)",
                      background: isToday ? "var(--color-primary-light)" : weekend ? "var(--color-surface-alt)" : undefined,
                    }}
                  >
                    <span className="text-xs font-medium" style={{ color: isToday ? "var(--color-primary)" : "var(--color-text-muted)" }}>{weekday}</span>
                    <span
                      className={`text-lg font-bold ${isToday ? "flex h-8 w-8 items-center justify-center rounded-full text-white" : ""}`}
                      style={{ color: isToday ? undefined : "var(--color-text)", background: isToday ? "var(--color-primary)" : undefined }}
                    >
                      {day}
                    </span>
                    <span className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>{month}</span>
                  </div>
                );
              })}
            </div>

            {/* Job rows */}
            {groupedJobs.map((parentGroup) => (
              <div key={parentGroup.id}>
                <JobRow
                  job={parentGroup}
                  dates={dates}
                  today={today}
                  daysToShow={daysToShow}
                  isParent
                  dragOverDate={dragOverDate}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  getTaskBar={getTaskBar}
                />
                {parentGroup.workOrders.map((wo) => (
                  <JobRow
                    key={wo.id}
                    job={wo}
                    dates={dates}
                    today={today}
                    daysToShow={daysToShow}
                    isParent={false}
                    dragOverDate={dragOverDate}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    getTaskBar={getTaskBar}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Cascade Confirmation Modal ─────────────── */}
      {cascadeModal && !cascadeResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="mx-4 w-full max-w-lg rounded-2xl border p-8 shadow-2xl" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
            <h3 className="text-xl font-semibold mb-3" style={{ color: "var(--color-text)" }}>Run Smart Cascade?</h3>
            <p className="text-base mb-5" style={{ color: "var(--color-text-secondary)" }}>
              Move <strong style={{ color: "var(--color-text)" }}>{cascadeModal.taskName}</strong> to{" "}
              <strong style={{ color: "var(--color-primary)" }}>{formatShortDate(parseYMD(cascadeModal.newDate))}</strong>
              {" "}and cascade all related dates?
            </p>
            <ol className="mb-5 ml-5 space-y-2 text-sm list-decimal" style={{ color: "var(--color-text-secondary)" }}>
              <li>Reverse-calculate all tasks before this one</li>
              <li>Forward-calculate all tasks after the next task</li>
              <li>Cascade all work orders</li>
            </ol>
            <div className="mb-5 rounded-xl border px-4 py-3 text-sm" style={{ background: "var(--color-warning-light)", borderColor: "var(--color-warning)", color: "var(--color-warning)" }}>
              This action cannot be undone.
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setCascadeModal(null); setCascadeResults(null); }}
                className="flex-1 rounded-xl px-5 py-3 text-base font-medium"
                style={{ background: "var(--color-surface-alt)", color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={runCascade}
                disabled={isCascading}
                className="flex-1 rounded-xl px-5 py-3 text-base font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--color-primary)" }}
              >
                {isCascading ? (
                  <span className="flex items-center justify-center gap-2"><Spinner /> Running...</span>
                ) : (
                  "Run Cascade"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cascade Results Modal ──────────────────── */}
      {cascadeResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="mx-4 w-full max-w-lg rounded-2xl border p-8 shadow-2xl max-h-[80vh] overflow-y-auto" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
            <h3 className="text-xl font-semibold mb-4" style={{ color: "var(--color-text)" }}>Cascade Complete</h3>
            <div className="space-y-3 mb-5">
              {cascadeResults.map((r, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--color-border)", background: r.success ? "var(--color-success-light)" : "var(--color-danger-light)" }}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white mt-0.5" style={{ background: r.success ? "var(--color-success)" : "var(--color-danger)" }}>
                    {r.step}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{r.description}</p>
                    {r.dateSet && (
                      <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                        {r.dateSet !== "skipped — no next task or no finish date on anchor"
                          ? `Date: ${formatShortDate(parseYMD(r.dateSet))} (${r.direction})`
                          : r.dateSet}
                      </p>
                    )}
                    {!r.success && r.error && (
                      <p className="text-xs mt-1" style={{ color: "var(--color-danger)" }}>{r.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setCascadeModal(null); setCascadeResults(null); }}
              className="w-full rounded-xl px-5 py-3 text-base font-semibold text-white"
              style={{ background: "var(--color-primary)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Job Row Component ────────────────────────────────────────

function JobRow({
  job,
  dates,
  today,
  isParent,
  dragOverDate,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  getTaskBar,
}: {
  job: CalendarJob;
  dates: Date[];
  today: Date;
  daysToShow: number;
  isParent: boolean;
  dragOverDate: string | null;
  onDragStart: (jobId: string, task: CalendarTask, jobNumber: string) => void;
  onDragOver: (e: React.DragEvent, dateStr: string) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  onDragEnd: () => void;
  getTaskBar: (task: CalendarTask) => { startCol: number; span: number } | null;
}) {
  const tasksWithBars = job.tasks
    .map((task) => ({ task, bar: getTaskBar(task) }))
    .filter((t) => t.bar !== null) as { task: CalendarTask; bar: { startCol: number; span: number } }[];

  const rowHeight = tasksWithBars.length > 0
    ? Math.max(56, tasksWithBars.length * BAR_GAP + 16)
    : 56;

  return (
    <div className="flex border-b" style={{ borderColor: "var(--color-border)" }}>
      {/* Job label */}
      <div
        className="shrink-0 border-r px-4 py-3 flex flex-col justify-center"
        style={{
          width: JOB_COL_W,
          borderColor: "var(--color-border)",
          paddingLeft: isParent ? "16px" : "36px",
          background: isParent ? "var(--color-surface)" : undefined,
        }}
      >
        <p className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
          {isParent && <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: "var(--color-primary)" }} />}
          {job.number}
        </p>
        <p className="text-xs truncate mt-0.5" style={{ color: "var(--color-text-muted)" }} title={job.name}>
          {job.name}
        </p>
      </div>

      {/* Timeline cells */}
      <div className="relative flex" style={{ minHeight: `${rowHeight}px` }}>
        {dates.map((date) => {
          const dateStr = toYMD(date);
          const isToday = isSameDay(date, today);
          const weekend = isWeekend(date);
          const isDragOver = dragOverDate === dateStr;

          return (
            <div
              key={dateStr}
              className="shrink-0 border-r"
              style={{
                width: COL_W,
                borderColor: "var(--color-border)",
                background: isDragOver
                  ? "var(--color-primary-light)"
                  : isToday
                    ? "color-mix(in srgb, var(--color-primary-light) 30%, transparent)"
                    : weekend
                      ? "var(--color-surface-alt)"
                      : undefined,
              }}
              onDragOver={(e) => onDragOver(e, dateStr)}
              onDrop={(e) => onDrop(e, dateStr)}
            />
          );
        })}

        {/* Task bars overlaid on the grid */}
        {tasksWithBars.map(({ task, bar }, idx) => {
          const color = getTaskColor(task.name);
          return (
            <div
              key={task.id}
              draggable
              onDragStart={() => onDragStart(job.id, task, job.number)}
              onDragEnd={onDragEnd}
              className="absolute rounded-lg px-3 py-1 text-xs font-semibold truncate cursor-grab active:cursor-grabbing transition-shadow hover:shadow-lg"
              style={{
                left: `${bar.startCol * COL_W}px`,
                width: `${bar.span * COL_W - 6}px`,
                top: `${idx * BAR_GAP + 8}px`,
                height: `${BAR_H}px`,
                lineHeight: `${BAR_H - 8}px`,
                background: color.bg,
                borderLeft: `4px solid ${color.border}`,
                color: color.text,
              }}
              title={`${task.name}\nStart: ${task.startDate || "—"}\nEnd: ${task.targetDate || "—"}`}
            >
              {task.name}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 animate-spin ${className}`} fill="none" viewBox="0 0 24 24" style={{ color: "var(--color-primary)" }}>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
