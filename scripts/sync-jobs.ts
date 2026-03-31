/**
 * Run locally to populate Redis with all calendar jobs.
 * Usage: npx tsx scripts/sync-jobs.ts
 *
 * This bypasses Vercel's 10s timeout by running the sync on your machine.
 * Redis is shared with production so the calendar will read from it instantly.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Redis } from "@upstash/redis";

const REDIS_CACHE_KEY = "jobman:calendar:all";
const CACHE_TTL_SECONDS = 60 * 60 * 25; // 25 hours

async function main() {
  const baseUrl = process.env.JOBMAN_BASE_URL || "https://api.jobmanapp.com";
  const orgId = process.env.JOBMAN_ORGANISATION_ID!;
  const clientId = process.env.JOBMAN_CLIENT_ID!;
  const clientSecret = process.env.JOBMAN_CLIENT_SECRET!;
  const kvUrl = process.env.KV_REST_API_URL!;
  const kvToken = process.env.KV_REST_API_TOKEN!;

  if (!orgId || !clientId || !clientSecret || !kvUrl || !kvToken) {
    console.error("Missing required env vars. Make sure .env.local is set up.");
    process.exit(1);
  }

  const redis = new Redis({ url: kvUrl, token: kvToken });

  // Get access token from Redis (set by OAuth flow)
  const tokens = await redis.get<{ access_token: string; refresh_token: string; expires_at: number }>("jobman:tokens");
  let accessToken = tokens?.access_token;

  // Refresh if expired
  if (!accessToken || (tokens?.expires_at && Date.now() > tokens.expires_at)) {
    console.log("Access token expired, refreshing…");
    const res = await fetch("https://identity.jobmanapp.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: tokens?.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const data = await res.json();
    accessToken = data.access_token;
    await redis.set("jobman:tokens", {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000 - 60_000,
    });
    console.log("Token refreshed.");
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  function orgUrl(path: string) {
    return `${baseUrl}/api/v1/organisations/${orgId}${path}`;
  }

  async function fetchWithRetry(url: string, opts: RequestInit = {}, retries = 5): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      const res = await fetch(url, opts);
      if (res.status === 429 && i < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        console.log(`  429 rate limited, retrying in ${delay}ms…`);
        await sleep(delay);
        continue;
      }
      return res;
    }
    throw new Error("Max retries exceeded");
  }

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // 1. Paginate through all jobs
  console.log("Fetching all job refs…");
  const allRefs: { id: string; number: string; name: string }[] = [];
  let page = 1;
  while (true) {
    const res = await fetchWithRetry(orgUrl(`/jobs?limit=50&page=${page}`), { headers });
    const data = await res.json();
    const jobs = data.jobs?.data || data.data || [];
    allRefs.push(...jobs.map((j: { id: string; number: string; description: string; name: string }) => ({
      id: j.id,
      number: j.number,
      name: [j.number, j.description, j.name].filter(Boolean).join(" — "),
    })));
    console.log(`  Page ${page}: ${jobs.length} jobs (total: ${allRefs.length})`);
    if (jobs.length < 50) break;
    page++;
    await sleep(300);
  }
  console.log(`Total refs: ${allRefs.length}`);

  // 2. Process each job
  const calendarJobs: object[] = [];
  const processedIds = new Set<string>();
  const parents = allRefs.filter((r) => !r.number.includes("."));
  const wos = allRefs.filter((r) => r.number.includes("."));
  const ordered = [...parents, ...wos];

  for (let i = 0; i < ordered.length; i++) {
    const ref = ordered[i];
    if (processedIds.has(ref.id)) continue;
    processedIds.add(ref.id);

    const isWO = ref.number.includes(".");
    const parentNumber = isWO ? ref.number.split(".")[0] : undefined;

    // Fetch job details
    const jobRes = await fetchWithRetry(orgUrl(`/jobs/${ref.id}`), { headers });
    if (!jobRes.ok) { console.log(`  ${ref.number} → fetch failed`); continue; }
    const jobData = await jobRes.json();
    const job = jobData.job || jobData;

    // Fetch steps/tasks
    const stepsRes = await fetchWithRetry(orgUrl(`/jobs/${ref.id}/steps`), { headers });
    let tasks: object[] = [];
    if (stepsRes.ok) {
      const stepsData = await stepsRes.json();
      const steps = stepsData.steps || stepsData.data || [];
      tasks = steps.flatMap((step: { name: string; tasks: { id: string; name: string; start_date: string; target_date: string; status: string; progress: number; target_date_locked: boolean }[] }) =>
        (step.tasks || []).map((t: { id: string; name: string; start_date: string; target_date: string; status: string; progress: number; target_date_locked: boolean }) => ({
          id: t.id,
          name: t.name,
          stepName: step.name,
          startDate: t.start_date ? t.start_date.split("T")[0] : null,
          targetDate: t.target_date ? t.target_date.split("T")[0] : null,
          status: t.status,
          progress: t.progress,
          locked: t.target_date_locked,
        }))
      );
    }

    const hasDates = (tasks as { startDate: string | null; targetDate: string | null }[]).some((t) => t.startDate || t.targetDate);
    if (!hasDates && !isWO) {
      await sleep(200);
      continue;
    }

    const jobTypes = (job.types || []).map((t: { name: string }) => t.name);
    calendarJobs.push({ id: job.id, number: job.number, name: ref.name, description: job.description || job.name || null, isWorkOrder: isWO, parentNumber, jobTypes, tasks });

    // Fetch work orders for parent jobs
    if (!isWO && job.contact_id) {
      const filter = JSON.stringify([{ property: "contact_id", value: job.contact_id }]);
      const relRes = await fetchWithRetry(orgUrl(`/jobs?filter=${encodeURIComponent(filter)}&limit=100`), { headers });
      if (relRes.ok) {
        const relData = await relRes.json();
        const related: { id: string; number: string; description: string; name: string }[] = (relData.jobs?.data || relData.data || []).filter((j: { id: string }) => j.id !== job.id);
        const jobWOs = related
          .filter((j) => j.number.startsWith(job.number + "."))
          .slice(0, 50);

        for (const wo of jobWOs) {
          if (processedIds.has(wo.id)) continue;
          processedIds.add(wo.id);
          await sleep(200);
          const woStepsRes = await fetchWithRetry(orgUrl(`/jobs/${wo.id}/steps`), { headers });
          let woTasks: object[] = [];
          if (woStepsRes.ok) {
            const woStepsData = await woStepsRes.json();
            const woSteps = woStepsData.steps || woStepsData.data || [];
            woTasks = woSteps.flatMap((step: { name: string; tasks: { id: string; name: string; start_date: string; target_date: string; status: string; progress: number; target_date_locked: boolean }[] }) =>
              (step.tasks || []).map((t: { id: string; name: string; start_date: string; target_date: string; status: string; progress: number; target_date_locked: boolean }) => ({
                id: t.id, name: t.name, stepName: step.name,
                startDate: t.start_date ? t.start_date.split("T")[0] : null,
                targetDate: t.target_date ? t.target_date.split("T")[0] : null,
                status: t.status, progress: t.progress, locked: t.target_date_locked,
              }))
            );
          }
          const woName = [wo.number, wo.description, wo.name].filter(Boolean).join(" — ");
          calendarJobs.push({ id: wo.id, number: wo.number, name: woName, description: wo.description || wo.name || null, isWorkOrder: true, parentNumber: job.number, jobTypes, tasks: woTasks });
        }
      }
    }

    if (i % 10 === 0) console.log(`  Progress: ${i + 1}/${ordered.length} jobs processed, ${calendarJobs.length} calendar jobs so far`);
    await sleep(250);
  }

  console.log(`\nSync complete — ${calendarJobs.length} calendar jobs`);
  console.log("Storing in Redis…");
  await redis.set(REDIS_CACHE_KEY, calendarJobs, { ex: CACHE_TTL_SECONDS });
  console.log(`Done! Stored ${calendarJobs.length} jobs in Redis (TTL: ${CACHE_TTL_SECONDS}s)`);
  console.log("The calendar will now load instantly from Redis.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
