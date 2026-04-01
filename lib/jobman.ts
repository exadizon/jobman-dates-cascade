import "server-only";

import type { JobmanJob } from "@/types/jobman";
import { getAccessToken } from "./oauth-tokens";
import { parseJobmanDate } from "./date-utils";

const BASE_URL = (
  process.env.JOBMAN_BASE_URL || "https://api.jobmanapp.com"
).replace(/\/$/, "");
const ORG_ID = process.env.JOBMAN_ORGANISATION_ID!;

async function getHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function orgUrl(path: string): string {
  return `${BASE_URL}/api/v1/organisations/${ORG_ID}${path}`;
}

/**
 * Make a fetch request with retry logic for 429 (rate limit).
 * Max 5 attempts with exponential back-off (1s, 2s, 4s…) between retries.
 * Respects the Retry-After header when present.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5
): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429 && attempt < maxRetries - 1) {
      const retryAfter = response.headers.get("Retry-After");
      // Exponential back-off: 1s, 2s, 4s, 8s…  capped at 10s
      const baseDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
      const delayMs = Math.min(baseDelay * Math.pow(2, attempt), 10_000);
      console.log(`[Jobman] 429 rate-limited, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      lastResponse = response;
      continue;
    }

    return response;
  }

  return lastResponse!;
}

/**
 * Extract the "display name" from a job object.
 */
function getJobDisplayName(job: JobmanJob): string {
  const parts: string[] = [];
  if (job.number) parts.push(job.number);
  if (job.description) parts.push(job.description);
  if (job.name) parts.push(job.name);
  return parts.join(" — ") || `Job ${job.id.slice(0, 8)}`;
}

// ─── Job Task Types ──────────────────────────────────────────

export interface JobTask {
  id: string;
  name: string;
  step_id: string;
  description: string | null;
  organisation_id: string;
  item_id: string;
  status: string;
  progress: number;
  start_date: string | null;
  target_date: string | null;
  target_date_locked: boolean;
  target_date_calculation: number;
  estimated_day: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobStep {
  id: string;
  name: string;
  organisation_id: string;
  tasks: JobTask[];
  created_at: string;
  updated_at: string;
}

export type RecalculateDirection = "all" | "after" | "before" | "none";

/** Normalize Jobman UTC ISO dates on a task to bare YYYY-MM-DD strings. */
function normalizeTaskDates(task: JobTask): JobTask {
  return {
    ...task,
    start_date: parseJobmanDate(task.start_date),
    target_date: parseJobmanDate(task.target_date),
  };
}

/**
 * Given a parent job number (e.g., "0177"), return only work orders
 * from the related jobs list — i.e. jobs whose number starts with
 * the parent number followed by a dot (e.g., "0177.1", "0177.2").
 */
export function filterWorkOrders(
  parentJobNumber: string,
  relatedJobs: JobmanJob[]
): JobmanJob[] {
  const prefix = parentJobNumber + ".";
  return relatedJobs.filter((job) => job.number.startsWith(prefix));
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Search jobs by name/number.
 */
export async function searchJobs(query: string): Promise<
  {
    id: string;
    number: string;
    name: string;
    description: string | null;
  }[]
> {
  const url = orgUrl(`/jobs?search=${encodeURIComponent(query)}&limit=20`);
  const response = await fetchWithRetry(url, { headers: await getHeaders() });

  if (response.status === 401) {
    throw new Error("Invalid or expired API token");
  }
  if (!response.ok) {
    throw new Error(`Jobman API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const jobs: JobmanJob[] = data.jobs?.data || data.data || [];

  return jobs.map((job) => ({
    id: job.id,
    number: job.number,
    name: getJobDisplayName(job),
    description: job.description,
  }));
}

/**
 * Fetch recent jobs without a search term — returns the most recently
 * updated jobs for this organisation, up to `limit`.
 * Tries multiple sort/param variants for compatibility across Jobman instances.
 */
export async function getRecentJobs(limit = 20): Promise<
  {
    id: string;
    number: string;
    name: string;
    description: string | null;
  }[]
> {
  // Try with a sort-by-updated param first, fall back to plain limit
  const candidates = [
    orgUrl(`/jobs?limit=${limit}&sort_by=updated_at&sort_direction=desc`),
    orgUrl(`/jobs?limit=${limit}`),
  ];

  let lastError: Error | null = null;

  for (const url of candidates) {
    const response = await fetchWithRetry(url, { headers: await getHeaders() });

    if (response.status === 401) {
      throw new Error("Invalid or expired API token");
    }

    if (!response.ok) {
      lastError = new Error(`Jobman API error: ${response.status} ${response.statusText}`);
      continue; // try next variant
    }

    const data = await response.json();
    const jobs: JobmanJob[] = data.jobs?.data || data.data || [];

    if (jobs.length > 0 || !lastError) {
      return jobs.map((job) => ({
        id: job.id,
        number: job.number,
        name: getJobDisplayName(job),
        description: job.description,
      }));
    }
  }

  throw lastError ?? new Error("No jobs returned from Jobman API");
}

/**
 * Fetch ALL jobs by paginating through the Jobman API.
 * Stops when a page returns fewer results than the page size.
 */
export async function getAllJobs(
  onProgress?: (fetched: number) => void
): Promise<{ id: string; number: string; name: string; description: string | null }[]> {
  const PAGE_SIZE = 50;
  const all: { id: string; number: string; name: string; description: string | null }[] = [];
  let page = 1;

  while (true) {
    const url = orgUrl(`/jobs?limit=${PAGE_SIZE}&page=${page}`);
    const response = await fetchWithRetry(url, { headers: await getHeaders() });

    if (response.status === 401) throw new Error("Invalid or expired API token");
    if (!response.ok) throw new Error(`Jobman API error: ${response.status} ${response.statusText}`);

    const data = await response.json();
    const jobs: JobmanJob[] = data.jobs?.data || data.data || [];

    all.push(...jobs.map((job) => ({
      id: job.id,
      number: job.number,
      name: getJobDisplayName(job),
      description: job.description,
    })));

    onProgress?.(all.length);

    if (jobs.length < PAGE_SIZE) break; // last page
    page++;

    // Small delay between pages to stay under rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
}

/**
 * Get a single job by ID.
 */
export async function getJob(id: string): Promise<JobmanJob> {
  const url = orgUrl(`/jobs/${id}`);
  const response = await fetchWithRetry(url, { headers: await getHeaders() });

  if (response.status === 401) {
    throw new Error("Invalid or expired API token");
  }
  if (response.status === 404) {
    throw new Error(`Job ${id} not found`);
  }
  if (!response.ok) {
    throw new Error(`Jobman API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.job || data;
}

/**
 * Get all steps + tasks for a job.
 * Uses: GET /api/v1/organisations/{orgId}/jobs/{jobId}/steps
 * Each step contains nested tasks with start_date and target_date.
 */
export async function getJobSteps(jobId: string): Promise<JobStep[]> {
  const url = orgUrl(`/jobs/${jobId}/steps`);
  const response = await fetchWithRetry(url, { headers: await getHeaders() });

  if (!response.ok) {
    // Try the /tasks endpoint as fallback
    const tasksUrl = orgUrl(`/jobs/${jobId}/tasks`);
    const tasksResponse = await fetchWithRetry(tasksUrl, { headers: await getHeaders() });
    if (!tasksResponse.ok) {
      throw new Error(`Failed to fetch job tasks: ${response.status}`);
    }
    const tasksData = await tasksResponse.json();
    const tasks: JobTask[] = (tasksData.tasks?.data || tasksData.data || []).map(normalizeTaskDates);
    // Wrap in a single virtual step
    return [{
      id: "all-tasks",
      name: "All Tasks",
      organisation_id: ORG_ID,
      tasks,
      created_at: "",
      updated_at: "",
    }];
  }

  const data = await response.json();
  const steps: JobStep[] = data.steps || data.data || [];
  return steps.map((step) => ({
    ...step,
    tasks: (step.tasks || []).map(normalizeTaskDates),
  }));
}

/**
 * Get related/child jobs.
 * Finds all jobs with the same contact_id (same client).
 */
export async function getRelatedJobs(
  parentJob: JobmanJob
): Promise<JobmanJob[]> {
  if (!parentJob.contact_id) {
    return [];
  }

  const filter = JSON.stringify([
    { property: "contact_id", value: parentJob.contact_id },
  ]);
  const url = orgUrl(`/jobs?filter=${encodeURIComponent(filter)}&limit=100`);
  const response = await fetchWithRetry(url, { headers: await getHeaders() });

  if (!response.ok) {
    throw new Error(`Failed to fetch related jobs: ${response.status}`);
  }

  const data = await response.json();
  const jobs: JobmanJob[] = data.jobs?.data || data.data || [];
  return jobs.filter((job) => job.id !== parentJob.id);
}

/**
 * Update a job task's target date.
 * Uses: PUT /api/v1/organisations/{orgId}/jobs/{jobId}/tasks/{taskId}/target-date
 *
 * Jobman requires: date in Y-m-d format, recalculate_target_dates = "all"
 */
export async function updateTaskTargetDate(
  jobId: string,
  taskId: string,
  newDate: string,
  direction: RecalculateDirection = "all"
): Promise<JobTask> {
  const url = orgUrl(`/jobs/${jobId}/tasks/${taskId}/target-date`);
  // Strip any time portion — Jobman wants Y-m-d only
  const dateOnly = newDate.split("T")[0];

  const payload = {
    target_date: dateOnly,
    recalculate_target_dates: direction,
    ignore_capacity_constraints: true,
  };

  console.log(`[Jobman] PUT target-date ${taskId} → ${dateOnly}`);
  const response = await fetchWithRetry(url, {
    method: "PUT",
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to update task target date: ${response.status} — ${errorBody}`);
  }

  const data = await response.json();
  return normalizeTaskDates(data.task || data);
}

/**
 * Update a job task's start date.
 * Uses: PUT /api/v1/organisations/{orgId}/jobs/{jobId}/tasks/{taskId}/start-date
 *
 * Jobman requires: date in Y-m-d format, recalculate_target_dates = "all"
 */
export async function updateTaskStartDate(
  jobId: string,
  taskId: string,
  newDate: string,
  direction: RecalculateDirection = "all"
): Promise<JobTask> {
  const url = orgUrl(`/jobs/${jobId}/tasks/${taskId}/start-date`);
  // Strip any time portion — Jobman wants Y-m-d only
  const dateOnly = newDate.split("T")[0];

  const payload = {
    start_date: dateOnly,
    recalculate_target_dates: direction,
    ignore_capacity_constraints: true,
  };

  console.log(`[Jobman] PUT start-date ${taskId} → ${dateOnly}`);
  const response = await fetchWithRetry(url, {
    method: "PUT",
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to update task start date: ${response.status} — ${errorBody}`);
  }

  const data = await response.json();
  return normalizeTaskDates(data.task || data);
}

export { getJobDisplayName };
