

**Jobman Date Cascade Tool**

Product Requirements Document

v1.0  ·  Manual Trigger MVP

| Product Name | Jobman Date Cascade Tool |
| :---- | :---- |
| **Version** | 1.0 — Manual Trigger MVP |
| **Status** | Ready for Development |
| **Stack** | Next.js 14+ (App Router), TypeScript, Tailwind CSS |
| **Integration** | Jobman REST API (api-docs.jobmanapp.com) |
| **Auth Method** | Personal Access Token (PAT) |
| **Trigger Mode** | Manual (user-initiated) |
| **Deployment** | Vercel (recommended) |

# **1\. Overview & Problem Statement**

When a parent job's date shifts in Jobman, all related child/sub-jobs currently require manual date updates one by one. This is time-consuming, error-prone, and causes scheduling inconsistencies that frustrate project managers.

This tool solves that problem by providing a simple internal web application where a user can:

* Select a parent job from their Jobman account

* Set a new target date for that parent job

* Preview all related jobs that will be affected

* Review the calculated day offset

* Confirm and cascade the date change to all related jobs in one click

The MVP uses a manual trigger model — no automation runs in the background. Every update is user-initiated and requires explicit confirmation before any changes are made to Jobman.

# **2\. Goals & Non-Goals**

## **2.1 Goals**

* Build a working Next.js web app that connects to the Jobman API

* Allow users to search and select a parent job

* Automatically fetch and display all related/child jobs

* Calculate the day delta between the current and new date

* Apply the same offset to all related job dates with a single confirmation

* Show a clear success/failure result for each updated job

* Keep API credentials secure (server-side only, never in the browser)

## **2.2 Non-Goals (v1.0)**

* No webhook or automatic triggers — everything is manual

* No user authentication system (single-user internal tool)

* No undo functionality (warn users before confirming)

* No support for recurring jobs or complex scheduling rules

* No multi-tenant support

# **3\. User Flow**

The entire application fits in a single-page flow:

1. User opens the app and is presented with a job search input.

2. User types a job name or ID — the app queries the Jobman API and shows matching parent jobs in a dropdown.

3. User selects a parent job. The app fetches and displays: the job's current date, a list of all related/child jobs and their current dates.

4. User picks a new date for the parent job using a date picker.

5. The app instantly calculates and displays the day offset (e.g. "+5 days" or "-3 days") and shows a preview table of every related job with its proposed new date.

6. User reviews the preview. A warning is shown: "This will update X jobs. This cannot be undone."

7. User clicks "Apply Date Cascade". The app sends PATCH requests to Jobman for the parent job and each related job.

8. A results panel shows each job name and whether the update succeeded or failed, with error details for any failures.

# **4\. Technical Architecture**

## **4.1 Project Structure**

jobman-date-cascade/

├── app/

│   ├── page.tsx                  \# Main UI (client component)

│   ├── layout.tsx                \# Root layout

│   └── api/

│       └── jobman/

│           ├── jobs/route.ts     \# GET /api/jobman/jobs?search=

│           ├── jobs/\[id\]/route.ts          \# GET single job \+ related jobs

│           └── cascade/route.ts  \# POST — applies date updates

├── lib/

│   └── jobman.ts                 \# Jobman API client (server-only)

├── types/

│   └── jobman.ts                 \# TypeScript interfaces

├── .env.local                    \# JOBMAN\_API\_TOKEN (never committed)

└── .env.example                  \# Template for env vars

## **4.2 Environment Variables**

| Variable | Example Value | Purpose |
| :---- | :---- | :---- |
| JOBMAN\_API\_TOKEN | pat\_xxxxxxxxxxxx | Jobman Personal Access Token |
| JOBMAN\_BASE\_URL | https://api.jobmanapp.com | Jobman API base URL |

Important: JOBMAN\_API\_TOKEN must only ever be accessed in Next.js Route Handlers (server-side). It must never be referenced in client components or passed to the frontend.

## **4.3 Jobman API Endpoints Used**

| Method | Endpoint | Purpose |
| :---- | :---- | :---- |
| **GET** | /v1/jobs?search={query} | Search jobs by name/ID for the parent selector |
| **GET** | /v1/jobs/{id} | Fetch full details of the selected parent job |
| **GET** | /v1/jobs?parent\_id={id} | Fetch all related/child jobs of the parent |
| **PATCH** | /v1/jobs/{id} | Update a single job's date (called per job) |

Note: Confirm the exact filter parameter name for related jobs in the Jobman API docs (it may be parent\_job\_id, job\_id, or a similar field). Inspect a real job response to identify the relationship field used in your organisation's data.

## **4.4 Internal API Routes**

### **GET /api/jobman/jobs?search={query}**

Proxies a search request to Jobman and returns a simplified list of jobs for the search dropdown. Returns: id, name, current due\_date.

### **GET /api/jobman/jobs/\[id\]**

Fetches the parent job details and all related child jobs. Returns the parent job object and an array of child jobs, each with id, name, and current dates.

### **POST /api/jobman/cascade**

Accepts the parent job ID, related job IDs, and the day offset. Executes PATCH requests against Jobman for each job. Returns a per-job result array with success/failure status.

Request body schema:

{

  "parentJobId": "string",

  "newParentDate": "YYYY-MM-DD",

  "relatedJobIds": \["string"\],

  "offsetDays": number

}

# **5\. UI Components & Pages**

## **5.1 Main Page (app/page.tsx)**

The entire application lives on one page divided into clear visual steps:

### **Step 1 — Job Search**

* A search input with debounce (300ms) that queries /api/jobman/jobs

* A dropdown list of matching jobs showing job name and current date

* On selection, triggers a fetch of related jobs

### **Step 2 — Current Job Details Panel**

* Shows the selected parent job name, ID, and current due date

* Shows a table of all related jobs with their current dates

* If no related jobs found, display an informational message

### **Step 3 — New Date Selector**

* A date picker for the parent job's new date

* Auto-calculates and displays the offset: e.g. "Shifting dates by \+5 days"

* Offset is shown clearly — positive (pushed forward) or negative (moved earlier)

### **Step 4 — Preview Table**

* A table showing: Job Name | Current Date | New Date | Offset

* Includes both the parent job and all related jobs

* Highlighted warning: "You are about to update {n} jobs. This action cannot be undone."

* "Apply Date Cascade" button — disabled until a date is selected and related jobs are loaded

### **Step 5 — Results**

* After submission, each job shows a status: green checkmark (success) or red X (failed)

* Failed jobs show the error message returned from the Jobman API

* A summary: "X of Y jobs updated successfully"

* A "Start Over" button to reset the form

## **5.2 UI Design Guidelines**

* Use Tailwind CSS for all styling

* Use shadcn/ui for components (install separately): Button, Input, Table, Badge, Alert, Tooltip

* Color palette: primary blue for actions, amber for warnings, green/red for results

* The app should be responsive but is primarily designed for desktop use

* Keep the layout clean and linear — one step flows into the next

# **6\. Data Types (TypeScript)**

Define these interfaces in types/jobman.ts:

export interface JobmanJob {

  id: string;

  name: string;

  due\_date: string | null;       // ISO date string YYYY-MM-DD

  start\_date: string | null;

  status: string;

  parent\_job\_id: string | null;

}

export interface CascadeRequest {

  parentJobId: string;

  newParentDate: string;

  relatedJobIds: string\[\];

  offsetDays: number;

}

export interface CascadeResult {

  jobId: string;

  jobName: string;

  success: boolean;

  error?: string;

  newDate?: string;

}

# **7\. Jobman API Client (lib/jobman.ts)**

Create a server-side-only Jobman client with the following functions. This file must only be imported in Route Handlers, never in client components.

// Add 'server-only' import at the top to enforce server-side usage

import 'server-only';

searchJobs(query: string): Promise\<JobmanJob\[\]\>

getJob(id: string): Promise\<JobmanJob\>

getRelatedJobs(parentId: string): Promise\<JobmanJob\[\]\>

updateJobDate(id: string, newDate: string): Promise\<JobmanJob\>

All functions should use the Authorization: Bearer {JOBMAN\_API\_TOKEN} header. Implement basic error handling — throw descriptive errors if the API returns non-2xx responses so the cascade route can capture and report per-job failures.

# **8\. Date Offset Logic**

The core calculation is simple — implement as a utility function:

function calculateOffset(currentDate: string, newDate: string): number {

  const current \= new Date(currentDate);

  const target \= new Date(newDate);

  const diffMs \= target.getTime() \- current.getTime();

  return Math.round(diffMs / (1000 \* 60 \* 60 \* 24));

}

function applyOffset(date: string, offsetDays: number): string {

  const d \= new Date(date);

  d.setDate(d.getDate() \+ offsetDays);

  return d.toISOString().split('T')\[0\]; // Returns YYYY-MM-DD

}

Important edge cases to handle:

* Jobs with null dates should be skipped and flagged in the results

* Weekends/holidays are NOT adjusted in v1.0 — offset is applied as a raw day count

* Dates in the past are allowed — no validation blocking past dates

# **9\. Error Handling Strategy**

## **9.1 API Errors**

* If the Jobman API returns 401: show "Invalid or expired API token" and stop

* If the Jobman API returns 404 for a job: mark that job as failed in results, continue with others

* If the Jobman API returns 429 (rate limit): implement retry with 1 second delay, max 3 attempts

* If the Jobman API returns 5xx: mark job as failed, log the error, continue cascade

## **9.2 Cascade Partial Failures**

The cascade should not stop on first failure. It should attempt to update all jobs and report each result individually. This prevents a single problematic job from blocking the entire cascade operation.

## **9.3 Client-Side Validation**

* Require a job to be selected before showing the date picker

* Require a new date to be selected before enabling the confirm button

* If new date equals current date (offset \= 0), disable the confirm button and show "No change — date is the same"

# **10\. Setup & Deployment Instructions**

## **10.1 Local Development**

9. **Step 1:** Clone the repository and install dependencies:

npx create-next-app@latest jobman-date-cascade \--typescript \--tailwind \--app

cd jobman-date-cascade

npm install server-only

10. **Step 2:** Install shadcn/ui:

npx shadcn-ui@latest init

npx shadcn-ui@latest add button input table badge alert

11. **Step 3:** Create .env.local with your Jobman token:

JOBMAN\_API\_TOKEN=your\_personal\_access\_token\_here

JOBMAN\_BASE\_URL=https://api.jobmanapp.com

12. **Step 4:** Run the development server:

npm run dev

## **10.2 Getting a Jobman Personal Access Token**

13. Log in to your Jobman account

14. Go to Settings → Developer (or API)

15. Create a new Personal Access Token

16. Copy the token immediately — it won't be shown again

17. Paste it into .env.local as JOBMAN\_API\_TOKEN

## **10.3 Deploying to Vercel**

18. Push the project to a GitHub repository

19. Connect the repo to Vercel

20. Add JOBMAN\_API\_TOKEN and JOBMAN\_BASE\_URL as Environment Variables in the Vercel dashboard

21. Deploy — Vercel will auto-detect Next.js and configure everything

# **11\. Development Checklist**

Use this checklist to track build progress:

## **Backend**

* lib/jobman.ts — Jobman API client with all required functions

* GET /api/jobman/jobs — job search endpoint

* GET /api/jobman/jobs/\[id\] — parent job \+ related jobs endpoint

* POST /api/jobman/cascade — cascade update endpoint with per-job results

* Date offset utility functions

* Error handling and retry logic

## **Frontend**

* Step 1: Job search input with debounce and dropdown

* Step 2: Selected job details \+ related jobs table

* Step 3: New date picker with offset display

* Step 4: Preview table \+ confirmation warning

* Step 5: Results display with per-job success/failure

* "Start Over" / reset functionality

* Loading states for all async operations

* Disabled states for buttons when preconditions not met

## **Config & Security**

* .env.local and .env.example created

* .env.local added to .gitignore

* JOBMAN\_API\_TOKEN only accessed in server-side Route Handlers

* server-only import used in lib/jobman.ts

# **12\. Future Enhancements (v2.0+)**

These are out of scope for v1.0 but worth tracking for future iterations:

* Webhook mode — automatically trigger cascade when a parent job is updated in Jobman

* Undo functionality — snapshot job dates before cascade and allow rollback

* Selective cascade — let user deselect specific related jobs from the preview

* Weekend/business day awareness — skip weekends when applying the offset

* Multi-user auth — add NextAuth.js so only team members can access the tool

* Audit log — record every cascade operation with timestamp, user, and jobs affected

* Dry run mode — apply cascade in preview only without actually calling the API

* Bulk parent selection — cascade multiple parent jobs at once

# **13\. Notes for the AI Agent**

If you are an AI agent building this application, here are important notes:

* Confirm the exact Jobman API field names by checking api-docs.jobmanapp.com — the field for related/child jobs may differ from what is documented here.

* The Jobman API requires the Authorization header with Bearer token format.

* Always use the Next.js App Router pattern (not Pages Router). Route Handlers go in app/api/.

* Never use 'use client' in any file that imports from lib/jobman.ts.

* Test with a small number of related jobs first before running a full cascade.

* Wrap all Jobman API calls in try/catch and return structured error objects rather than throwing unhandled errors.

* The UI should make it impossible to trigger a cascade without an explicit user confirmation step.

