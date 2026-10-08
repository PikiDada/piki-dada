// Times of day with different traffic, in Kampala time (UTC+3, no daylight saving). Must match
// services/maps/internal/learn/bands.go, so the API's corrections and the maps platform's
// learned speeds talk about the same hours.
export const TIME_BANDS = {
  1: 'Night (21:00-06:00)',
  2: 'Morning rush (06:00-10:00)',
  3: 'Midday (10:00-16:00)',
  4: 'Evening rush (16:00-21:00)',
} as const;

export type TimeBand = keyof typeof TIME_BANDS;

const KAMPALA_OFFSET_HOURS = 3;

export function bandAt(date: Date): TimeBand {
  const hour = (date.getUTCHours() + KAMPALA_OFFSET_HOURS) % 24;
  if (hour >= 6 && hour < 10) return 2;
  if (hour >= 10 && hour < 16) return 3;
  if (hour >= 16 && hour < 21) return 4;
  return 1;
}

// The same rule in SQL, for a timestamp column stored in UTC (Prisma's default).
export function bandSql(column: string): string {
  const hour = `extract(hour from ${column} + interval '${KAMPALA_OFFSET_HOURS} hours')`;
  return `CASE WHEN ${hour} >= 6 AND ${hour} < 10 THEN 2
    WHEN ${hour} >= 10 AND ${hour} < 16 THEN 3
    WHEN ${hour} >= 16 AND ${hour} < 21 THEN 4 ELSE 1 END`;
}
