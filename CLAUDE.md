# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Internal web tool for cascading date changes across related Jobman jobs. When a parent job's dates shift, this app lets users apply an offset to all related child/sub-job tasks in bulk via the Jobman API.

## Commands

```bash
npm run dev      # Start dev server (Next.js)
npm run build    # Production build
npm start        # Start production server
npm run lint     # ESLint
```

No test framework is configured.

## Tech Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **React 19** with TypeScript
- **Tailwind CSS 4** for styling
- Dark mode via `prefers-color-scheme` and CSS custom properties in `app/globals.css`

## Architecture

### API Layer (`app/api/jobman/`)

All Jobman API calls go through Next.js API routes (never called from the client directly). The server-only API client lives in `lib/jobman.ts` and handles authentication, rate-limit retries (429 with `Retry-After`), and endpoint fallbacks.

Key routes:
- `jobs/route.ts` — search jobs by query
- `jobs/[id]/route.ts` — fetch job details + related jobs (same `contact_id`)
- `cascade/route.ts` — bulk date offset update across all tasks
- `task-date/route.ts` — individual task date update (inline editing)

### Client UI (`app/page.tsx`)

Single-page client component (`"use client"`) implementing a 5-step workflow:
1. Search for a parent job
2. View job details, related jobs, and all tasks (with inline date editing)
3. Set a date offset (reference date → new date → calculated offset in days)
4. Preview all calculated date changes
5. Apply cascade and view per-task results

### Authentication (`middleware.ts`)

Password-based auth using Next.js middleware. Login page at `app/login/` uses a server action (`actions.ts`) to verify the password and set an HTTP-only cookie (`site_auth_token`, 30-day expiry).

### Shared Modules

- `lib/jobman.ts` — Jobman API client (server-only). Functions: `searchJobs`, `getJob`, `getJobSteps`, `getRelatedJobs`, `updateTaskTargetDate`, `updateTaskStartDate`
- `lib/date-utils.ts` — Server-side date math (offset calculation, formatting)
- `types/jobman.ts` — TypeScript interfaces for `JobmanJob`, `CascadeRequest`, `CascadeResult`, `JobSearchResult`

### Environment Variables

Required in `.env.local` (see `.env.example`):
- `JOBMAN_API_TOKEN` — Personal access token (JWT)
- `JOBMAN_BASE_URL` — Defaults to `https://api.jobmanapp.com`
- `JOBMAN_ORGANISATION_ID` — Organisation UUID

### Key Patterns

- `lib/jobman.ts` uses `import "server-only"` to prevent accidental client-side imports
- API client uses `fetchWithRetry()` for rate-limit handling (max 3 attempts, 1s delay)
- Related jobs are discovered by matching `contact_id` on the parent job
- Date updates send `recalculate_target_dates: "all"` and `ignore_capacity_constraints: true` to the Jobman API
