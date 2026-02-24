import { NextResponse } from "next/server";

const API_TOKEN = process.env.JOBMAN_API_TOKEN!;
const BASE_URL = (process.env.JOBMAN_BASE_URL || "https://api.jobmanapp.com").replace(/\/$/, "");
const ORG_ID = process.env.JOBMAN_ORGANISATION_ID!;

const jsonHeaders: HeadersInit = {
  Authorization: `Bearer ${API_TOKEN}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

/**
 * GET /api/test-date — Round 3: correct date format Y-m-d + enum-style recalculate values
 */
export async function GET() {
  const results: Record<string, { status: number; body: string }> = {};

  // Step 1: Find a test job
  const searchRes = await fetch(
    `${BASE_URL}/api/v1/organisations/${ORG_ID}/jobs?search=0177.3&limit=1`,
    { headers: jsonHeaders }
  );
  const searchData = await searchRes.json();
  const job = searchData.jobs?.data?.[0] || searchData.data?.[0];
  if (!job) return NextResponse.json({ error: "No job found" }, { status: 404 });

  const tasksRes = await fetch(
    `${BASE_URL}/api/v1/organisations/${ORG_ID}/jobs/${job.id}/tasks`,
    { headers: jsonHeaders }
  );
  const tasksData = await tasksRes.json();
  const tasks = tasksData.tasks?.data || tasksData.data || [];
  if (!tasks.length) return NextResponse.json({ error: "No tasks" }, { status: 404 });
  const task = tasks[0];

  const testDate = "2026-03-25";
  const url = `${BASE_URL}/api/v1/organisations/${ORG_ID}/jobs/${job.id}/tasks/${task.id}/target-date`;

  // Try various enum-style values
  const valuesToTry = [
    "all", "none", "selected", "only_unlocked", "unlocked",
    "recalculate", "no", "true", "false",
    "downstream", "subsequent", "following",
  ];

  for (const val of valuesToTry) {
    const res = await fetch(url, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ target_date: testDate, recalculate_target_dates: val }),
    });
    results[`val_${val}`] = { status: res.status, body: await res.text() };
    // If success, stop testing
    if (res.status === 200) break;
  }

  return NextResponse.json({
    job: { id: job.id, number: job.number },
    task: { id: task.id, name: task.name },
    url,
    dateUsed: testDate,
    results,
  });
}
