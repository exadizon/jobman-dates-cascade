import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  getRelatedJobs,
  getJobSteps,
  getJobDisplayName,
} from "@/lib/jobman";
import type { JobStep } from "@/lib/jobman";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const parentJob = await getJob(id);

    // Fetch steps + tasks for the parent job (these have the dates)
    let parentSteps: JobStep[] = [];
    try {
      parentSteps = await getJobSteps(id);
    } catch {
      // If steps fetch fails, continue with empty steps
    }

    // Flatten all tasks from all steps
    const parentTasks = parentSteps.flatMap((step) =>
      (step.tasks || []).map((task) => ({
        ...task,
        stepName: step.name,
      }))
    );

    // Get related jobs
    const relatedJobs = await getRelatedJobs(parentJob);

    // Fetch tasks for each related job too
    const relatedJobsWithTasks = await Promise.all(
      relatedJobs.map(async (job) => {
        let steps: JobStep[] = [];
        try {
          steps = await getJobSteps(job.id);
        } catch {
          // Continue with empty steps
        }
        const tasks = steps.flatMap((step) =>
          (step.tasks || []).map((task) => ({
            ...task,
            stepName: step.name,
          }))
        );
        return {
          id: job.id,
          number: job.number,
          name: getJobDisplayName(job),
          contact_id: job.contact_id,
          tasks,
        };
      })
    );

    return NextResponse.json({
      parent: {
        id: parentJob.id,
        number: parentJob.number,
        name: getJobDisplayName(parentJob),
        contact_id: parentJob.contact_id,
        tasks: parentTasks,
      },
      relatedJobs: relatedJobsWithTasks,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch job details";

    if (message.includes("Invalid or expired API token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
