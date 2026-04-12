import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  getJob,
  getJobSteps,
  getRelatedJobs,
  updateTaskStartDate,
  updateTaskTargetDate,
  lockTaskTargetDate,
  unlockTaskTargetDate,
  filterWorkOrders,
} from "@/lib/jobman";
import type { JobTask } from "@/lib/jobman";
import { parseJobmanDate } from "@/lib/date-utils";
import type { CalendarJob, CalendarTask } from "@/app/api/jobman/calendar/route";

const REDIS_CACHE_KEY = "jobman:calendar:all";
const CACHE_TTL_SECONDS = 60 * 60 * 25;

interface SmartCascadeRequest {
  jobId: string;
  anchorTaskId: string; // The "Primary Install" task
  newStartDate: string; // YYYY-MM-DD
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
  returnedStart?: string | null;
  returnedTarget?: string | null;
  drift?: string;
  freshStart?: string | null;
  freshTarget?: string | null;
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}

function driftLabel(sent: string, returned: string | null | undefined): string | undefined {
  if (!returned) return undefined;
  const r = returned.split("T")[0];
  if (r === sent) return "ok";
  const d = dayDiff(sent, r);
  return `${d > 0 ? "+" : ""}${d}d`;
}

/**
 * POST /api/jobman/smart-cascade
 *
 * Implements Aaron's 3-step cascade workflow from the Loom video:
 *
 * Step 1: Set anchor task (Primary Install) start_date → reverse-calculate all tasks BEFORE
 * Step 2: Set next task (Install QA) start_date = anchor's target_date → forward-calculate all tasks AFTER
 * Step 3: For each work order, set last task start_date = install date → reverse-calculate BEFORE
 */
export async function POST(request: NextRequest) {
  let body: SmartCascadeRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { jobId, anchorTaskId, newStartDate } = body;

  if (!jobId || !anchorTaskId || !newStartDate) {
    return NextResponse.json(
      { error: "jobId, anchorTaskId, and newStartDate are required" },
      { status: 400 }
    );
  }

  const results: CascadeStepResult[] = [];

  try {
    // ─── Step 1a: Pin anchor task to the dropped date (no cascade yet) ───
    // Using direction "none" so Jobman doesn't shift the anchor itself when
    // recalculating preceding tasks — that was causing the off-by-one-day bug.
    console.log(`[SmartCascade] Step 1a: Pin anchor task ${anchorTaskId} start_date = ${newStartDate} (no cascade)`);

    let step1Result: CascadeStepResult;
    try {
      const anchorAfter = await updateTaskStartDate(jobId, anchorTaskId, newStartDate, "none");
      const returnedStart = parseJobmanDate(anchorAfter.start_date);
      const returnedTarget = parseJobmanDate(anchorAfter.target_date);
      step1Result = {
        step: 1,
        description: "Pin anchor task start date (no cascade)",
        success: true,
        jobId,
        taskId: anchorTaskId,
        dateSet: newStartDate,
        direction: "none",
        returnedStart,
        returnedTarget,
        drift: driftLabel(newStartDate, returnedStart),
      };
      console.log(
        `[SmartCascade] Step 1a DRIFT check: sent=${newStartDate} returned_start=${returnedStart} returned_target=${returnedTarget} drift=${step1Result.drift}`
      );
    } catch (error) {
      step1Result = {
        step: 1,
        description: "Pin anchor task start date",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
    results.push(step1Result);

    if (!step1Result.success) {
      return NextResponse.json({
        steps: results,
        summary: { total: 1, success: 0, failed: 1 },
      });
    }

    // ─── Step 1a-lock: Lock anchor's target_date to prevent Jobman auto-recalculation ───
    // Jobman's target_date_calculation offsets cause it to recalculate task dates
    // whenever a cascade event fires on the same job. Locking the anchor prevents
    // Steps 1b, 2, and 3 from snapping it to a recalculated offset date.
    let anchorLocked = false;
    try {
      await lockTaskTargetDate(jobId, anchorTaskId);
      anchorLocked = true;
      console.log(`[SmartCascade] Step 1a-lock: Locked anchor ${anchorTaskId} target_date`);
    } catch (lockError) {
      console.warn(`[SmartCascade] Step 1a-lock WARN: Could not lock anchor — ${lockError instanceof Error ? lockError.message : lockError}. Continuing anyway.`);
    }

    // ─── Step 1b: Reverse cascade from the task immediately before the anchor ───
    // Fetch current task list so we know what's before the anchor.
    const preSteps = await getJobSteps(jobId);
    const preTaskList: JobTask[] = preSteps.flatMap((s) => s.tasks || []);
    const preAnchorIndex = preTaskList.findIndex((t) => t.id === anchorTaskId);
    const taskBefore = preAnchorIndex > 0 ? preTaskList[preAnchorIndex - 1] : null;

    if (taskBefore) {
      // Target date of the task before = one day before the anchor's start date
      const anchorDate = new Date(newStartDate + "T00:00:00Z");
      anchorDate.setUTCDate(anchorDate.getUTCDate() - 1);
      const dayBefore = anchorDate.toISOString().split("T")[0];

      console.log(`[SmartCascade] Step 1b: Reverse cascade from "${taskBefore.name}" with target_date = ${dayBefore}`);

      try {
        const after = await updateTaskTargetDate(jobId, taskBefore.id, dayBefore, "before");
        const returnedStart = parseJobmanDate(after.start_date);
        const returnedTarget = parseJobmanDate(after.target_date);
        console.log(
          `[SmartCascade] Step 1b: sent_target=${dayBefore} returned_start=${returnedStart} returned_target=${returnedTarget}`
        );

        results.push({
          step: 1,
          description: `Reverse cascade from "${taskBefore.name}" (all tasks before)`,
          success: true,
          jobId,
          taskId: taskBefore.id,
          taskName: taskBefore.name,
          dateSet: dayBefore,
          direction: "before",
          returnedStart,
          returnedTarget,
          drift: driftLabel(dayBefore, returnedTarget),
        });
      } catch (error) {
        results.push({
          step: 1,
          description: `Reverse cascade from "${taskBefore.name}"`,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // ─── Step 2: Forward cascade from next task (Install QA) ───
    console.log(`[SmartCascade] Step 2: Fetching updated tasks to find anchor's finish date...`);

    // Re-fetch tasks to get anchor's updated target_date (finish date)
    const updatedSteps = await getJobSteps(jobId);
    const allTasks: JobTask[] = updatedSteps.flatMap((s) => s.tasks || []);

    // Find the anchor task in the updated list
    const anchorTask = allTasks.find((t) => t.id === anchorTaskId);
    if (!anchorTask) {
      results.push({
        step: 2,
        description: "Forward cascade from next task",
        success: false,
        error: "Could not find anchor task after update",
      });
      if (anchorLocked) {
        try { await unlockTaskTargetDate(jobId, anchorTaskId); } catch { /* best-effort */ }
      }
      return NextResponse.json({
        steps: results,
        summary: { total: 2, success: 1, failed: 1 },
      });
    }

    // Find the task immediately after anchor in workflow order
    const anchorIndex = allTasks.findIndex((t) => t.id === anchorTaskId);
    const nextTask = anchorIndex >= 0 && anchorIndex < allTasks.length - 1
      ? allTasks[anchorIndex + 1]
      : null;

    if (nextTask && anchorTask.target_date) {
      const anchorFinishDate = parseJobmanDate(anchorTask.target_date) ?? anchorTask.target_date.split("T")[0];
      console.log(`[SmartCascade] Step 2: Setting ${nextTask.name} start_date = ${anchorFinishDate} (anchor finish date)`);

      try {
        const after = await updateTaskStartDate(jobId, nextTask.id, anchorFinishDate, "after");
        const returnedStart = parseJobmanDate(after.start_date);
        const returnedTarget = parseJobmanDate(after.target_date);
        console.log(
          `[SmartCascade] Step 2: sent_start=${anchorFinishDate} returned_start=${returnedStart} returned_target=${returnedTarget}`
        );

        results.push({
          step: 2,
          description: `Forward cascade from "${nextTask.name}" (all tasks after)`,
          success: true,
          jobId,
          taskId: nextTask.id,
          taskName: nextTask.name,
          dateSet: anchorFinishDate,
          direction: "after",
          returnedStart,
          returnedTarget,
          drift: driftLabel(anchorFinishDate, returnedStart),
        });
      } catch (error) {
        results.push({
          step: 2,
          description: `Forward cascade from "${nextTask.name}"`,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } else {
      results.push({
        step: 2,
        description: "Forward cascade from next task",
        success: true, // Not an error — just no next task to cascade
        taskName: nextTask?.name || "N/A",
        dateSet: "skipped — no next task or no finish date on anchor",
      });
    }

    // ─── Step 3: Cascade each work order ───
    console.log(`[SmartCascade] Step 3: Finding work orders...`);

    const parentJob = await getJob(jobId);
    const relatedJobs = await getRelatedJobs(parentJob);
    const workOrders = filterWorkOrders(parentJob.number, relatedJobs);

    console.log(`[SmartCascade] Found ${workOrders.length} work orders for ${parentJob.number}`);

    for (const wo of workOrders) {
      try {
        // Fetch work order's tasks
        const woSteps = await getJobSteps(wo.id);
        const woTasks: JobTask[] = woSteps.flatMap((s) => s.tasks || []);

        if (woTasks.length === 0) {
          results.push({
            step: 3,
            description: `Work order ${wo.number} — no tasks found`,
            success: true,
            jobId: wo.id,
            jobNumber: wo.number,
          });
          continue;
        }

        // Find the "Site Off Load" task — this is the real last meaningful task.
        // "Work Order Cancelled" sits after it but is a data-gathering task
        // that shouldn't participate in the cascade.
        const EXCLUDED_TASKS = ["work order cancelled"];
        const siteOffLoadTask = woTasks.find((t) =>
          t.name.toLowerCase().includes("site off load") ||
          t.name.toLowerCase().includes("site offload")
        );
        const lastTask = siteOffLoadTask
          ?? woTasks.filter((t) => !EXCLUDED_TASKS.some((ex) => t.name.toLowerCase().includes(ex))).pop()
          ?? woTasks[woTasks.length - 1];

        console.log(`[SmartCascade] Step 3: WO ${wo.number} — setting "${lastTask.name}" start_date = ${newStartDate}`);

        const after = await updateTaskStartDate(wo.id, lastTask.id, newStartDate, "before");
        const returnedStart = parseJobmanDate(after.start_date);
        const returnedTarget = parseJobmanDate(after.target_date);
        console.log(
          `[SmartCascade] Step 3: WO=${wo.number} sent=${newStartDate} returned_start=${returnedStart} drift=${driftLabel(newStartDate, returnedStart)}`
        );

        results.push({
          step: 3,
          description: `Work order ${wo.number} — reverse cascade from "${lastTask.name}"`,
          success: true,
          jobId: wo.id,
          jobNumber: wo.number,
          taskId: lastTask.id,
          taskName: lastTask.name,
          dateSet: newStartDate,
          direction: "before",
          returnedStart,
          returnedTarget,
          drift: driftLabel(newStartDate, returnedStart),
        });
      } catch (error) {
        results.push({
          step: 3,
          description: `Work order ${wo.number} — cascade failed`,
          success: false,
          jobId: wo.id,
          jobNumber: wo.number,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // ─── Unlock anchor so future cascades can still move it ───
    if (anchorLocked) {
      try {
        await unlockTaskTargetDate(jobId, anchorTaskId);
        console.log(`[SmartCascade] Unlocked anchor ${anchorTaskId} target_date`);
      } catch (unlockError) {
        console.warn(`[SmartCascade] WARN: Could not unlock anchor — ${unlockError instanceof Error ? unlockError.message : unlockError}`);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    // Patch calendar cache: re-fetch tasks for parent + all work orders and update
    // their entries in-place so the calendar reflects new dates immediately.
    try {
      const redis = new Redis({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
      });
      const cached = await redis.get<CalendarJob[]>(REDIS_CACHE_KEY);
      if (cached) {
        const jobIdsToRefresh = [jobId, ...workOrders.map((wo) => wo.id)];
        const updatedCache = cached.map((entry) => entry); // shallow copy
        for (const jid of jobIdsToRefresh) {
          try {
            const steps = await getJobSteps(jid);
            const tasks: CalendarTask[] = steps.flatMap((step) =>
              (step.tasks || []).map((t: JobTask) => ({
                id: t.id,
                name: t.name,
                stepName: step.name,
                startDate: parseJobmanDate(t.start_date),
                targetDate: parseJobmanDate(t.target_date),
                status: t.status,
                progress: t.progress,
                locked: t.target_date_locked,
              }))
            );
            const idx = updatedCache.findIndex((j) => j.id === jid);
            if (idx !== -1) updatedCache[idx] = { ...updatedCache[idx], tasks };
          } catch { /* skip this job if fetch fails */ }
        }
        await redis.set(REDIS_CACHE_KEY, updatedCache, { ex: CACHE_TTL_SECONDS });
      }
    } catch {
      // Best-effort — don't fail the cascade if cache patch fails
    }

    return NextResponse.json({
      steps: results,
      summary: {
        total: results.length,
        success: successCount,
        failed: failCount,
      },
    });
  } catch (error) {
    // Best-effort unlock on unexpected failure so anchor doesn't stay locked
    try { await unlockTaskTargetDate(jobId, anchorTaskId); } catch { /* ignore */ }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Smart cascade failed",
        steps: results,
      },
      { status: 500 }
    );
  }
}
