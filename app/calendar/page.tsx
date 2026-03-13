"use client";

import { useState, useCallback, useRef, useMemo, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

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

interface CalendarEvent {
  taskId: string;
  jobId: string;
  jobNumber: string;
  /** Parent job number for work orders (e.g. "0177" instead of "0177.1") */
  displayJobNumber: string;
  taskName: string;
  taskType: TaskType;
  date: string;       // YYYY-MM-DD — the date this pill appears on
  targetDate: string | null;
  isWorkOrder: boolean;
}

interface CascadeStepResult {
  step: number;
  description: string;
  success: boolean;
  error?: string;
  dateSet?: string;
  direction?: string;
}

// ─── Task Type Config ──────────────────────────────────────────

type TaskType = "site_measure" | "primary_install" | "worktop_install" | "final_fit_off";

interface TaskTypeConfig {
  label: string;
  keywords: string[];
  jobSource: "work_order" | "parent" | "any";
  bg: string;
  border: string;
  text: string;
  dot: string; // solid colour for the toggle dot
}

const TASK_TYPES: Record<TaskType, TaskTypeConfig> = {
  site_measure: {
    label: "Site Measure",
    keywords: ["site measure"],
    jobSource: "work_order",   // site measures live on work orders (e.g. 177.1)
    bg: "#ede9fe",
    border: "#7c3aed",
    text: "#4c1d95",
    dot: "#7c3aed",
  },
  primary_install: {
    label: "Primary Install",
    keywords: ["primary install"],
    jobSource: "parent",       // primary install lives on the parent job
    bg: "#dcfce7",
    border: "#16a34a",
    text: "#14532d",
    dot: "#16a34a",
  },
  worktop_install: {
    label: "Worktop Install",
    keywords: ["worktop"],
    jobSource: "any",          // may appear on parent or a dedicated WO
    bg: "#fff7ed",
    border: "#ea580c",
    text: "#7c2d12",
    dot: "#ea580c",
  },
  final_fit_off: {
    label: "Final Fit Off",
    keywords: ["fit off", "final fit"],
    jobSource: "parent",       // final fit off lives on the parent job
    bg: "#fdf2f8",
    border: "#db2777",
    text: "#831843",
    dot: "#db2777",
  },
};

function matchTaskType(taskName: string, isWorkOrder: boolean): TaskType | null {
  const lower = taskName.toLowerCase();
  for (const [type, config] of Object.entries(TASK_TYPES) as [TaskType, TaskTypeConfig][]) {
    if (config.jobSource === "work_order" && !isWorkOrder) continue;
    if (config.jobSource === "parent" && isWorkOrder) continue;
    if (config.keywords.some((kw) => lower.includes(kw))) return type;
  }
  return null;
}

// ─── Date Helpers ─────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Local-time YYYY-MM-DD — avoids UTC off-by-one in UTC+ timezones
function toYMD(date: Date): string {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

// Parse as local midnight — matches toYMD
function parseYMD(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isWeekend(date: Date): boolean {
  return date.getDay() === 0 || date.getDay() === 6;
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// All Mon–Sun weeks that overlap the given month
function getMonthWeeks(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const weeks: Date[][] = [];
  let cursor = getMonday(firstDay);
  while (cursor <= lastDay) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) week.push(addDays(cursor, i));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

// ─── Main Component ───────────────────────────────────────────

// Wrapped in Suspense (in the default export) because useSearchParams requires it
function CalendarContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // All jobs fetched from the API — never filtered
  const [allJobs, setAllJobs] = useState<CalendarJob[]>([]);
  // Whether the Jobman API supports listing without a search query
  const [requiresSearch, setRequiresSearch] = useState(false);
  // Initialise from URL ?q= — localStorage read happens in useEffect to avoid SSR mismatch
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const [activeTaskTypes, setActiveTaskTypes] = useState<Set<TaskType>>(
    () => new Set<TaskType>(["site_measure", "primary_install", "worktop_install", "final_fit_off"])
  );

  const [draggingEvent, setDraggingEvent] = useState<CalendarEvent | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const [cascadeModal, setCascadeModal] = useState<{
    jobId: string; taskId: string; taskName: string; newDate: string;
  } | null>(null);
  const [isCascading, setIsCascading] = useState(false);
  const [cascadeResults, setCascadeResults] = useState<CascadeStepResult[] | null>(null);

  const fetchTimeout = useRef<NodeJS.Timeout | null>(null);
  const today = useMemo(() => new Date(), []);
  const weeks = useMemo(() => getMonthWeeks(currentMonth.getFullYear(), currentMonth.getMonth()), [currentMonth]);

  // ── Data fetching ────────────────────────────────────────────

  const fetchJobs = useCallback(async (search?: string, forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (forceRefresh) params.set("refresh", "1");
      const url = `/api/jobman/calendar${params.size ? "?" + params.toString() : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      // Always capture + dump debug log if present
      if (data.debug?.length) {
        setDebugLog(data.debug);
        console.group("[Calendar API debug]");
        (data.debug as string[]).forEach((line) => console.log(line));
        console.groupEnd();
      }
      if (data.error) {
        setError(data.error);
      } else if (data.noAutoLoad) {
        // Jobman API doesn't support listing without a search query
        setRequiresSearch(true);
      } else {
        const jobs = data.jobs || [];
        setAllJobs(jobs);
        // Persist so the calendar is pre-populated on next load
        try { localStorage.setItem("calendar_last_jobs", JSON.stringify(jobs)); } catch { /* storage full */ }
      }
    } catch {
      setError("Failed to load calendar data.");
    }
    setIsLoading(false);
  }, []);

  // On mount: restore from localStorage (safe here — client only), then fetch fresh data
  useEffect(() => {
    // Restore cached jobs immediately so the calendar isn't blank
    try {
      const raw = localStorage.getItem("calendar_last_jobs");
      if (raw) setAllJobs(JSON.parse(raw) as CalendarJob[]);
    } catch { /* ignore */ }

    // Determine query: URL param → localStorage → empty
    const q = searchParams.get("q") || localStorage.getItem("calendar_last_search") || "";
    if (q.trim().length >= 2) {
      setSearchQuery(q.trim());
      fetchJobs(q.trim());
    } else {
      fetchJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  // Debounced search — updates URL and triggers API call after 500ms
  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);

    // Keep URL + localStorage in sync so refreshing restores the same search
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim());
    const newUrl = `/calendar${params.size ? "?" + params.toString() : ""}`;
    router.replace(newUrl, { scroll: false });
    if (value.trim().length >= 2) {
      localStorage.setItem("calendar_last_search", value.trim());
    } else if (value.trim().length === 0) {
      localStorage.removeItem("calendar_last_search");
    }

    if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    fetchTimeout.current = setTimeout(() => {
      if (value.trim().length >= 2) {
        fetchJobs(value.trim());
      } else if (value.trim().length === 0) {
        fetchJobs(); // reload recent
      }
    }, 500);
  }, [fetchJobs, router]);

  const reloadJobs = useCallback(async () => {
    const search = searchQuery.trim().length >= 2 ? searchQuery.trim() : undefined;
    await fetchJobs(search, true); // force-refresh to bust server cache after cascade
  }, [fetchJobs, searchQuery]);

  // ── Derived data ─────────────────────────────────────────────

  // Client-side text filter (instant, no API call) for 1-char queries
  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0 || q.length >= 2) return allJobs; // API handles 2+ char searches
    return allJobs.filter(
      (j) => j.number.toLowerCase().includes(q) || j.name.toLowerCase().includes(q)
    );
  }, [allJobs, searchQuery]);

  // Flat event list from filtered jobs, respecting active task type filters.
  // Deduplicates by (displayJobNumber + taskType + date) so multiple work orders
  // for the same parent don't produce duplicate pills for the same task type on the same day.
  const events = useMemo<CalendarEvent[]>(() => {
    const result: CalendarEvent[] = [];
    const seen = new Set<string>();
    for (const job of filteredJobs) {
      // For work orders, show the parent number (e.g. "0177" not "0177.1")
      const displayJobNumber = job.isWorkOrder
        ? (job.parentNumber ?? job.number.split(".")[0])
        : job.number;

      for (const task of job.tasks) {
        const date = task.startDate || task.targetDate;
        if (!date) continue;
        const taskType = matchTaskType(task.name, job.isWorkOrder);
        if (!taskType || !activeTaskTypes.has(taskType)) continue;

        // Deduplicate: same parent job, same task type, same date → show only once
        const key = `${displayJobNumber}:${taskType}:${date}`;
        if (seen.has(key)) continue;
        seen.add(key);

        result.push({
          taskId: task.id,
          jobId: job.id,
          jobNumber: job.number,
          displayJobNumber,
          taskName: task.name,
          taskType,
          date,
          targetDate: task.targetDate,
          isWorkOrder: job.isWorkOrder,
        });
      }
    }
    return result;
  }, [filteredJobs, activeTaskTypes]);

  const getEventsForDate = useCallback(
    (dateStr: string) => events.filter((e) => e.date === dateStr),
    [events]
  );

  // ── Navigation ───────────────────────────────────────────────

  const navigateMonth = useCallback((delta: number) => {
    setCurrentMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + delta);
      return d;
    });
  }, []);

  const goToToday = useCallback(() => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const toggleTaskType = useCallback((type: TaskType) => {
    setActiveTaskTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // ── Drag & drop ──────────────────────────────────────────────

  const handleDragStart = useCallback((event: CalendarEvent) => setDraggingEvent(event), []);
  const handleDragOver = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(dateStr);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(null);
    if (!draggingEvent || dateStr === draggingEvent.date) { setDraggingEvent(null); return; }
    setCascadeModal({ jobId: draggingEvent.jobId, taskId: draggingEvent.taskId, taskName: draggingEvent.taskName, newDate: dateStr });
    setDraggingEvent(null);
  }, [draggingEvent]);
  const handleDragEnd = useCallback(() => { setDraggingEvent(null); setDragOverDate(null); }, []);

  const runCascade = useCallback(async () => {
    if (!cascadeModal) return;
    setIsCascading(true);
    try {
      const res = await fetch("/api/jobman/smart-cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: cascadeModal.jobId, anchorTaskId: cascadeModal.taskId, newStartDate: cascadeModal.newDate }),
      });
      const data = await res.json();
      // Brief pause to let Jobman commit the date changes before we re-fetch
      await new Promise((r) => setTimeout(r, 800));
      // Reload calendar data FIRST so it's ready when the user closes the results modal
      await reloadJobs();
      setCascadeResults(data.steps || []);
    } catch {
      setError("Failed to run cascade.");
    }
    setIsCascading(false);
  }, [cascadeModal, reloadJobs]);

  // ── Render ───────────────────────────────────────────────────

  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="flex h-screen flex-col bg-white" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* ── Top bar ──────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b" style={{ borderColor: "#e5e7eb" }}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-xs font-bold" style={{ background: "#2563eb" }}>
            JM
          </div>
          <span className="font-semibold text-gray-800 text-sm">Schedule</span>
        </div>

        {/* Search */}
        <div className="relative ml-2">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search jobs…"
            className="w-56 rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2 text-sm text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
          />
          {isLoading && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {debugLog.length > 0 && (
            <button
              onClick={() => setShowDebug((v) => !v)}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
              title="Toggle API debug log"
            >
              Debug {showDebug ? "▲" : "▼"}
            </button>
          )}
          <Link href="/" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors">
            Cascade Tool
          </Link>
        </div>
      </div>

      {/* ── Calendar toolbar ──────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b" style={{ borderColor: "#e5e7eb" }}>
        {/* Month navigation */}
        <div className="flex items-center gap-1">
          <button onClick={() => navigateMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" title="Previous month">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={goToToday} className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Today
          </button>
          <button onClick={() => navigateMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" title="Next month">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <h2 className="text-base font-semibold text-gray-800 w-44">
          {formatMonthYear(currentMonth)}
        </h2>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-200 mx-1" />

        {/* Task type filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.entries(TASK_TYPES) as [TaskType, TaskTypeConfig][]).map(([type, config]) => {
            const active = activeTaskTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleTaskType(type)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-all select-none"
                style={{
                  background: active ? config.bg : "white",
                  borderColor: active ? config.border : "#d1d5db",
                  color: active ? config.text : "#9ca3af",
                  opacity: active ? 1 : 0.7,
                }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                  style={{ background: active ? config.dot : "#d1d5db" }}
                />
                {config.label}
              </button>
            );
          })}
        </div>

        {/* Job count badge */}
        {allJobs.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">
            {filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""} loaded
          </span>
        )}
      </div>

      {/* ── Error ─────────────────────────────────── */}
      {error && (
        <div className="mx-5 mt-2 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-50 hover:opacity-100 text-base leading-none">✕</button>
        </div>
      )}

      {/* ── Debug log panel ───────────────────────── */}
      {debugLog.length > 0 && (
        <div className="mx-5 mt-2 rounded-lg border border-amber-200 bg-amber-50 text-xs">
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-amber-800 font-medium hover:bg-amber-100 transition-colors rounded-lg"
          >
            <span className="opacity-60">{showDebug ? "▼" : "▶"}</span>
            API Debug Log ({debugLog.length} lines) — check browser console for full output
          </button>
          {showDebug && (
            <div className="border-t border-amber-200 px-3 py-2 font-mono text-amber-900 space-y-0.5 max-h-64 overflow-y-auto">
              {debugLog.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Calendar ──────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b sticky top-0 bg-white z-10" style={{ borderColor: "#e5e7eb" }}>
          {WEEKDAYS.map((day, i) => (
            <div
              key={day}
              className="py-2.5 text-center text-xs font-semibold tracking-wider uppercase"
              style={{ color: i >= 5 ? "#d1d5db" : "#6b7280" }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Month grid */}
        <div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b" style={{ borderColor: "#f3f4f6", minHeight: "120px" }}>
              {week.map((date) => {
                const dateStr = toYMD(date);
                const dayEvents = getEventsForDate(dateStr);
                const inMonth = date.getMonth() === currentMonth.getMonth();
                const isToday = isSameDay(date, today);
                const weekend = isWeekend(date);
                const isDragOver = dragOverDate === dateStr;

                return (
                  <div
                    key={dateStr}
                    className="border-r p-1.5 transition-colors relative"
                    style={{
                      borderColor: "#f3f4f6",
                      background: isDragOver
                        ? "#eff6ff"
                        : isToday
                          ? "#fafbff"
                          : weekend && !inMonth
                            ? "#fafafa"
                            : weekend
                              ? "#fafafa"
                              : inMonth
                                ? "white"
                                : "#f9fafb",
                    }}
                    onDragOver={(e) => handleDragOver(e, dateStr)}
                    onDrop={(e) => handleDrop(e, dateStr)}
                  >
                    {/* Date number */}
                    <div className="flex justify-start mb-1 pl-0.5">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
                        style={{
                          background: isToday ? "#2563eb" : "transparent",
                          color: isToday ? "white" : inMonth ? "#374151" : "#d1d5db",
                          fontWeight: isToday ? 700 : inMonth ? 500 : 400,
                        }}
                      >
                        {date.getDate()}
                      </span>
                    </div>

                    {/* Event pills */}
                    <div className="space-y-0.5">
                      {dayEvents.map((event) => {
                        const cfg = TASK_TYPES[event.taskType];
                        return (
                          <div
                            key={event.taskId}
                            draggable
                            onDragStart={() => handleDragStart(event)}
                            onDragEnd={handleDragEnd}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium truncate cursor-grab active:cursor-grabbing hover:brightness-95 transition-all"
                            style={{
                              background: cfg.bg,
                              color: cfg.text,
                              borderLeft: `3px solid ${cfg.border}`,
                            }}
                            title={`${event.displayJobNumber} — ${event.taskName}`}
                          >
                            <span className="font-bold shrink-0">{event.displayJobNumber}</span>
                            <span className="truncate opacity-75">{cfg.label}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Drag-over indicator */}
                    {isDragOver && (
                      <div className="absolute inset-0 rounded border-2 border-blue-400 pointer-events-none" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Empty state (after load) */}
        {!isLoading && allJobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <svg className="h-12 w-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {requiresSearch ? (
              <>
                <p className="text-sm font-medium text-gray-500">Search for a job to get started</p>
                <p className="text-xs mt-1">Type a job number or name in the search box above</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No jobs found</p>
                <p className="text-xs mt-1">Try a different search or check your API connection</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Cascade confirmation modal ──────────── */}
      {cascadeModal && !cascadeResults && (
        <Modal>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Run Smart Cascade?</h3>
          <p className="text-sm text-gray-500 mb-4">
            Move <strong className="text-gray-800">{cascadeModal.taskName}</strong> to{" "}
            <strong className="text-blue-600">{formatShortDate(parseYMD(cascadeModal.newDate))}</strong> and cascade all related dates?
          </p>
          <ol className="mb-4 ml-4 space-y-1 text-sm text-gray-500 list-decimal">
            <li>Reverse-calculate all tasks before this one</li>
            <li>Forward-calculate all tasks after the next task</li>
            <li>Cascade all work orders</li>
          </ol>
          <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            This action cannot be undone.
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setCascadeModal(null); setCascadeResults(null); }} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={runCascade} disabled={isCascading} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isCascading ? <span className="flex items-center justify-center gap-2"><Spinner />Running…</span> : "Run Cascade"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Cascade results modal ──────────────── */}
      {cascadeResults && (
        <Modal>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Cascade Complete</h3>
          <div className="space-y-2 mb-5 max-h-64 overflow-y-auto">
            {cascadeResults.map((r, i) => (
              <div key={i} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${r.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white mt-0.5 ${r.success ? "bg-green-500" : "bg-red-500"}`}>
                  {r.step}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{r.description}</p>
                  {r.dateSet && r.dateSet !== "skipped — no next task or no finish date on anchor" && (
                    <p className="text-xs text-gray-500 mt-0.5">→ {formatShortDate(parseYMD(r.dateSet))} ({r.direction})</p>
                  )}
                  {!r.success && r.error && <p className="text-xs text-red-600 mt-0.5">{r.error}</p>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { setCascadeModal(null); setCascadeResults(null); }} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            Close
          </button>
        </Modal>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center text-gray-400 text-sm">
        Loading calendar…
      </div>
    }>
      <CalendarContent />
    </Suspense>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white border border-gray-200 p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin text-blue-500 ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
