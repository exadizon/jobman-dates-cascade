import { NextRequest, NextResponse } from "next/server";
import { searchJobs, getJob, getJobSteps, getRelatedJobs, getJobDisplayName, filterWorkOrders } from "@/lib/jobman";
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

/**
 * GET /api/jobman/calendar?search=...
 *
 * Fetches jobs and their tasks for calendar display.
 * Returns parent jobs with nested work orders, each containing their tasks.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");

  if (!search || search.trim().length < 2) {
    return NextResponse.json({ error: "search parameter required (min 2 chars)" }, { status: 400 });
  }

  try {
    // Search for jobs
    const searchResults = await searchJobs(search);

    if (searchResults.length === 0) {
      return NextResponse.json({ jobs: [] });
    }

    const calendarJobs: CalendarJob[] = [];
    const processedJobIds = new Set<string>();

    // Process each search result as a potential parent job
    for (const result of searchResults.slice(0, 10)) {
      if (processedJobIds.has(result.id)) continue;
      processedJobIds.add(result.id);

      const job = await getJob(result.id);

      // Fetch tasks for this job
      let tasks: CalendarTask[] = [];
      try {
        const steps = await getJobSteps(job.id);
        tasks = steps.flatMap((step) =>
          (step.tasks || []).map((task: JobTask) => ({
            id: task.id,
            name: task.name,
            stepName: step.name,
            startDate: task.start_date ? task.start_date.split("T")[0] : null,
            targetDate: task.target_date ? task.target_date.split("T")[0] : null,
            status: task.status,
            progress: task.progress,
            locked: task.target_date_locked,
          }))
        );
      } catch {
        // Continue with empty tasks
      }

      calendarJobs.push({
        id: job.id,
        number: job.number,
        name: getJobDisplayName(job),
        isWorkOrder: false,
        tasks,
      });

      // Get work orders for this job
      try {
        const relatedJobs = await getRelatedJobs(job);
        const workOrders = filterWorkOrders(job.number, relatedJobs);

        for (const wo of workOrders) {
          if (processedJobIds.has(wo.id)) continue;
          processedJobIds.add(wo.id);

          let woTasks: CalendarTask[] = [];
          try {
            const woSteps = await getJobSteps(wo.id);
            woTasks = woSteps.flatMap((step) =>
              (step.tasks || []).map((task: JobTask) => ({
                id: task.id,
                name: task.name,
                stepName: step.name,
                startDate: task.start_date ? task.start_date.split("T")[0] : null,
                targetDate: task.target_date ? task.target_date.split("T")[0] : null,
                status: task.status,
                progress: task.progress,
                locked: task.target_date_locked,
              }))
            );
          } catch {
            // Continue with empty tasks
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
      } catch {
        // Continue without work orders
      }
    }

    return NextResponse.json({ jobs: calendarJobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch calendar data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
