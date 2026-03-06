# Implementation Plan: 3-Step Cascade + TeamUp-Style Calendar

## Overview

Two features to implement:
1. **3-Step Smart Cascade** — Aaron's exact Loom workflow automated into a single action
2. **Calendar View** — TeamUp-inspired timeline UI for project managers to drag-and-drop install dates

---

## Phase 1: Backend — 3-Step Smart Cascade

### 1.1 Update `lib/jobman.ts`

**Add `recalculateDirection` parameter** to both `updateTaskStartDate()` and `updateTaskTargetDate()`:
- New signature: `updateTaskStartDate(jobId, taskId, newDate, direction = "all")`
- `direction` accepts: `"before"` | `"after"` | `"all"` | `"none"`
- Currently hardcoded to `"all"` — make it configurable

**Add `getWorkOrders()` helper:**
- Takes parent job number (e.g., `"0177"`) and a list of related jobs
- Returns only jobs whose number starts with `parentNumber + "."` (e.g., `"0177.1"`, `"0177.2"`)

### 1.2 Create `app/api/jobman/smart-cascade/route.ts`

New API route implementing Aaron's 3-step workflow from the Loom video.

**Input:**
```json
{
  "jobId": "uuid",
  "anchorTaskId": "uuid (the Primary Install task)",
  "newStartDate": "2026-04-15"
}
```

**Logic (exactly matching Aaron's Loom):**

**Step 1 — Reverse cascade from anchor (Primary Install):**
- `updateTaskStartDate(jobId, anchorTaskId, newStartDate, "before")`
- This tells Jobman: "Set this task's start date and recalculate all tasks BEFORE it"
- Ignore capacity constraints = true

**Step 2 — Forward cascade from next task (Install QA):**
- Re-fetch job tasks via `getJobSteps(jobId)` to get anchor's updated `target_date` (finish date)
- Find the task immediately after the anchor in workflow order
- `updateTaskStartDate(jobId, nextTaskId, anchorTargetDate, "after")`
- This tells Jobman: "Set Install QA's start date = Primary Install's finish date, recalculate everything after"

**Step 3 — Cascade each work order:**
- Fetch related jobs, filter to work orders by number pattern
- For each work order:
  - Fetch its tasks via `getJobSteps(workOrderId)`
  - Find the last task in the workflow (e.g., "Site Offload")
  - `updateTaskStartDate(workOrderId, lastTaskId, newStartDate, "before")`
  - This tells Jobman: "Set Site Offload's date = install date, reverse-calculate everything before it"

**Output:**
```json
{
  "steps": [
    { "step": 1, "description": "Reverse cascade from Primary Install", "success": true, "updatedTask": {...} },
    { "step": 2, "description": "Forward cascade from Install QA", "success": true, "updatedTask": {...} },
    { "step": 3, "description": "Work order 0177.1 cascade", "success": true, "updatedTask": {...} },
    { "step": 3, "description": "Work order 0177.2 cascade", "success": true, "updatedTask": {...} }
  ],
  "summary": { "total": 4, "success": 4, "failed": 0 }
}
```

---

## Phase 2: Frontend — Calendar View (TeamUp-inspired)

### 2.1 New page: `app/calendar/page.tsx`

A dedicated calendar page with TeamUp-style timeline layout.

**Layout:**
- **Header**: Navigation (week/month toggle, prev/next, today button, job search)
- **Timeline grid**:
  - Y-axis = Jobs (each job is a row, work orders nested under parent)
  - X-axis = Dates (columns for each day)
  - Tasks shown as colored horizontal bars spanning start_date → target_date
- **Sidebar**: Job list / filters

**Key features:**
- **Week view** (default): 7 columns, one per day
- **Month view**: ~30 columns
- Color-coded task bars by step/type (Drafting = blue, Manufacturing = orange, Install = green, etc.)
- **Drag-and-drop on install tasks**: Dragging an install task to a new date triggers the smart cascade
- Job rows expandable to show individual tasks
- Work orders nested under their parent job

**Visual design (TeamUp alignment):**
- Clean, minimal layout with clear date headers
- Color-coded event bars with rounded corners
- Subtle grid lines separating days
- Today column highlighted
- Smooth drag animations
- Dark mode support using existing CSS variables

### 2.2 Calendar API route: `app/api/jobman/calendar/route.ts`

Endpoint to fetch jobs and tasks formatted for calendar display:
- Input: `{ startDate, endDate }` (date range for the viewport)
- Fetches all jobs with tasks in that date range
- Groups by parent job with nested work orders
- Returns task bars with position data (start/end dates, colors)

### 2.3 Navigation

- Add calendar link to the header of the existing page
- Add link back to the cascade tool from the calendar

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `lib/jobman.ts` | Edit | Add `direction` param to update functions, add `getWorkOrders()` |
| `app/api/jobman/smart-cascade/route.ts` | Create | New 3-step cascade API route |
| `app/api/jobman/calendar/route.ts` | Create | Calendar data endpoint |
| `app/calendar/page.tsx` | Create | Calendar UI page |
| `app/page.tsx` | Edit | Update cascade workflow to use smart-cascade, add calendar nav link |
| `app/layout.tsx` | Edit | Add navigation if needed |

---

## Testing

- All testing on job **177** or jobs containing "test"
- Verify 3-step cascade produces same results as Aaron's manual Loom workflow
- Verify work order detection by number pattern
- Calendar displays tasks correctly on timeline
- Drag-and-drop triggers cascade and refreshes view
