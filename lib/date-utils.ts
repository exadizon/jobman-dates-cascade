/**
 * Calculate the day offset between two dates.
 * Positive = future, negative = past.
 */
export function calculateOffset(currentDate: string, newDate: string): number {
  const current = new Date(currentDate + "T00:00:00Z");
  const target = new Date(newDate + "T00:00:00Z");
  const diffMs = target.getTime() - current.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Apply a day offset to a date string, returning YYYY-MM-DD.
 * Returns null if the input date is null/undefined.
 */
export function applyOffset(
  date: string | null | undefined,
  offsetDays: number
): string | null {
  if (!date) return null;
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

/**
 * Format a date string to a human-readable format.
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "No date set";
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Format the offset as a human-readable string.
 */
export function formatOffset(days: number): string {
  if (days === 0) return "No change";
  const direction = days > 0 ? "later" : "earlier";
  const absDays = Math.abs(days);
  return `${absDays} day${absDays === 1 ? "" : "s"} ${direction}`;
}
