import { NextRequest, NextResponse } from "next/server";
import { updateTaskTargetDate, updateTaskStartDate } from "@/lib/jobman";

/**
 * POST /api/jobman/task-date
 * Set an individual task's target_date and/or start_date.
 */
export async function POST(request: NextRequest) {
  let body: {
    jobId: string;
    taskId: string;
    targetDate?: string;
    startDate?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { jobId, taskId, targetDate, startDate } = body;

  if (!jobId || !taskId) {
    return NextResponse.json(
      { error: "jobId and taskId are required" },
      { status: 400 }
    );
  }

  if (!targetDate && !startDate) {
    return NextResponse.json(
      { error: "At least one of targetDate or startDate is required" },
      { status: 400 }
    );
  }

  try {
    if (targetDate) {
      await updateTaskTargetDate(jobId, taskId, targetDate);
    }
    if (startDate) {
      await updateTaskStartDate(jobId, taskId, startDate);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update task date";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
