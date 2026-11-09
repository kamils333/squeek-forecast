// Rounds follow Squeekchain's own "day": 12:00 UTC -> 12:00 UTC, labelled by the date it starts.
// e.g. round "2026-11-10" runs 2026-11-10T12:00Z -> 2026-11-11T12:00Z (21:00 -> 21:00 JST).

const DAY = 86400000;

export function roundStart(date: string): number {
  return Date.parse(date + "T12:00:00Z");
}

export function roundEnd(date: string): number {
  return roundStart(date) + DAY;
}

function label(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The round being run right now. */
export function currentRound(now = Date.now()): string {
  const d = new Date(now);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return label(d.getUTCHours() >= 12 ? base : base - DAY);
}

/** The round that is open for predictions (the next one). Predictions close when it starts. */
export function openRound(now = Date.now()): string {
  return label(roundStart(currentRound(now)) + DAY);
}

export function addDays(date: string, n: number): string {
  return label(roundStart(date) + n * DAY);
}

/**
 * Points for one prediction: 100 for exact, falling linearly with relative error, 0 at >=100% off.
 * A zero-distance day only rewards a zero prediction.
 */
export function scorePrediction(predKm: number, actualKm: number): number {
  if (actualKm <= 0) return predKm === 0 ? 100 : 0;
  const rel = Math.abs(predKm - actualKm) / actualKm;
  return Math.max(0, Math.round(100 * (1 - rel)));
}

export const CLOSEST_BONUS = 25;
export const MAX_KM = 50;
