import { NextRequest, NextResponse } from "next/server";
import { searchJobs } from "@/lib/jobman";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("search");

  if (!query || query.trim().length < 1) {
    return NextResponse.json({ jobs: [] });
  }

  try {
    const jobs = await searchJobs(query.trim());
    return NextResponse.json({ jobs });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to search jobs";

    if (message.includes("Invalid or expired API token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
