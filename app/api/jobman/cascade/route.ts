import { NextRequest, NextResponse } from "next/server";
import { updateTaskTargetDate, updateTaskStartDate } from "@/lib/jobman";
import { applyOffset } from "@/lib/date-utils";

interface TaskUpdate {
  jobId: string;
  jobName: string;
  taskId: string;
  taskName: string;
  currentTargetDate: string | null;
  currentStartDate: string | null;
}

interface CascadeRequestBody {
  offsetDays: number;
  tasks: TaskUpdate[];
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

export async function POST(request: NextRequest) {
  let body: CascadeRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { offsetDays, tasks } = body;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json(
      { error: "No tasks provided for cascade" },
      { status: 400 }
    );
  }

  if (offsetDays === 0) {
    return NextResponse.json(
      { error: "Offset is 0 — no changes to make" },
      { status: 400 }
    );
  }

  const results: TaskResult[] = [];

  for (const task of tasks) {
    const result: TaskResult = {
      jobId: task.jobId,
      jobName: task.jobName,
      taskId: task.taskId,
      taskName: task.taskName,
      success: false,
      previousTargetDate: task.currentTargetDate,
      previousStartDate: task.currentStartDate,
    };

    try {
      // Update target_date if it exists
      if (task.currentTargetDate) {
        const newTargetDate = applyOffset(task.currentTargetDate, offsetDays);
        if (newTargetDate) {
          await updateTaskTargetDate(task.jobId, task.taskId, newTargetDate);
          result.newTargetDate = newTargetDate;
        }
      }

      // Update start_date if it exists
      if (task.currentStartDate) {
        const newStartDate = applyOffset(task.currentStartDate, offsetDays);
        if (newStartDate) {
          await updateTaskStartDate(task.jobId, task.taskId, newStartDate);
          result.newStartDate = newStartDate;
        }
      }

      // If neither date existed, skip
      if (!task.currentTargetDate && !task.currentStartDate) {
        result.success = false;
        result.error = "No dates set on this task — skipped";
        results.push(result);
        continue;
      }

      result.success = true;
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : "Unknown error";
    }

    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      success: successCount,
      failed: failCount,
    },
  });
}
