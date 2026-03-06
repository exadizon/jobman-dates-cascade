import { updateTaskTargetDate } from './lib/jobman';

async function test() {
  try {
    const res = await updateTaskTargetDate("some-job-id", "518d6e32-2e97-40c9-ae52-cce6b11de937", "2026-06-15");
    console.log("Success:", res);
  } catch (err) {
    console.error("Test Error:", err);
  }
}
test();
