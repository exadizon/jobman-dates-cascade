"use client";

import { useState, useCallback, useRef, useMemo, useEffect, Suspense } from "react";
// import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

// ─── Misc items ───────────────────────────────────────────────

interface MiscItem {
  id: string;
  date: string; // YYYY-MM-DD
  text: string;
}

const MISC_STORAGE_KEY = "calendar_misc_items";

function loadMiscItems(): MiscItem[] {
  try {
    const raw = localStorage.getItem(MISC_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MiscItem[]) : [];
  } catch { return []; }
}

function saveMiscItems(items: MiscItem[]) {
  try { localStorage.setItem(MISC_STORAGE_KEY, JSON.stringify(items)); } catch { /* storage full */ }
}

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
  description: string | null;
  isWorkOrder: boolean;
  parentNumber?: string;
  jobTypes: string[];
  tasks: CalendarTask[];
}

interface CalendarEvent {
  taskId: string;
  jobId: string;
  jobNumber: string;
  /** Parent job number for work orders (e.g. "0177" instead of "0177.1") */
  displayJobNumber: string;
  /** Job description for display on the pill (uses parent job description for work orders) */
  jobDescription: string | null;
  taskName: string;
  taskType: TaskType;
  date: string;       // YYYY-MM-DD — the date this pill appears on
  /** Which API field this date came from — determines which field to update on drag */
  dateField: "startDate" | "targetDate";
  startDate: string | null;
  targetDate: string | null;
  isWorkOrder: boolean;
  jobTypes: string[];
}

interface CascadeStepResult {
  step: number;
  description: string;
  success: boolean;
  error?: string;
  dateSet?: string;
  direction?: string;
  jobNumber?: string;
  taskName?: string;
  returnedStart?: string | null;
  returnedTarget?: string | null;
  drift?: string;
  freshStart?: string | null;
  freshTarget?: string | null;
}

// ─── Task Type Config ──────────────────────────────────────────

type TaskType = "site_measure" | "primary_install" | "worktop_install" | "final_fit_off" | "cut_from_machining" | "pallet_collected" | "edge_banding";

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
  cut_from_machining: {
    label: "Cut from Machining",
    keywords: ["cut from machining", "cut from", "machining"],
    jobSource: "any",
    bg: "#dbeafe",
    border: "#2563eb",
    text: "#1e3a5f",
    dot: "#2563eb",
  },
  edge_banding: {
    label: "Edge Banding",
    keywords: ["edge banding", "edgebanding"],
    jobSource: "any",
    bg: "#fef3c7",
    border: "#d97706",
    text: "#78350f",
    dot: "#d97706",
  },
  pallet_collected: {
    label: "Pallet Collected",
    keywords: ["pallet collected"],
    jobSource: "work_order",
    bg: "#ccfbf1",
    border: "#0d9488",
    text: "#134e4a",
    dot: "#0d9488",
  },
};

function matchTaskType(taskName: string, stepName: string, isWorkOrder: boolean): TaskType | null {
  const lowerTask = taskName.toLowerCase();
  const lowerStep = stepName.toLowerCase();
  for (const [type, config] of Object.entries(TASK_TYPES) as [TaskType, TaskTypeConfig][]) {
    if (config.jobSource === "work_order" && !isWorkOrder) continue;
    if (config.jobSource === "parent" && isWorkOrder) continue;
    if (config.keywords.some((kw) => lowerTask.includes(kw) || lowerStep.includes(kw))) return type;
  }
  return null;
}

// When a task of the key type is moved, also move tasks of the value types
// on the same job to the same date.
const LINKED_TASKS: Partial<Record<TaskType, TaskType[]>> = {
  cut_from_machining: ["edge_banding"],
};

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

// ─── Spanning event helpers ───────────────────────────────────

interface SpanPlacement {
  event: CalendarEvent;
  startCol: number;
  endCol: number;
  isClippedStart: boolean;
  isClippedEnd: boolean;
}

function getSpanningForWeek(week: Date[], spanning: CalendarEvent[]): SpanPlacement[] {
  const weekDates = week.map((d) => toYMD(d));
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  return spanning
    .filter((e) => e.targetDate! >= weekStart && e.startDate! <= weekEnd)
    .map((e) => {
      const clampedStart = e.startDate! < weekStart ? weekStart : e.startDate!;
      const clampedEnd = e.targetDate! > weekEnd ? weekEnd : e.targetDate!;
      return {
        event: e,
        startCol: weekDates.indexOf(clampedStart),
        endCol: weekDates.indexOf(clampedEnd),
        isClippedStart: e.startDate! < weekStart,
        isClippedEnd: e.targetDate! > weekEnd,
      };
    });
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
  const isDebugMode = searchParams.get("debug") === "1";

  const [activeTaskTypes, setActiveTaskTypes] = useState<Set<TaskType>>(
    () => new Set<TaskType>(["site_measure", "primary_install", "worktop_install", "final_fit_off", "cut_from_machining", "pallet_collected"])
  );

  // null = show all, "qt" = Queenstown only, "akl" = Auckland only
  const [regionFilter, setRegionFilter] = useState<"qt" | "akl" | null>(null);

  const toggleRegion = useCallback((region: "qt" | "akl") => {
    setRegionFilter((prev) => (prev === region ? null : region));
  }, []);

  const [draggingEvent, setDraggingEvent] = useState<CalendarEvent | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const [cascadeModal, setCascadeModal] = useState<{
    jobId: string; taskId: string; taskName: string; newDate: string; taskType: TaskType; dateField: "startDate" | "targetDate";
  } | null>(null);
  const [isCascading, setIsCascading] = useState(false);
  const [cascadeResults, setCascadeResults] = useState<CascadeStepResult[] | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [editModal, setEditModal] = useState<{
    jobId: string; taskId: string; taskName: string; displayJobNumber: string; jobDescription: string | null;
    taskType: TaskType; editDate: string;
  } | null>(null);

  const [miscItems, setMiscItems] = useState<MiscItem[]>([]);
  const [miscModal, setMiscModal] = useState<{ date: string; editing: MiscItem | null } | null>(null);
  const [miscDraft, setMiscDraft] = useState("");

  // Load misc items from localStorage on mount
  useEffect(() => { setMiscItems(loadMiscItems()); }, []);

  const openMiscModal = useCallback((date: string) => {
    const existing = miscItems.find((m) => m.date === date) ?? null;
    setMiscDraft(existing?.text ?? "");
    setMiscModal({ date, editing: existing });
  }, [miscItems]);

  const saveMisc = useCallback(() => {
    if (!miscModal) return;
    const text = miscDraft.trim();
    setMiscItems((prev) => {
      let next: MiscItem[];
      if (!text) {
        // Empty text → delete
        next = prev.filter((m) => m.id !== miscModal.editing?.id);
      } else if (miscModal.editing) {
        next = prev.map((m) => m.id === miscModal.editing!.id ? { ...m, text } : m);
      } else {
        next = [...prev, { id: crypto.randomUUID(), date: miscModal.date, text }];
      }
      saveMiscItems(next);
      return next;
    });
    setMiscModal(null);
  }, [miscModal, miscDraft]);

  const deleteMisc = useCallback((id: string) => {
    setMiscItems((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveMiscItems(next);
      return next;
    });
    setMiscModal(null);
  }, []);

  const fetchTimeout = useRef<NodeJS.Timeout | null>(null);
  // Prevents click handler from firing immediately after a drag operation
  const isDraggingRef = useRef(false);
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
      } else if (data.noCache) {
        // No cache yet — auto-trigger an incremental sync
        setError("Syncing jobs from Jobman… this may take a moment.");
        fetch("/api/cron/sync-jobs?mode=incremental")
          .then(() => fetch(`/api/jobman/calendar`))
          .then((r) => r.json())
          .then((d) => {
            if (d.jobs?.length) {
              setAllJobs(d.jobs);
              try { localStorage.setItem("calendar_last_jobs", JSON.stringify(d.jobs)); } catch { /* storage full */ }
              setError(null);
            }
          })
          .catch(() => { /* ignore — user can use Sync Now */ });
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

  // Poll Redis cache every 5 minutes so the calendar stays fresh
  useEffect(() => {
    const interval = setInterval(() => {
      // Only poll when not actively searching (search already fetches live data)
      if (!searchQuery.trim()) fetchJobs();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

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

  // Trigger an incremental sync from Jobman → Redis, then reload
  const triggerSync = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    try {
      await fetch("/api/cron/sync-jobs?mode=incremental");
      await fetchJobs();
    } catch {
      setError("Sync failed — try again or search for a specific job.");
    }
    setIsSyncing(false);
  }, [fetchJobs]);

  // After a cascade/move, reload the affected job's data.
  // In search mode: re-run the active search (gets fresh results for all visible jobs).
  // In full-calendar mode: do a targeted search for just the changed job and merge it back in,
  // avoiding the forceRefresh path that returns noCache and shows a stale/broken calendar.
  const reloadJobs = useCallback(async (specificJobNumber?: string) => {
    if (searchQuery.trim().length >= 2) {
      await fetchJobs(searchQuery.trim());
      return;
    }
    if (specificJobNumber) {
      try {
        const res = await fetch(`/api/jobman/calendar?search=${encodeURIComponent(specificJobNumber)}`);
        const data = await res.json();
        if (!data.error && data.jobs?.length) {
          setAllJobs((prev) => {
            const filtered = prev.filter((j) => {
              const parentNum = j.isWorkOrder ? j.number.split(".")[0] : j.number;
              return parentNum !== specificJobNumber;
            });
            const next = [...filtered, ...data.jobs];
            try { localStorage.setItem("calendar_last_jobs", JSON.stringify(next)); } catch { /* storage full */ }
            return next;
          });
        }
      } catch { /* ignore reload failures silently */ }
      return;
    }
    // Fallback: no search and no job number — can't efficiently refresh in full-calendar mode
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

  // Split events into single-day pills and multi-day spanning bars.
  // Deduplicates by (displayJobNumber + taskType) for spanning and
  // (displayJobNumber + taskType + date) for single-day events.
  const { singleDayEvents, spanningEvents } = useMemo<{
    singleDayEvents: CalendarEvent[];
    spanningEvents: CalendarEvent[];
  }>(() => {
    const parentDescriptions = new Map<string, string | null>();
    for (const job of filteredJobs) {
      if (!job.isWorkOrder) {
        parentDescriptions.set(job.number, job.description);
      }
    }

    const single: CalendarEvent[] = [];
    const spanning: CalendarEvent[] = [];
    const seenSingle = new Set<string>();
    const seenSpanning = new Set<string>();

    for (const job of filteredJobs) {
      const displayJobNumber = job.isWorkOrder
        ? (job.parentNumber ?? job.number.split(".")[0])
        : job.number;
      const jobDescription = job.isWorkOrder
        ? (parentDescriptions.get(displayJobNumber) ?? job.description)
        : job.description;

      for (const task of job.tasks) {
        const taskType = matchTaskType(task.name, task.stepName, job.isWorkOrder);
        if (!taskType || !activeTaskTypes.has(taskType)) continue;

        // Region filter
        if (regionFilter === "qt" && !(job.jobTypes ?? []).some((t) => t.toLowerCase().includes("queenstown"))) continue;
        if (regionFilter === "akl" && !(job.jobTypes ?? []).some((t) => t.toLowerCase().includes("auckland"))) continue;

        const eventBase = {
          taskId: task.id,
          jobId: job.id,
          jobNumber: job.number,
          displayJobNumber,
          jobDescription,
          taskName: task.name,
          taskType,
          isWorkOrder: job.isWorkOrder,
          jobTypes: job.jobTypes,
          startDate: task.startDate,
          targetDate: task.targetDate,
        };

        // Multi-day event → spanning bar
        if (task.startDate && task.targetDate && task.startDate !== task.targetDate) {
          const key = `${displayJobNumber}:${taskType}`;
          if (!seenSpanning.has(key)) {
            seenSpanning.add(key);
            spanning.push({ ...eventBase, date: task.startDate, dateField: "startDate" as const });
          }
          continue;
        }

        // Single-day event → pill in day cell
        // Dedup by job + taskType (no date) so each job shows at most one pill
        // per task type — prevents the same job appearing on multiple days when
        // parent and work order both match.
        const date = task.startDate || task.targetDate;
        if (!date) continue;
        const dateField: "startDate" | "targetDate" = task.startDate ? "startDate" : "targetDate";
        const key = `${displayJobNumber}:${taskType}`;
        if (seenSingle.has(key)) continue;
        seenSingle.add(key);

        single.push({ ...eventBase, date, dateField });
      }
    }
    return { singleDayEvents: single, spanningEvents: spanning };
  }, [filteredJobs, activeTaskTypes, regionFilter]);

  const getEventsForDate = useCallback(
    (dateStr: string) => singleDayEvents.filter((e) => e.date === dateStr),
    [singleDayEvents]
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

  const handleDragStart = useCallback((event: CalendarEvent) => {
    isDraggingRef.current = true;
    setDraggingEvent(event);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(dateStr);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(null);
    if (!draggingEvent || dateStr === draggingEvent.date) { setDraggingEvent(null); return; }
    setCascadeModal({ jobId: draggingEvent.jobId, taskId: draggingEvent.taskId, taskName: draggingEvent.taskName, newDate: dateStr, taskType: draggingEvent.taskType, dateField: draggingEvent.dateField });
    setDraggingEvent(null);
  }, [draggingEvent]);
  const handleDragEnd = useCallback(() => {
    setDraggingEvent(null);
    setDragOverDate(null);
    // Keep flag true briefly so onClick doesn't fire right after a drag ends
    setTimeout(() => { isDraggingRef.current = false; }, 150);
  }, []);

  const runCascade = useCallback(async () => {
    if (!cascadeModal) return;
    setIsCascading(true);
    const parentNum = allJobs.find((j) => j.id === cascadeModal.jobId)?.number.split(".")[0];
    try {
      const res = await fetch("/api/jobman/smart-cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: cascadeModal.jobId, anchorTaskId: cascadeModal.taskId, newStartDate: cascadeModal.newDate }),
      });
      const data = await res.json();
      await new Promise((r) => setTimeout(r, 800));
      await reloadJobs(parentNum);
      setCascadeResults(data.steps || []);
    } catch {
      setError("Failed to run cascade.");
    }
    setIsCascading(false);
  }, [cascadeModal, reloadJobs, allJobs]);

  // Move a single task without cascading (for non-primary-install tasks)
  const runSingleMove = useCallback(async () => {
    if (!cascadeModal) return;
    setIsCascading(true);
    const parentNum = allJobs.find((j) => j.id === cascadeModal.jobId)?.number.split(".")[0];
    try {
      const res = await fetch("/api/jobman/task-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: cascadeModal.jobId,
          taskId: cascadeModal.taskId,
          startDate: cascadeModal.newDate,
          targetDate: cascadeModal.newDate,
          direction: "none",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to move task");

      // Move linked tasks (e.g. Edge Banding when Cut is moved)
      const linkedResults: CascadeStepResult[] = [];
      const linkedTypes = LINKED_TASKS[cascadeModal.taskType];
      if (linkedTypes?.length) {
        const job = allJobs.find((j) => j.id === cascadeModal.jobId);
        if (job) {
          for (const linkedType of linkedTypes) {
            const linkedTask = job.tasks.find((t) => {
              const mt = matchTaskType(t.name, t.stepName, job.isWorkOrder);
              return mt === linkedType;
            });
            if (linkedTask) {
              try {
                await fetch("/api/jobman/task-date", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ jobId: job.id, taskId: linkedTask.id, startDate: cascadeModal.newDate, targetDate: cascadeModal.newDate, direction: "none" }),
                });
                linkedResults.push({ step: 2, description: `Linked: moved "${linkedTask.name}" to ${formatShortDate(parseYMD(cascadeModal.newDate))}`, success: true, dateSet: cascadeModal.newDate });
              } catch {
                linkedResults.push({ step: 2, description: `Linked: failed to move "${linkedTask.name}"`, success: false });
              }
            }
          }
        }
      }

      await new Promise((r) => setTimeout(r, 800));
      await reloadJobs(parentNum);
      setCascadeResults([
        { step: 1, description: `Moved "${cascadeModal.taskName}" to ${formatShortDate(parseYMD(cascadeModal.newDate))}`, success: true, dateSet: cascadeModal.newDate },
        ...linkedResults,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move task.");
      setCascadeModal(null);
    }
    setIsCascading(false);
  }, [cascadeModal, reloadJobs, allJobs]);

  // Save dates from the click-to-edit modal
  const runEditSave = useCallback(async () => {
    if (!editModal) return;
    setIsCascading(true);
    try {
      if (editModal.taskType === "primary_install") {
        const res = await fetch("/api/jobman/smart-cascade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: editModal.jobId, anchorTaskId: editModal.taskId, newStartDate: editModal.editDate }),
        });
        const data = await res.json();
        await new Promise((r) => setTimeout(r, 800));
        await reloadJobs(editModal.displayJobNumber);
        setCascadeResults(data.steps || []);
      } else {
        // For single-day tasks, set both startDate and targetDate to keep them in sync
        const res = await fetch("/api/jobman/task-date", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: editModal.jobId, taskId: editModal.taskId, startDate: editModal.editDate, targetDate: editModal.editDate, direction: "none" }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to update dates");

        // Move linked tasks (e.g. Edge Banding when Cut is moved)
        const linkedResults: CascadeStepResult[] = [];
        const linkedTypes = LINKED_TASKS[editModal.taskType];
        if (linkedTypes?.length) {
          const job = allJobs.find((j) => j.id === editModal.jobId);
          if (job) {
            for (const linkedType of linkedTypes) {
              const linkedTask = job.tasks.find((t) => {
                const mt = matchTaskType(t.name, t.stepName, job.isWorkOrder);
                return mt === linkedType;
              });
              if (linkedTask) {
                try {
                  await fetch("/api/jobman/task-date", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobId: job.id, taskId: linkedTask.id, startDate: editModal.editDate, targetDate: editModal.editDate, direction: "none" }),
                  });
                  linkedResults.push({ step: 2, description: `Linked: moved "${linkedTask.name}" to ${formatShortDate(parseYMD(editModal.editDate))}`, success: true, dateSet: editModal.editDate });
                } catch {
                  linkedResults.push({ step: 2, description: `Linked: failed to move "${linkedTask.name}"`, success: false });
                }
              }
            }
          }
        }

        await new Promise((r) => setTimeout(r, 800));
        await reloadJobs(editModal.displayJobNumber);
        setCascadeResults([
          { step: 1, description: `Moved "${editModal.taskName}" to ${formatShortDate(parseYMD(editModal.editDate))}`, success: true, dateSet: editModal.editDate },
          ...linkedResults,
        ]);
      }
      setEditModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update dates");
      setEditModal(null);
    }
    setIsCascading(false);
  }, [editModal, reloadJobs, allJobs]);

  // ── Render ───────────────────────────────────────────────────

  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="flex h-screen flex-col" style={{ background: "#f7f7f6" }}>

      {/* ── Top bar ──────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b bg-white" style={{ borderColor: "#e4e4e0" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-xs font-semibold tracking-wide" style={{ background: "#454E49" }}>
            ID
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold" style={{ color: "#1a1c1a" }}>Inspire Design</span>
            <span className="text-xs" style={{ color: "#9a9e9b" }}>Schedule</span>
          </div>
        </div>

        <div className="h-5 w-px mx-1" style={{ background: "#e4e4e0" }} />

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "#9a9e9b" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search jobs…"
            className="w-56 rounded-lg pl-9 pr-4 py-2 text-sm outline-none transition-all"
            style={{
              background: "#f7f7f6",
              border: "1px solid #e4e4e0",
              color: "#1a1c1a",
            }}
          />
          {isLoading && allJobs.length > 0 && searchQuery.trim().length >= 2 && <Spinner className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2" />}
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
          {/* <Link href="/cascade" className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50" style={{ borderColor: "#e4e4e0", color: "#4a4f4b" }}>
            Cascade Tool
          </Link> */}
        </div>
      </div>

      {/* ── Calendar toolbar ──────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b bg-white" style={{ borderColor: "#e4e4e0" }}>
        {/* Month navigation */}
        <div className="flex items-center gap-1">
          <button onClick={() => navigateMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-gray-100" style={{ color: "#4a4f4b" }} title="Previous month">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={goToToday} className="rounded-lg border px-3 py-1 text-xs font-medium transition-colors hover:bg-gray-50" style={{ borderColor: "#e4e4e0", color: "#4a4f4b" }}>
            Today
          </button>
          <button onClick={() => navigateMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-gray-100" style={{ color: "#4a4f4b" }} title="Next month">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <h2 className="text-base font-semibold w-44" style={{ color: "#1a1c1a" }}>
          {formatMonthYear(currentMonth)}
        </h2>

        {/* Divider */}
        <div className="h-5 w-px mx-1" style={{ background: "#e4e4e0" }} />

        {/* Task type filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.entries(TASK_TYPES) as [TaskType, TaskTypeConfig][]).filter(([type]) => type !== "edge_banding").map(([type, config]) => {
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

        {/* Divider */}
        <div className="h-5 w-px mx-1" style={{ background: "#e4e4e0" }} />

        {/* Region filters */}
        <div className="flex items-center gap-1.5">
          {([["qt", "QT"], ["akl", "AKL"]] as const).map(([region, label]) => {
            const active = regionFilter === region;
            return (
              <button
                key={region}
                onClick={() => toggleRegion(region)}
                className="rounded-full px-3 py-1 text-xs font-semibold border transition-all select-none"
                style={{
                  background: active ? "#1a1c1a" : "white",
                  borderColor: active ? "#1a1c1a" : "#d1d5db",
                  color: active ? "white" : "#9ca3af",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Sync + Job count */}
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={triggerSync}
            disabled={isSyncing}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50 disabled:opacity-50"
            style={{ borderColor: "#e4e4e0", color: "#4a4f4b" }}
            title="Sync latest jobs from Jobman"
          >
            {isSyncing ? "Syncing…" : "Sync Now"}
          </button>
          {allJobs.length > 0 && (
            <span className="text-xs" style={{ color: "#9a9e9b" }}>
              {filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Debug log panel ───────────────────────── */}
      {debugLog.length > 0 && showDebug && (
        <div className="mx-5 mt-2 rounded-lg border border-amber-200 bg-amber-50 text-xs">
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-amber-800 font-medium hover:bg-amber-100 transition-colors rounded-lg"
          >
            <span className="opacity-60">▼</span>
            API Debug Log ({debugLog.length} lines) — check browser console for full output
          </button>
          <div className="border-t border-amber-200 px-3 py-2 font-mono text-amber-900 space-y-0.5 max-h-64 overflow-y-auto">
            {debugLog.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────── */}
      {error && (
        <div className="mx-5 mt-2 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-50 hover:opacity-100 text-base leading-none">✕</button>
        </div>
      )}


      {/* ── Calendar ──────────────────────────────── */}
      <div className="flex-1 overflow-auto relative">
        {/* ── Initial loading state ── */}
        {isLoading && allJobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <Spinner className="h-7 w-7" />
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "#4a4f4b" }}>Fetching jobs from Jobman…</p>
              <p className="text-xs mt-1" style={{ color: "#9a9e9b" }}>This may take a few seconds</p>
            </div>
          </div>
        )}

        {/* Weekday header */}
        <div className={`grid grid-cols-7 border-b sticky top-0 bg-white z-10 ${isLoading && allJobs.length === 0 ? "hidden" : ""}`} style={{ borderColor: "#e4e4e0" }}>
          {WEEKDAYS.map((day, i) => (
            <div
              key={day}
              className="py-2.5 text-center text-xs font-semibold tracking-wider uppercase"
              style={{ color: i >= 5 ? "#d1d5db" : "#9a9e9b" }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Month grid */}
        <div className={isLoading && allJobs.length === 0 ? "hidden" : ""}>
          {weeks.map((week, wi) => {
            const weekSpanning = getSpanningForWeek(week, spanningEvents);
            const weekDates = week.map((d) => toYMD(d));
            return (
              <div key={wi} className="border-b" style={{ borderColor: "#ebebea" }}>
                <div className="grid grid-cols-7" style={{ minHeight: "120px" }}>
                  {week.map((date, di) => {
                    const dateStr = weekDates[di];
                    const dayEvents = getEventsForDate(dateStr);
                    const dayMiscItems = miscItems.filter((m) => m.date === dateStr);
                    const inMonth = date.getMonth() === currentMonth.getMonth();
                    const isToday = isSameDay(date, today);
                    const weekend = isWeekend(date);
                    const isDragOver = dragOverDate === dateStr;

                    return (
                      <div
                        key={dateStr}
                        className="border-r p-1.5 transition-colors relative cursor-pointer overflow-hidden"
                        style={{
                          borderColor: "#ebebea",
                          background: isDragOver
                            ? "#edeeed"
                            : isToday
                              ? "#fafaf9"
                              : weekend
                                ? "#f7f7f5"
                                : inMonth
                                  ? "white"
                                  : "#f9f9f8",
                        }}
                        onClick={() => openMiscModal(dateStr)}
                        onDragOver={(e) => handleDragOver(e, dateStr)}
                        onDrop={(e) => handleDrop(e, dateStr)}
                      >
                        {/* Date number */}
                        <div className="flex justify-start mb-1 pl-0.5">
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full text-xs"
                            style={{
                              background: isToday ? "#454E49" : "transparent",
                              color: isToday ? "white" : inMonth ? "#1a1c1a" : "#d1d5db",
                              fontWeight: isToday ? 600 : inMonth ? 500 : 400,
                              fontFamily: "var(--font-mono), monospace",
                            }}
                          >
                            {date.getDate()}
                          </span>
                        </div>

                        {/* Spanning event bars (continuation strips) */}
                        {weekSpanning.length > 0 && (
                          <div className="space-y-0.5 mb-0.5">
                            {weekSpanning.map((span) => {
                              const isActive = dateStr >= weekDates[span.startCol] && dateStr <= weekDates[span.endCol];
                              if (!isActive) return <div key={`ph-${span.event.taskId}`} style={{ height: "20px" }} />;

                              const cfg = TASK_TYPES[span.event.taskType];
                              const isFirstDay = weekDates[span.startCol] === dateStr;
                              const isLastDay = weekDates[span.endCol] === dateStr;

                              return (
                                <div
                                  key={`span-${span.event.taskId}`}
                                  className="py-0.5 text-xs font-medium truncate cursor-grab active:cursor-grabbing hover:brightness-95 transition-all"
                                  style={{
                                    background: cfg.bg,
                                    color: cfg.text,
                                    borderLeft: isFirstDay ? `3px solid ${cfg.border}` : `3px solid ${cfg.bg}`,
                                    marginLeft: isFirstDay ? 0 : "-6px",
                                    paddingLeft: isFirstDay ? "6px" : "4px",
                                    marginRight: isLastDay ? 0 : "-6px",
                                    paddingRight: isLastDay ? "6px" : "4px",
                                    borderRadius: `${isFirstDay ? "4px" : "0"} ${isLastDay ? "4px" : "0"} ${isLastDay ? "4px" : "0"} ${isFirstDay ? "4px" : "0"}`,
                                  }}
                                  draggable
                                  onDragStart={() => handleDragStart(span.event)}
                                  onDragEnd={handleDragEnd}
                                  onClick={(e) => {
                                    if (isDraggingRef.current) return;
                                    e.stopPropagation();
                                    setEditModal({
                                      jobId: span.event.jobId,
                                      taskId: span.event.taskId,
                                      taskName: span.event.taskName,
                                      displayJobNumber: span.event.displayJobNumber,
                                      jobDescription: span.event.jobDescription,
                                      taskType: span.event.taskType,
                                      editDate: span.event.startDate ?? span.event.date,
                                    });
                                  }}
                                  title={`${span.event.displayJobNumber}${span.event.jobDescription ? ` — ${span.event.jobDescription}` : ""} — ${cfg.label}`}
                                >
                                  {isFirstDay ? (
                                    <>
                                      <span style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 500 }}>{span.event.displayJobNumber}</span>
                                      {span.event.jobDescription && <span className="ml-1 opacity-75">{span.event.jobDescription}</span>}
                                    </>
                                  ) : (
                                    <span>&nbsp;</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Single-day event pills */}
                        <div className="space-y-0.5">
                          {dayEvents.map((event) => {
                            const cfg = TASK_TYPES[event.taskType];
                            return (
                              <div
                                key={event.taskId}
                                draggable
                                onDragStart={() => handleDragStart(event)}
                                onDragEnd={handleDragEnd}
                                onClick={(e) => {
                                  if (isDraggingRef.current) return;
                                  e.stopPropagation();
                                  setEditModal({
                                    jobId: event.jobId,
                                    taskId: event.taskId,
                                    taskName: event.taskName,
                                    displayJobNumber: event.displayJobNumber,
                                    jobDescription: event.jobDescription,
                                    taskType: event.taskType,
                                    editDate: event.startDate ?? event.date,
                                  });
                                }}
                                className="flex items-start gap-1 rounded px-1.5 py-0.5 text-xs font-medium cursor-grab active:cursor-grabbing hover:brightness-95 transition-all"
                                style={{
                                  background: cfg.bg,
                                  color: cfg.text,
                                  borderLeft: `3px solid ${cfg.border}`,
                                }}
                                title={`${event.displayJobNumber}${event.jobDescription ? ` — ${event.jobDescription}` : ""} — ${cfg.label}`}
                              >
                                <span className="shrink-0" style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 500 }}>{event.displayJobNumber}</span>
                                {event.jobDescription && (
                                  <span className="opacity-75 leading-tight truncate">{event.jobDescription}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Misc item pills */}
                        {dayMiscItems.map((item) => (
                          <div
                            key={item.id}
                            onClick={(e) => { e.stopPropagation(); openMiscModal(dateStr); }}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer hover:brightness-95 transition-all mt-0.5"
                            style={{ background: "#fef9c3", color: "#713f12", borderLeft: "3px solid #ca8a04" }}
                            title={item.text}
                          >
                            <span className="opacity-60">★</span>
                            <span className="truncate">{item.text}</span>
                          </div>
                        ))}

                        {/* Drag-over indicator */}
                        {isDragOver && (
                          <div className="absolute inset-0 rounded border-2 pointer-events-none" style={{ borderColor: "#454E49" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state (after load) */}
        {!isLoading && allJobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <svg className="h-10 w-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "#454E49" }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {requiresSearch ? (
              <div className="text-center">
                <p className="text-sm font-medium" style={{ color: "#4a4f4b" }}>Search for a job to get started</p>
                <p className="text-xs mt-1" style={{ color: "#9a9e9b" }}>Type a job number or name above</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium" style={{ color: "#4a4f4b" }}>No jobs found</p>
                <p className="text-xs mt-1" style={{ color: "#9a9e9b" }}>Try a different search or check your API connection</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Misc item modal ───────────────────── */}
      {miscModal && (
        <Modal>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            {miscModal.editing ? "Edit note" : "Add note"}
          </h3>
          <p className="text-sm text-gray-500 mb-4">{formatShortDate(parseYMD(miscModal.date))}</p>
          <textarea
            autoFocus
            value={miscDraft}
            onChange={(e) => setMiscDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveMisc(); } }}
            placeholder="Add a note…"
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none mb-4"
          />
          <div className="flex gap-3">
            {miscModal.editing && (
              <button onClick={() => deleteMisc(miscModal.editing!.id)} className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                Delete
              </button>
            )}
            <button onClick={() => setMiscModal(null)} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={saveMisc} className="flex-1 rounded-lg bg-yellow-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-yellow-600 transition-colors">
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* ── Click-to-edit dates modal ──────────── */}
      {editModal && !cascadeResults && (
        <Modal>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Edit Dates</h3>
          <p className="text-sm text-gray-500 mb-0.5">
            <span style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 500 }}>{editModal.displayJobNumber}</span>
            {editModal.jobDescription && <span className="ml-1.5">{editModal.jobDescription}</span>}
          </p>
          <p className="text-sm font-medium text-gray-700 mb-4">{editModal.taskName}</p>
          <div className="flex flex-col gap-3 mb-5">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">
                {editModal.taskType === "primary_install" ? "Start date" : "Date"}
              </span>
              <input
                type="date"
                value={editModal.editDate}
                onChange={(e) => setEditModal((m) => m ? { ...m, editDate: e.target.value } : m)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            {editModal.taskType === "primary_install" ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Moving Primary Install will cascade all related task dates automatically.
              </p>
            ) : (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-3.5 py-3">
                <svg className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3l9.66 16.5a1 1 0 01-.87 1.5H3.21a1 1 0 01-.87-1.5L12 3z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">{LINKED_TASKS[editModal.taskType] ? "Linked move" : "No cascade"}</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {LINKED_TASKS[editModal.taskType]
                      ? `This will also move ${LINKED_TASKS[editModal.taskType]!.map((lt) => TASK_TYPES[lt]?.label || lt).join(", ")} to the same date.`
                      : "Only this task's date will be changed. No other task dates will be affected."}
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setEditModal(null)} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={runEditSave} disabled={isCascading} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {isCascading
                ? <span className="flex items-center justify-center gap-2"><Spinner />Saving…</span>
                : editModal.taskType === "primary_install" ? "Move & Cascade" : "Save Dates"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Cascade / Move confirmation modal ──────────── */}
      {cascadeModal && !cascadeResults && (
        <Modal>
          {cascadeModal.taskType === "primary_install" ? (
            <>
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
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Move Task?</h3>
              <p className="text-sm text-gray-500 mb-4">
                Move <strong className="text-gray-800">{cascadeModal.taskName}</strong> to{" "}
                <strong className="text-blue-600">{formatShortDate(parseYMD(cascadeModal.newDate))}</strong>?
              </p>
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-3.5 py-3 mb-5">
                <svg className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3l9.66 16.5a1 1 0 01-.87 1.5H3.21a1 1 0 01-.87-1.5L12 3z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">{LINKED_TASKS[cascadeModal.taskType] ? "Linked move" : "No cascade"}</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {LINKED_TASKS[cascadeModal.taskType]
                      ? `This will also move ${LINKED_TASKS[cascadeModal.taskType]!.map((lt) => TASK_TYPES[lt]?.label || lt).join(", ")} to the same date.`
                      : "Only this task will be moved. No other task dates will be affected."}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setCascadeModal(null); setCascadeResults(null); }} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={runSingleMove} disabled={isCascading} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {isCascading ? <span className="flex items-center justify-center gap-2"><Spinner />Moving…</span> : "Move Task"}
                </button>
              </div>
            </>
          )}
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
                  {isDebugMode && r.success && (
                    <div className="mt-1 space-y-0.5 font-mono text-[10px] text-gray-600">
                      {r.drift && r.drift !== "ok" && (
                        <p className="text-red-600 font-semibold">drift {r.drift}</p>
                      )}
                      {r.returnedStart !== undefined && (
                        <p>sent={r.dateSet} ret_start={r.returnedStart ?? "—"} ret_target={r.returnedTarget ?? "—"}</p>
                      )}
                      {r.freshStart !== undefined && r.freshStart !== null && (
                        <p>fresh_start={r.freshStart} fresh_target={r.freshTarget ?? "—"}</p>
                      )}
                    </div>
                  )}
                  {!r.success && r.error && <p className="text-xs text-red-600 mt-0.5">{r.error}</p>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { setCascadeModal(null); setEditModal(null); setCascadeResults(null); }} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
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

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} style={{ color: "#454E49" }} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
