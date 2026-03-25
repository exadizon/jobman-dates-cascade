import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  searchJobs,
  getAllJobs,
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
  description: string | null;
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

// ─── Redis cache ───────────────────────────────────────────────
const REDIS_CACHE_KEY = "jobman:calendar:all";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const DELAY_BETWEEN_JOBS_MS = 200;
const DELAY_BETWEEN_WORK_ORDERS_MS = 150;
const MAX_WORK_ORDERS_PER_JOB = 6;

function getRedis() {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

// ─── Helpers ──────────────────────────────────────────────────

// Jobman is a NZ-based system. Dates are stored as NZ local time but may be
// returned as UTC ISO strings (e.g. midnight NZ = 11:00 previous day UTC).
// Parsing with the NZ timezone ensures the displayed date matches Jobman's UI.
const JOBMAN_TIMEZONE = process.env.JOBMAN_TIMEZONE || "Pacific/Auckland";

function parseJobmanDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  if (!dateStr.includes("T")) return dateStr; // already a bare date, no conversion needed
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split("T")[0]; // unparseable — best-effort fallback
  return new Intl.DateTimeFormat("en-CA", { timeZone: JOBMAN_TIMEZONE }).format(d);
}

function mapTask(task: JobTask, stepName: string): CalendarTask {
  return {
    id: task.id,
    name: task.name,
    stepName,
    startDate: parseJobmanDate(task.start_date),
    targetDate: parseJobmanDate(task.target_date),
    status: task.status,
    progress: task.progress,
    locked: task.target_date_locked,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Full job fetch (paginated, with tasks) ───────────────────

async function buildAllCalendarJobs(log: (msg: string) => void): Promise<CalendarJob[]> {
  log("Fetching all jobs from Jobman (paginated)…");
  const allJobRefs = await getAllJobs((n) => log(`  …${n} job refs fetched so far`));
  log(`Total job refs: ${allJobRefs.length}`);

  // Parent jobs first, then work orders
  const parents = allJobRefs.filter((r) => !r.number.includes("."));
  const workOrders = allJobRefs.filter((r) => r.number.includes("."));
  const ordered = [...parents, ...workOrders];

  const calendarJobs: CalendarJob[] = [];
  const processedJobIds = new Set<string>();

  for (const result of ordered) {
    if (processedJobIds.has(result.id)) continue;
    processedJobIds.add(result.id);

    const isWorkOrder = result.number.includes(".");
    const parentNumber = isWorkOrder ? result.number.split(".")[0] : undefined;

    let job;
    try {
      job = await getJob(result.id);
    } catch (err) {
      log(`Failed to fetch job ${result.number}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    let tasks: CalendarTask[] = [];
    try {
      const steps = await getJobSteps(job.id);
      tasks = steps.flatMap((step) =>
        (step.tasks || []).map((task: JobTask) => mapTask(task, step.name))
      );
    } catch (err) {
      log(`  ${job.number} → getJobSteps failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Skip jobs with no dates — nothing to show on calendar
    const hasDates = tasks.some((t) => t.startDate || t.targetDate);
    if (!hasDates && !isWorkOrder) {
      log(`  ${job.number} → no dates, skipping`);
      await sleep(DELAY_BETWEEN_JOBS_MS);
      continue;
    }

    calendarJobs.push({
      id: job.id,
      number: job.number,
      name: getJobDisplayName(job),
      description: job.description ?? null,
      isWorkOrder,
      parentNumber,
      tasks,
    });

    // Fetch work orders for parent jobs
    if (!isWorkOrder) {
      try {
        const relatedJobs = await getRelatedJobs(job);
        const wos = filterWorkOrders(job.number, relatedJobs).slice(0, MAX_WORK_ORDERS_PER_JOB);
        log(`  ${job.number} → ${wos.length} work order(s): ${wos.map((w) => w.number).join(", ") || "(none)"}`);

        for (const wo of wos) {
          if (processedJobIds.has(wo.id)) continue;
          processedJobIds.add(wo.id);

          let woTasks: CalendarTask[] = [];
          try {
            await sleep(DELAY_BETWEEN_WORK_ORDERS_MS);
            const woSteps = await getJobSteps(wo.id);
            woTasks = woSteps.flatMap((step) =>
              (step.tasks || []).map((task: JobTask) => mapTask(task, step.name))
            );
          } catch (err) {
            log(`  WO ${wo.number} → getJobSteps failed: ${err instanceof Error ? err.message : String(err)}`);
          }

          calendarJobs.push({
            id: wo.id,
            number: wo.number,
            name: getJobDisplayName(wo),
            description: wo.description ?? null,
            isWorkOrder: true,
            parentNumber: job.number,
            tasks: woTasks,
          });
        }
      } catch (err) {
        log(`  ${job.number} → getRelatedJobs failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await sleep(DELAY_BETWEEN_JOBS_MS);
  }

  log(`Done — ${calendarJobs.length} calendar jobs built`);
  return calendarJobs;
}

// ─── Route handler ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const forceRefresh = searchParams.get("refresh") === "1";

  const debugLog: string[] = [];
  const log = (msg: string) => { console.log(`[Calendar] ${msg}`); debugLog.push(msg); };

  try {
    // ── Search mode — bypass cache ──────────────────────────────
    if (search.length >= 2) {
      log(`Searching Jobman for "${search}"…`);
      const searchResults = await searchJobs(search);
      log(`Search returned ${searchResults.length} result(s): ${searchResults.map((r) => r.number).join(", ") || "(none)"}`);

      const calendarJobs: CalendarJob[] = [];
      const processedJobIds = new Set<string>();

      for (const result of searchResults) {
        if (processedJobIds.has(result.id)) continue;
        processedJobIds.add(result.id);

        const isWorkOrder = result.number.includes(".");
        const parentNumber = isWorkOrder ? result.number.split(".")[0] : undefined;

        let job;
        try {
          job = await getJob(result.id);
          log(`Fetched ${isWorkOrder ? "WO" : "job"} ${job.number}`);
        } catch (err) {
          log(`Failed to fetch job ${result.number}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }

        let tasks: CalendarTask[] = [];
        try {
          const steps = await getJobSteps(job.id);
          tasks = steps.flatMap((step) =>
            (step.tasks || []).map((task: JobTask) => mapTask(task, step.name))
          );
        } catch (err) {
          log(`  ${job.number} → getJobSteps failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        calendarJobs.push({ id: job.id, number: job.number, name: getJobDisplayName(job), description: job.description ?? null, isWorkOrder, parentNumber, tasks });

        if (!isWorkOrder) {
          try {
            const relatedJobs = await getRelatedJobs(job);
            const wos = filterWorkOrders(job.number, relatedJobs).slice(0, MAX_WORK_ORDERS_PER_JOB);
            for (const wo of wos) {
              if (processedJobIds.has(wo.id)) continue;
              processedJobIds.add(wo.id);
              await sleep(DELAY_BETWEEN_WORK_ORDERS_MS);
              let woTasks: CalendarTask[] = [];
              try {
                const woSteps = await getJobSteps(wo.id);
                woTasks = woSteps.flatMap((step) =>
                  (step.tasks || []).map((task: JobTask) => mapTask(task, step.name))
                );
              } catch { /* skip */ }
              calendarJobs.push({ id: wo.id, number: wo.number, name: getJobDisplayName(wo), description: wo.description ?? null, isWorkOrder: true, parentNumber: job.number, tasks: woTasks });
            }
          } catch { /* skip */ }
        }

        await sleep(DELAY_BETWEEN_JOBS_MS);
      }

      log(`Search done — ${calendarJobs.length} calendar jobs`);
      return NextResponse.json({ jobs: calendarJobs, debug: debugLog });
    }

    // ── Default mode — read from Redis cache ───────────────────
    const redis = getRedis();
    const cached = await redis.get<CalendarJob[]>(REDIS_CACHE_KEY);

    if (cached && cached.length > 0 && !forceRefresh) {
      log(`Redis cache hit — ${cached.length} jobs`);
      return NextResponse.json({ jobs: cached, cached: true, debug: debugLog });
    }

    log("No cache yet — please run /api/cron/sync-jobs to populate");
    return NextResponse.json({
      jobs: [],
      noCache: true,
      debug: debugLog,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch calendar data";
    log(`Unhandled error: ${message}`);
    return NextResponse.json({ error: message, debug: debugLog }, { status: 500 });
  }
}
