// Quick test script to debug the Jobman task date API
import 'dotenv/config';

const API_TOKEN = process.env.JOBMAN_API_TOKEN;
const BASE_URL = (process.env.JOBMAN_BASE_URL || 'https://api.jobmanapp.com').replace(/\/$/, '');
const ORG_ID = process.env.JOBMAN_ORGANISATION_ID;

const headers = {
  Authorization: `Bearer ${API_TOKEN}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

// 1. Find a test job
console.log('\n=== Step 1: Find test job 0177.3 ===');
const searchRes = await fetch(
  `${BASE_URL}/api/v1/organisations/${ORG_ID}/jobs?search=0177.3&limit=1`,
  { headers }
);
const searchData = await searchRes.json();
const job = searchData.jobs?.data?.[0] || searchData.data?.[0];
if (!job) { console.log('No job found!'); process.exit(1); }
console.log(`Found job: ${job.id} — ${job.number}`);

// 2. Get tasks for this job
console.log('\n=== Step 2: Get tasks ===');
const tasksRes = await fetch(
  `${BASE_URL}/api/v1/organisations/${ORG_ID}/jobs/${job.id}/tasks`,
  { headers }
);
const tasksData = await tasksRes.json();
const tasks = tasksData.tasks?.data || tasksData.data || [];
console.log(`Found ${tasks.length} tasks`);
if (tasks.length === 0) { console.log('No tasks!'); process.exit(1); }
const task = tasks[0];
console.log(`Using task: ${task.id} — ${task.name}`);

// 3. Try to update the target date with various payloads
const testDate = '2026-03-25T00:00:00.000000Z';
const url = `${BASE_URL}/api/v1/organisations/${ORG_ID}/jobs/${job.id}/tasks/${task.id}/target-date`;

// Test 1: JSON with recalculate_target_dates as integer 1
console.log('\n=== Test 1: JSON body, recalculate_target_dates = 1 (integer) ===');
const res1 = await fetch(url, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ target_date: testDate, recalculate_target_dates: 1 }),
});
console.log(`Status: ${res1.status}`);
console.log(`Body: ${await res1.text()}`);

// Test 2: JSON with recalculate_target_dates as boolean true
console.log('\n=== Test 2: JSON body, recalculate_target_dates = true (boolean) ===');
const res2 = await fetch(url, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ target_date: testDate, recalculate_target_dates: true }),
});
console.log(`Status: ${res2.status}`);
console.log(`Body: ${await res2.text()}`);

// Test 3: JSON body WITHOUT recalculate_target_dates at all
console.log('\n=== Test 3: JSON body, NO recalculate_target_dates ===');
const res3 = await fetch(url, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ target_date: testDate }),
});
console.log(`Status: ${res3.status}`);
console.log(`Body: ${await res3.text()}`);

// Test 4: form-urlencoded with PUT
console.log('\n=== Test 4: form-urlencoded, PUT, recalculate_target_dates=1 ===');
const res4 = await fetch(url, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `target_date=${encodeURIComponent(testDate)}&recalculate_target_dates=1`,
});
console.log(`Status: ${res4.status}`);
console.log(`Body: ${await res4.text()}`);

// Test 5: POST with _method=PUT and form-urlencoded
console.log('\n=== Test 5: POST + _method=PUT, form-urlencoded ===');
const res5 = await fetch(url, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `_method=PUT&target_date=${encodeURIComponent(testDate)}&recalculate_target_dates=1`,
});
console.log(`Status: ${res5.status}`);
console.log(`Body: ${await res5.text()}`);

// Test 6: Just target_date field, form-urlencoded, PUT
console.log('\n=== Test 6: form-urlencoded PUT, just target_date ===');
const res6 = await fetch(url, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `target_date=${encodeURIComponent(testDate)}`,
});
console.log(`Status: ${res6.status}`);
console.log(`Body: ${await res6.text()}`);

console.log('\n=== Done ===');
