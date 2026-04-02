import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { updateTaskTargetDate, updateTaskStartDate, getJobSteps } from "@/lib/jobman";
import type { JobTask, RecalculateDirection } from "@/lib/jobman";
import { parseJobmanDate } from "@/lib/date-utils";
import type { CalendarJob, CalendarTask } from "@/app/api/jobman/calendar/route";

const REDIS_CACHE_KEY = "jobman:calendar:all";
const CACHE_TTL_SECONDS = 60 * 60 * 25; // keep alive until next cron

/**
 * POST /api/jobman/task-date
 * Set an individual task's target_date and/or start_date.
 * Optional `direction` controls recalculation: "none" (default) moves only this task,
 * "all" cascades in both directions, "before"/"after" cascade in one direction.
 */
export async function POST(request: NextRequest) {
  let body: {
    jobId: string;
    taskId: string;
    targetDate?: string;
    startDate?: string;
    direction?: RecalculateDirection;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { jobId, taskId, targetDate, startDate, direction = "none" } = body;

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
      await updateTaskTargetDate(jobId, taskId, targetDate, direction);
    }
    if (startDate) {
      await updateTaskStartDate(jobId, taskId, startDate, direction);
    }

    // Patch calendar cache: re-fetch this job's tasks and update its entry in-place
    // so the calendar reflects new dates without going blank or needing a full sync.
    try {
      const redis = new Redis({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
      });
      const cached = await redis.get<CalendarJob[]>(REDIS_CACHE_KEY);
      if (cached) {
        const steps = await getJobSteps(jobId);
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
        const updated = cached.map((j) => (j.id === jobId ? { ...j, tasks } : j));
        await redis.set(REDIS_CACHE_KEY, updated, { ex: CACHE_TTL_SECONDS });
      }
    } catch {
      // Best-effort — don't fail the date update if cache patch fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update task date";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
