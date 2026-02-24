export interface JobmanJob {
  id: string;
  number: string;
  name?: string;
  description: string | null;
  organisation_id: string;
  types: { id: string; name: string }[];
  job_status_id: string;
  contact_id: string | null;
  workflow_id: string | null;
  // Date fields — may vary by organisation config
  due_date?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  // Address fields
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  address_country_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}

export interface CascadeRequest {
  parentJobId: string;
  newParentDate: string; // YYYY-MM-DD
  relatedJobs: {
    id: string;
    currentDate: string;
  }[];
  offsetDays: number;
}

export interface CascadeResult {
  jobId: string;
  jobName: string;
  success: boolean;
  error?: string;
  previousDate?: string;
  newDate?: string;
}

/** Simplified job for search results and display */
export interface JobSearchResult {
  id: string;
  number: string;
  name: string;
  due_date: string | null;
  start_date: string | null;
  status: string;
}
