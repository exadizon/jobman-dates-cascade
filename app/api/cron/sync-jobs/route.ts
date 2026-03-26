import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  getAllJobs,
  getJob,
  getJobSteps,
  getRelatedJobs,
  getJobDisplayName,
  filterWorkOrders,
} from "@/lib/jobman";
import type { JobTask } from "@/lib/jobman";
import type { CalendarJob, CalendarTask } from "@/app/api/jobman/calendar/route";

const REDIS_CACHE_KEY = "jobman:calendar:all";
const CACHE_TTL_SECONDS = 60 * 60 * 25; // 25 hours — survives until next cron
const DELAY_BETWEEN_JOBS_MS = 300;
const DELAY_BETWEEN_WORK_ORDERS_MS = 200;
const MAX_WORK_ORDERS_PER_JOB = 6;

function getRedis() {
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

const JOBMAN_TIMEZONE = process.env.JOBMAN_TIMEZONE || "Pacific/Auckland";

function parseJobmanDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  if (!dateStr.includes("T")) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split("T")[0];
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
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(request: NextRequest) {
  // Verify this is called by Vercel cron or by us manually with the secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  const out = (msg: string) => { console.log(`[SyncJobs] ${msg}`); log.push(msg); };

  try {
    out("Starting full job sync…");
    const allRefs = await getAllJobs((n) => out(`  …${n} refs fetched`));
    out(`Total refs: ${allRefs.length}`);

    // Parents first, then work orders
    const ordered = [
      ...allRefs.filter((r) => !r.number.includes(".")),
      ...allRefs.filter((r) => r.number.includes(".")),
    ];

    const calendarJobs: CalendarJob[] = [];
    const processedIds = new Set<string>();

    for (const ref of ordered) {
      if (processedIds.has(ref.id)) continue;
      processedIds.add(ref.id);

      const isWorkOrder = ref.number.includes(".");
      const parentNumber = isWorkOrder ? ref.number.split(".")[0] : undefined;

      let job;
      try {
        job = await getJob(ref.id);
      } catch (err) {
        out(`  ${ref.number} → fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      // Skip soft-deleted jobs
      if (job.trashed_at) {
        await sleep(DELAY_BETWEEN_JOBS_MS);
        continue;
      }

      let tasks: CalendarTask[] = [];
      try {
        const steps = await getJobSteps(job.id);
        tasks = steps.flatMap((step) =>
          (step.tasks || []).map((task: JobTask) => mapTask(task, step.name))
        );
      } catch { /* skip */ }

      const hasDates = tasks.some((t) => t.startDate || t.targetDate);
      if (!hasDates && !isWorkOrder) {
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
        jobTypes: (job.types || []).map((t) => t.name),
        tasks,
      });

      if (!isWorkOrder) {
        try {
          const related = await getRelatedJobs(job);
          const wos = filterWorkOrders(job.number, related).slice(0, MAX_WORK_ORDERS_PER_JOB);
          for (const wo of wos) {
            if (processedIds.has(wo.id)) continue;
            processedIds.add(wo.id);
            await sleep(DELAY_BETWEEN_WORK_ORDERS_MS);
            let woTasks: CalendarTask[] = [];
            try {
              const woSteps = await getJobSteps(wo.id);
              woTasks = woSteps.flatMap((step) =>
                (step.tasks || []).map((t: JobTask) => mapTask(t, step.name))
              );
            } catch { /* skip */ }
            calendarJobs.push({
              id: wo.id,
              number: wo.number,
              name: getJobDisplayName(wo),
              description: wo.description ?? null,
              isWorkOrder: true,
              parentNumber: job.number,
              jobTypes: (job.types || []).map((t) => t.name), // inherit parent job's types
              tasks: woTasks,
            });
          }
        } catch { /* skip */ }
      }

      await sleep(DELAY_BETWEEN_JOBS_MS);
    }

    out(`Sync complete — ${calendarJobs.length} calendar jobs`);

    // Write to Redis in chunks to avoid payload size limits (max 1MB per key)
    const redis = getRedis();
    await redis.set(REDIS_CACHE_KEY, calendarJobs, { ex: CACHE_TTL_SECONDS });
    out(`Stored in Redis (TTL: ${CACHE_TTL_SECONDS}s)`);

    return NextResponse.json({ ok: true, count: calendarJobs.length, log });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out(`Fatal error: ${message}`);
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}
