import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/oauth-tokens";

const BASE_URL = (process.env.JOBMAN_BASE_URL || "https://api.jobmanapp.com").replace(/\/$/, "");
const ORG_ID = process.env.JOBMAN_ORGANISATION_ID!;

export async function GET() {
  const token = await getAccessToken();
  // Fetch a sample of jobs to discover what job_status_id values exist
  const res = await fetch(`${BASE_URL}/api/v1/organisations/${ORG_ID}/jobs?limit=50&sort_by=created_at&sort_direction=asc`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const data = await res.json();
  const jobs = data.jobs?.data || data.data || [];
  // Return unique status IDs and their job numbers so we can identify which is "active"
  const statuses = jobs.map((j: { number: string; job_status_id: string }) => ({
    number: j.number,
    job_status_id: j.job_status_id,
  }));
  return NextResponse.json(statuses);
}
