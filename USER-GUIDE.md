# Jobman Date Cascade Tool — User Guide

A quick-reference guide for project managers and admins to reschedule jobs using the Date Cascade Tool.

---

## What This Tool Does

When an install date changes, you normally have to manually update dates in three separate places inside Jobman. This tool does all three steps in one click:

1. **Reverse cascade** — Sets the install task's start date and recalculates all tasks before it (Drafting, Manufacturing, Assembly, Freight, etc.) working backwards so everything is scheduled to finish in time.

2. **Forward cascade** — Takes the install task's finish date and sets it as the start of the next task (e.g. Install QA), then recalculates all tasks after it (QA, Final Inspection, Handover, etc.) working forwards.

3. **Work order cascade** — Finds all work orders attached to the parent job (e.g. 0177.1, 0177.2) and for each one, sets the last task's date to the install date and recalculates backwards.

All updates go directly into Jobman. Capacity constraints are ignored so dates don't get pushed out by labour availability.

---

## Getting Started

### Logging In

1. Go to the app URL (e.g. `https://jobman-dates-cascade.vercel.app/`)
2. Enter the password: **InspireKitchens**
3. You'll be taken to the main Cascade Tool page

### Two Views Available

| View | URL | Best For |
|------|-----|----------|
| **Cascade Tool** | `/` (home page) | Running a cascade with full control — pick exactly which task is the anchor |
| **Calendar View** | `/calendar` | Visual overview of scheduled tasks — drag and drop to reschedule |

Use the links in the top-right corner of each page to switch between views.

---

## Cascade Tool (Step-by-Step)

This is the main view for running a date cascade.

### Step 1 — Search for a Job

- Type a job number (e.g. `177`) or job name into the search box
- Select the job from the dropdown results
- The app loads the parent job and all related jobs/work orders with their tasks

### Step 2 — Select the Anchor Task

- You'll see a table of all tasks for the parent job, with radio buttons on the left
- **Click the radio button next to the task you want to anchor on** — this is typically the "Primary Install" or main installation task
- The selected task will be highlighted in blue with an "Anchor" badge

> **What is the anchor task?** It's the task whose start date you want to set. Everything else gets calculated relative to this task — tasks before it are reverse-calculated, tasks after the next one are forward-calculated.

### Step 3 — Set the Install Date & Run

- A new section appears: **"Set Install Date & Cascade"**
- Pick the new start date using the date picker
- Review the three steps the cascade will perform (listed on screen)
- Click **"Run Smart Cascade"**

### Step 4 — Review Results

- You'll see a step-by-step breakdown of what happened:
  - **Step 1** (green circle): Reverse cascade from your anchor task
  - **Step 2** (green circle): Forward cascade from the next task
  - **Step 3** (green circles): One entry per work order that was cascaded
- Each step shows the date that was set and the direction (before/after)
- If any step failed, it shows in red with an error message
- Click **"Start Over"** to run another cascade

### Editing Individual Dates

You can also edit any single task's date without running a full cascade:
- Click any date cell in the task table
- A date picker appears — pick the new date
- Click the green checkmark to save
- This updates that one task directly in Jobman

---

## Calendar View (Step-by-Step)

The calendar gives you a visual timeline of all tasks across jobs.

### Searching

- Type a job number into the search box in the top-right
- The calendar loads all matching jobs and their work orders
- The view automatically scrolls to show where the tasks are

### Reading the Calendar

- **Each row** is a job or work order
- **Parent jobs** have a blue dot next to them; work orders are indented underneath
- **Coloured bars** represent tasks, spanning from start date to target date
- **Colours indicate task type:**
  - Blue = Drafting / Design
  - Orange = Manufacturing
  - Yellow = Assembly
  - Green = Installation
  - Purple = Orders / Delivery
  - Pink = QA / Finalising
  - Teal = Book / Ready
- **Hover over any bar** to see the full task name, start date, and end date
- **Today** is highlighted with a blue circle and light blue column
- **Weekends** are shaded grey

### Navigating

| Button | Action |
|--------|--------|
| **← Prev** | Move the view back by the current period |
| **Today** | Jump back to the current week |
| **Next →** | Move the view forward by the current period |
| **1 Week / 2 Weeks / Month** | Change how many days are shown |

### Drag and Drop to Cascade

1. **Grab any task bar** by clicking and dragging it
2. **Drop it on a new day column** — the column highlights blue as you drag over it
3. A **confirmation dialog** appears showing:
   - Which task you're moving
   - The new date
   - The three cascade steps that will run
4. Click **"Run Cascade"** to proceed, or **"Cancel"** to abort
5. After the cascade completes, a **results dialog** shows what happened
6. The calendar **automatically refreshes** to show the updated dates

---

## Important Notes

- **Changes are permanent.** Every update writes directly to Jobman. There is no undo button — if you need to revert, you'll need to run another cascade with the original dates.

- **Capacity constraints are ignored.** The tool tells Jobman to skip labour availability checks, so dates won't get pushed out to find open slots. This matches how Aaron does it manually.

- **Work orders are detected by job number.** If the parent job is `0177`, the tool looks for work orders numbered `0177.1`, `0177.2`, `0177.3`, etc.

- **The "next task" is determined by order.** After setting the anchor task, the tool picks the task immediately below it in the task list as the one to forward-cascade from. This matches Jobman's workflow step order.

- **You don't need to refresh to see changes.** On the Cascade Tool, run another search after cascading to see updated dates. On the Calendar, it refreshes automatically.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Invalid or expired API token" | The Jobman API token has expired. Contact your admin to update it in the app settings. |
| A cascade step fails | Check the error message — it usually means Jobman rejected the date update for that specific task. You can try editing that task's date manually. |
| Work orders aren't being cascaded | Make sure the work orders follow the numbering pattern (e.g. `0177.1` for parent `0177`). Jobs with different base numbers won't be detected as work orders. |
| Dates look wrong after cascade | Go into Jobman directly and check the task dates. The cascade relies on Jobman's own recalculation engine, so the results depend on how the workflow steps and labour times are configured in Jobman. |
| Calendar shows no tasks | Make sure the tasks have start and/or target dates set in Jobman. Tasks without any dates won't appear on the calendar. |
| Can't drag a task on the calendar | Only tasks with a start date can be dragged. If a task only has a target date, edit it via the Cascade Tool first. |
