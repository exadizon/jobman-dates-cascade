import { NextRequest, NextResponse } from "next/server";
import {
  searchJobs,
  getRecentJobs,
  getJob,
  getJobSteps,
  getRelatedJobs,
  getJobDisplayName,
  filterWorkOrders,
} from "@/lib/jobman";
import type { JobTask } from "@/lib/jobman";

export interface CalendarJob {
  id: string;
  number: string;
  name: string;
  isWorkOrder: boolean;
  parentNumber?: string;
  tasks: CalendarTask[];
}

export interface CalendarTask {
  id: string;
  name: string;
  stepName: string;
  startDate: string | null;
  targetDate: string | null;
  status: string;
  progress: number;
  locked: boolean;
}

// ─── Server-side cache ────────────────────────────────────────
// Prevents hammering the Jobman API on every page load / re-render.
// Data is cached per search key for CACHE_TTL_MS.

const CACHE_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const DELAY_BETWEEN_JOBS_MS = 400;         // throttle between parent-job fetches
const DELAY_BETWEEN_WORK_ORDERS_MS = 250;  // throttle between work-order step fetches
const MAX_PARENT_JOBS = 5;                 // limit parent jobs to reduce API call volume
const MAX_WORK_ORDERS_PER_JOB = 4;        // cap work orders per parent

interface CacheEntry {
  jobs: CalendarJob[];
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();

function getCached(key: string): CalendarJob[] | null {
  const entry = responseCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.jobs;
}

function setCached(key: string, jobs: CalendarJob[]) {
  responseCache.set(key, { jobs, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Helpers ──────────────────────────────────────────────────

function mapTask(task: JobTask, stepName: string): CalendarTask {
  return {
    id: task.id,
    name: task.name,
    stepName,
    startDate: task.start_date ? task.start_date.split("T")[0] : null,
    targetDate: task.target_date ? task.target_date.split("T")[0] : null,
    status: task.status,
    progress: task.progress,
    locked: task.target_date_locked,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Route handler ────────────────────────────────────────────

/**
 * GET /api/jobman/calendar?search=...
 *
 * When `search` ≥ 2 chars: searches Jobman by name/number.
 * When empty: loads the most recently updated jobs (no search param).
 *
 * Results are cached server-side for 5 minutes per search key.
 * Requests are throttled ~100 ms apart to avoid Jobman rate limits.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";

  // Force-bust the cache with ?refresh=1 (handy after a cascade)
  const forceRefresh = searchParams.get("refresh") === "1";

  const cacheKey = search.length >= 2 ? `search:${search}` : "__recent__";

  if (!forceRefresh) {
    const cached = getCached(cacheKey);
    if (cached) {
      console.log(`[Calendar] Cache hit for "${cacheKey}" (${cached.length} jobs)`);
      return NextResponse.json({ jobs: cached, cached: true });
    }
  }

  // Collects debug info returned alongside the jobs so the client can display it
  const debugLog: string[] = [];
  const log = (msg: string) => { console.log(`[Calendar] ${msg}`); debugLog.push(msg); };

  try {
    // Resolve the initial list — search or recent
    let searchResults: { id: string; number: string; name: string; description: string | null }[];

    if (search.length >= 2) {
      log(`Searching Jobman for "${search}"…`);
      searchResults = await searchJobs(search);
      log(`Search returned ${searchResults.length} result(s): ${searchResults.map(r => r.number).join(", ") || "(none)"}`);
    } else {
      log("No search query — calling getRecentJobs(40) and prioritising parent jobs…");
      try {
        // Fetch more than we need so we can prioritise parent jobs over work orders.
        // Work orders ARE still included — they'll be processed with isWorkOrder=true
        // (detected via their "X.Y" number format).
        const all = await getRecentJobs(40);
        // Sort: parent jobs first (no dot), then work orders — gives 5 parents in the budget
        searchResults = [
          ...all.filter(r => !r.number.includes(".")),
          ...all.filter(r => r.number.includes(".")),
        ];
        log(`getRecentJobs returned ${all.length} result(s): ${all.map(r => r.number).join(", ") || "(none)"}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`getRecentJobs FAILED: ${msg}`);
        return NextResponse.json({ jobs: [], noAutoLoad: true, debug: debugLog });
      }
    }

    if (searchResults.length === 0) {
      log("No results — returning empty jobs list");
      setCached(cacheKey, []);
      return NextResponse.json({ jobs: [], debug: debugLog });
    }

    const calendarJobs: CalendarJob[] = [];
    const processedJobIds = new Set<string>();

    // Process up to MAX_PARENT_JOBS — each triggers several sub-requests
    for (const result of searchResults.slice(0, MAX_PARENT_JOBS)) {
      if (processedJobIds.has(result.id)) { log(`Skip duplicate job ${result.number}`); continue; }
      processedJobIds.add(result.id);

      // Detect work orders by their number pattern, e.g. "0177.1"
      // When Jobman search or getRecentJobs returns work orders directly,
      // they must be flagged correctly so site_measure tasks are matched.
      const isWorkOrder = result.number.includes(".");
      const parentNumber = isWorkOrder ? result.number.split(".")[0] : undefined;

      let job;
      try {
        job = await getJob(result.id);
        log(`Fetched ${isWorkOrder ? "WO" : "job"} ${job.number} (id=${job.id})`);
      } catch (err) {
        log(`Failed to fetch job ${result.number}: ${err instanceof Error ? err.message : String(err)}`);
        continue; // skip this job on error
      }

      // Fetch tasks for this job/WO
      let tasks: CalendarTask[] = [];
      try {
        const steps = await getJobSteps(job.id);
        tasks = steps.flatMap((step) =>
          (step.tasks || []).map((task: JobTask) => mapTask(task, step.name))
        );
        log(`  ${job.number} (isWO=${isWorkOrder}) → ${tasks.length} task(s): ${tasks.map(t => `"${t.name}" [start=${t.startDate ?? "null"}, target=${t.targetDate ?? "null"}]`).join("; ") || "(none)"}`);
      } catch (err) {
        log(`  ${job.number} → getJobSteps failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      calendarJobs.push({
        id: job.id,
        number: job.number,
        name: getJobDisplayName(job),
        isWorkOrder,
        parentNumber,
        tasks,
      });

      // Only fetch work orders for parent jobs — WOs have no children
      if (!isWorkOrder) {
        try {
          const relatedJobs = await getRelatedJobs(job);
          const workOrders = filterWorkOrders(job.number, relatedJobs)
            .slice(0, MAX_WORK_ORDERS_PER_JOB);
          log(`  ${job.number} → ${relatedJobs.length} related job(s), ${workOrders.length} work order(s): ${workOrders.map(w => w.number).join(", ") || "(none)"}`);

          for (const wo of workOrders) {
            if (processedJobIds.has(wo.id)) { log(`  Skip duplicate WO ${wo.number}`); continue; }
            processedJobIds.add(wo.id);

            let woTasks: CalendarTask[] = [];
            try {
              await sleep(DELAY_BETWEEN_WORK_ORDERS_MS); // throttle between WO step fetches
              const woSteps = await getJobSteps(wo.id);
              woTasks = woSteps.flatMap((step) =>
                (step.tasks || []).map((task: JobTask) => mapTask(task, step.name))
              );
              log(`  WO ${wo.number} → ${woTasks.length} task(s): ${woTasks.map(t => `"${t.name}" [start=${t.startDate ?? "null"}, target=${t.targetDate ?? "null"}]`).join("; ") || "(none)"}`);
            } catch (err) {
              log(`  WO ${wo.number} → getJobSteps failed: ${err instanceof Error ? err.message : String(err)}`);
            }

            calendarJobs.push({
              id: wo.id,
              number: wo.number,
              name: getJobDisplayName(wo),
              isWorkOrder: true,
              parentNumber: job.number,
              tasks: woTasks,
            });
          }
        } catch (err) {
          log(`  ${job.number} → getRelatedJobs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Small delay between parent jobs to stay under Jobman rate limits
      await sleep(DELAY_BETWEEN_JOBS_MS);
    }

    log(`Done — returning ${calendarJobs.length} calendar job(s)`);
    setCached(cacheKey, calendarJobs);
    return NextResponse.json({ jobs: calendarJobs, debug: debugLog });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch calendar data";
    log(`Unhandled error: ${message}`);
    return NextResponse.json({ error: message, debug: debugLog }, { status: 500 });
  }
}
