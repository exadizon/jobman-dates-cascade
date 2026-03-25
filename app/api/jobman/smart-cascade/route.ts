import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  getJobSteps,
  getRelatedJobs,
  updateTaskStartDate,
  updateTaskTargetDate,
  filterWorkOrders,
} from "@/lib/jobman";
import type { JobTask } from "@/lib/jobman";

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
      await updateTaskStartDate(jobId, anchorTaskId, newStartDate, "none");
      step1Result = {
        step: 1,
        description: "Pin anchor task start date (no cascade)",
        success: true,
        jobId,
        taskId: anchorTaskId,
        dateSet: newStartDate,
        direction: "none",
      };
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
        await updateTaskTargetDate(jobId, taskBefore.id, dayBefore, "before");
        results.push({
          step: 1,
          description: `Reverse cascade from "${taskBefore.name}" (all tasks before)`,
          success: true,
          jobId,
          taskId: taskBefore.id,
          taskName: taskBefore.name,
          dateSet: dayBefore,
          direction: "before",
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
      const anchorFinishDate = anchorTask.target_date.split("T")[0];
      console.log(`[SmartCascade] Step 2: Setting ${nextTask.name} start_date = ${anchorFinishDate} (anchor finish date)`);

      try {
        await updateTaskStartDate(jobId, nextTask.id, anchorFinishDate, "after");
        results.push({
          step: 2,
          description: `Forward cascade from "${nextTask.name}" (all tasks after)`,
          success: true,
          jobId,
          taskId: nextTask.id,
          taskName: nextTask.name,
          dateSet: anchorFinishDate,
          direction: "after",
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

        // Find the LAST task in the work order (e.g., "Site Offload")
        const lastTask = woTasks[woTasks.length - 1];

        console.log(`[SmartCascade] Step 3: WO ${wo.number} — setting "${lastTask.name}" start_date = ${newStartDate}`);

        await updateTaskStartDate(wo.id, lastTask.id, newStartDate, "before");

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

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      steps: results,
      summary: {
        total: results.length,
        success: successCount,
        failed: failCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Smart cascade failed",
        steps: results,
      },
      { status: 500 }
    );
  }
}
