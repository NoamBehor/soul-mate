/**
 * cycleLogic.ts  —  Medically-responsible cycle prediction engine.
 *
 * Design principles:
 *  • UTC-safe: All date math is done in UTC milliseconds. No raw `new Date('YYYY-MM-DD')`.
 *  • No fake precision: Ovulation is always "Estimated Ovulation Window".
 *  • Confidence gating: "High" requires ≥ 4 complete cycles.
 *  • Open cycle support: logs with period_end = null are excluded from length computation.
 */

import type { CycleLog } from '../services/cycleService';

// ─── UTC-safe date utilities ──────────────────────────────────────────────────

/**
 * Parse a 'YYYY-MM-DD' string without timezone shift.
 * `new Date('2024-05-08')` is parsed as UTC midnight which becomes the prior
 * day in UTC-5 environments — this helper avoids that.
 */
export function parseUTCDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Return today's date as 'YYYY-MM-DD' in the user's local calendar day,
 * but normalised so that further comparisons use UTC noon to avoid boundary issues.
 */
export function todayUTCString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a Date (assumed to be UTC midnight) back to 'YYYY-MM-DD'.
 */
export function formatUTCDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add N days to a 'YYYY-MM-DD' string. Returns 'YYYY-MM-DD'.
 */
export function addDays(dateStr: string, days: number): string {
  const d = parseUTCDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUTCDate(d);
}

/**
 * Difference in days between two 'YYYY-MM-DD' strings (b - a).
 */
export function diffDays(a: string, b: string): number {
  return Math.round(
    (parseUTCDate(b).getTime() - parseUTCDate(a).getTime()) / (1000 * 60 * 60 * 24),
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceLabel = 'High' | 'Medium' | 'Low' | 'Insufficient';

export interface CyclePrediction {
  avgCycleLength: number;
  variance: number; // standard deviation in days
  nextPeriodEstimate: string; // 'YYYY-MM-DD'
  fertileWindowStart: string;
  fertileWindowEnd: string;
  estimatedOvulationMid: string;
  confidenceScore: number; // 0–1
  confidenceLabel: ConfidenceLabel;
  basedOnCycles: number;
  insufficient: boolean;
  /** True when std-dev >= 7 days — predictions are less reliable */
  isIrregular: boolean;
}

/** Simple next-period prediction driven by user-configured settings. */
export interface SimplePrediction {
  /** lastPeriodStart + avgCycleLength */
  nextPeriodDate: string;
  /** Positive = days until; negative = days overdue */
  daysUntilNextPeriod: number;
}

export interface PhaseInfo {
  phase: 'Menstrual' | 'Follicular' | 'Estimated Ovulation' | 'Luteal';
  cycleDay: number;
  daysRemainingInPhase: number;
  proTip: string;
  color: string;
  /** Pie chart segments as proportions (sum = 1) */
  segments: {
    menstrual: number;
    follicular: number;
    ovulation: number;
    luteal: number;
  };
}

export interface CycleData {
  phase: string;
  daysRemaining: number;
  proTip: string;
  color: string;
}

// ─── Completed cycle lengths ──────────────────────────────────────────────────

/**
 * Extract cycle lengths from completed logs only (period_end !== null).
 * Returns cycle-start-to-cycle-start durations for the last `max` cycles.
 *
 * Edge-case safety (check 2): Always sorts by period_start chronologically
 * before calculating, regardless of the order received from Supabase.
 */
function extractCycleLengths(logs: CycleLog[], max = 6): number[] {
  // ── Safety: sort chronologically before any math ──────────────────────────
  const completed = [...logs]
    .filter((l) => l.period_end !== null)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  if (completed.length < 2) return [];

  const lengths: number[] = [];
  for (let i = 1; i < completed.length; i++) {
    const len = diffDays(completed[i - 1].period_start, completed[i].period_start);
    if (len > 14 && len < 60) { // sanity guard — ignore obvious data errors
      lengths.push(len);
    }
  }
  return lengths.slice(-max);
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─── Prediction engine ────────────────────────────────────────────────────────

/**
 * Compute the next period estimate and fertility window from historical logs.
 * Returns null if there is not enough data (< 2 complete cycles).
 */
export function computePrediction(logs: CycleLog[]): CyclePrediction | null {
  const lengths = extractCycleLengths(logs, 6);
  const completedCycles = logs.filter((l) => l.period_end !== null).length;

  if (lengths.length < 1 || completedCycles < 2) return null;

  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const sd = stddev(lengths);

  // ── Edge-case safety (check 4): guard NaN / non-positive avg ────────────
  if (!isFinite(avg) || avg <= 0) return null;
  const safeAvg = Math.max(avg, 14); // avg can't realistically be < 14 days
  const safeSd = isFinite(sd) && sd >= 0 ? sd : 0;

  // Most recent log (may be open or closed) — use chronologically last
  const sorted = [...logs].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const mostRecentStart = sorted[sorted.length - 1]?.period_start;
  if (!mostRecentStart) return null;

  const nextPeriodEstimate = addDays(mostRecentStart, Math.round(safeAvg));

  // Estimated ovulation: average cycle − 14 days (luteal phase is ~14 days)
  const ovulationMidOffset = Math.max(1, Math.round(safeAvg) - 14);
  const estimatedOvulationMid = addDays(mostRecentStart, ovulationMidOffset);
  const fertileWindowStart = addDays(mostRecentStart, Math.max(1, ovulationMidOffset - 2));
  const fertileWindowEnd = addDays(mostRecentStart, ovulationMidOffset + 2);

  // ── Irregularity detection: sd >= 7 days = clinically irregular ──────────
  const isIrregular = safeSd >= 7;

  // Confidence
  let confidenceScore: number;
  let confidenceLabel: ConfidenceLabel;

  if (isIrregular) {
    // Irregular cycles always get Low confidence regardless of cycle count
    confidenceScore = 0.25;
    confidenceLabel = 'Low';
  } else if (completedCycles >= 4 && safeSd < 2) {
    confidenceScore = 0.9;
    confidenceLabel = 'High';
  } else if (completedCycles >= 3 || (completedCycles >= 2 && safeSd <= 4)) {
    confidenceScore = 0.6;
    confidenceLabel = 'Medium';
  } else {
    confidenceScore = 0.3;
    confidenceLabel = 'Low';
  }

  return {
    avgCycleLength: Math.round(safeAvg * 10) / 10,
    variance: Math.round(safeSd * 10) / 10,
    nextPeriodEstimate,
    fertileWindowStart,
    fertileWindowEnd,
    estimatedOvulationMid,
    confidenceScore,
    confidenceLabel,
    basedOnCycles: completedCycles,
    insufficient: completedCycles < 2,
    isIrregular,
  };
}

// ─── Settings-driven simple prediction ───────────────────────────────────────

/**
 * Compute the next period date purely from the last known period start and
 * the user-configured average cycle length.
 * This is the primary prediction shown on the tracker — no historical logs needed.
 */
export function computeSimplePrediction(
  lastPeriodStart: string,
  avgCycleLength: number,
  _avgPeriodDuration: number, // used for calendar rendering; reserved here
): SimplePrediction {
  const safeLength = Math.max(14, Math.min(60, isFinite(avgCycleLength) ? avgCycleLength : 28));
  const nextPeriodDate = addDays(lastPeriodStart, safeLength);
  const daysUntilNextPeriod = diffDays(todayUTCString(), nextPeriodDate);
  return { nextPeriodDate, daysUntilNextPeriod };
}

// ─── Current cycle day ────────────────────────────────────────────────────────

/**
 * Returns how many days into the current cycle we are.
 * Uses the most recent period_start from any log (including open ones).
 * Returns 1 if no logs exist.
 */
export function getCurrentCycleDay(logs: CycleLog[]): number {
  if (logs.length === 0) return 1;
  const mostRecent = logs[logs.length - 1];
  const today = todayUTCString();
  const day = diffDays(mostRecent.period_start, today) + 1;
  return Math.max(1, day);
}

// ─── Phase info ───────────────────────────────────────────────────────────────

/**
 * Given the current cycle day and average cycle length, return phase details
 * and the pie chart segment proportions.
 */
export function getCyclePhaseInfo(cycleDay: number, avgLength = 28): PhaseInfo {
  // Guard non-positive / NaN inputs
  const safeAvgLength = (isFinite(avgLength) && avgLength > 0) ? Math.max(16, avgLength) : 28;
  const safeCycleDay  = Math.max(1, isFinite(cycleDay) ? cycleDay : 1);

  // ── Fixed phase boundaries per spec ──────────────────────────────────────
  // Days  1-5  → Menstrual   (Red)
  // Days  6-12 → Follicular  (Green)
  // Days 13-15 → Ovulation   (Yellow)
  // Days 16+   → Luteal      (Blue)
  const MENSTRUAL_END  = 5;
  const FOLLICULAR_END = 12;
  const OVULATION_END  = 15;

  const menstrualLen  = 5;                                       // always 5
  const follicularLen = 7;                                       // days 6-12
  const ovulationLen  = 3;                                       // days 13-15
  const lutealLen     = Math.max(1, safeAvgLength - OVULATION_END); // days 16+
  const total = menstrualLen + follicularLen + ovulationLen + lutealLen;

  const segments = {
    menstrual:  menstrualLen  / total,
    follicular: follicularLen / total,
    ovulation:  ovulationLen  / total,
    luteal:     lutealLen     / total,
  };

  if (safeCycleDay <= MENSTRUAL_END) {
    return {
      phase: 'Menstrual',
      cycleDay: safeCycleDay,
      daysRemainingInPhase: Math.max(0, MENSTRUAL_END - safeCycleDay + 1),
      proTip: 'Warmth and rest can ease discomfort. A warm compress, gentle movement, and staying hydrated may help.',
      color: '#EF4444',
      segments,
    };
  }
  if (safeCycleDay <= FOLLICULAR_END) {
    return {
      phase: 'Follicular',
      cycleDay: safeCycleDay,
      daysRemainingInPhase: Math.max(0, FOLLICULAR_END - safeCycleDay + 1),
      proTip: 'Energy tends to rise in this phase. A good time for activities, creative projects, or social plans.',
      color: '#22C55E',
      segments,
    };
  }
  if (safeCycleDay <= OVULATION_END) {
    return {
      phase: 'Estimated Ovulation',
      cycleDay: safeCycleDay,
      daysRemainingInPhase: Math.max(0, OVULATION_END - safeCycleDay + 1),
      proTip: 'This is an estimated fertile window, not a guarantee. Note that individual cycles vary.',
      color: '#EAB308',
      segments,
    };
  }
  return {
    phase: 'Luteal',
    cycleDay: safeCycleDay,
    daysRemainingInPhase: Math.max(0, safeAvgLength - safeCycleDay + 1),
    proTip: 'Some people notice shifts in energy or mood in this phase. Gentle support and rest are valuable.',
    color: '#3B82F6',
    segments,
  };
}

// ─── Calendar period dates ────────────────────────────────────────────────────

/**
 * Return all actual period dates from completed logs, plus predicted future dates
 * based on the average cycle length. Used by calendar.tsx to highlight dates.
 */
export function getPeriodDates(logs: CycleLog[] | null | undefined, numMonths = 3): string[] {
  // ── Safety guard: return empty array if logs is not a valid array ──────────
  if (!Array.isArray(logs)) return [];

  const dates = new Set<string>();

  // Actual historical period days
  for (const log of logs) {
    const end = log.period_end ?? addDays(log.period_start, 4); // assume 5-day period if open
    let cursor = log.period_start;
    let safety = 0;
    while (cursor <= end && safety < 30) {
      dates.add(cursor);
      cursor = addDays(cursor, 1);
      safety++;
    }
  }

  // Predicted future period windows
  const prediction = computePrediction(logs);
  if (prediction) {
    const totalDays = numMonths * 30;
    let nextStart = prediction.nextPeriodEstimate;
    for (let cycle = 0; cycle < numMonths + 1; cycle++) {
      const nextEnd = addDays(nextStart, 4);
      let cursor = nextStart;
      let safety = 0;
      while (cursor <= nextEnd && safety < 30) {
        const diffFromToday = diffDays(todayUTCString(), cursor);
        if (diffFromToday >= 0 && diffFromToday <= totalDays) {
          dates.add(cursor);
        }
        cursor = addDays(cursor, 1);
        safety++;
      }
      nextStart = addDays(nextStart, Math.round(prediction.avgCycleLength));
    }
  }

  return Array.from(dates).sort();
}

// ─── Backward-compat shim for index.tsx ──────────────────────────────────────

/**
 * Legacy wrapper used by index.tsx / calendar.tsx.
 * Pass real logs for accuracy; pass null for the simulated fallback.
 */
export function getCycleData(logs: CycleLog[] | null): CycleData {
  if (!logs || logs.length === 0) {
    return {
      phase: 'Unknown',
      daysRemaining: 0,
      proTip: 'Start tracking your cycle to see personalised insights here.',
      color: '#E9D5FF',
    };
  }
  const cycleDay = getCurrentCycleDay(logs);
  const prediction = computePrediction(logs);
  const phaseInfo = getCyclePhaseInfo(cycleDay, prediction?.avgCycleLength ?? 28);
  return {
    phase: phaseInfo.phase,
    daysRemaining: phaseInfo.daysRemainingInPhase,
    proTip: phaseInfo.proTip,
    color: phaseInfo.color,
  };
}

// ─── Input validation helper ──────────────────────────────────────────────────

export interface CycleLogValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a candidate log before saving.
 *
 * Checks:
 *  1. start must not be in the future
 *  2. end (if set) must not be in the future
 *  3. end must be >= start
 *  4. start must not overlap with any existing log's open or closed period
 *  5. only one log with period_end = null is allowed at a time
 *
 * @param start       period_start candidate ('YYYY-MM-DD')
 * @param end         period_end candidate ('YYYY-MM-DD' | null | '')
 * @param existingLogs all logs currently in Supabase
 * @param editingId   id of the log being edited (exclude from overlap check)
 */
export function validateCycleLog(
  start: string,
  end: string | null,
  existingLogs: CycleLog[],
  editingId?: string,
): CycleLogValidationResult {
  const today = todayUTCString();

  if (!start) return { valid: false, error: 'Period start date is required.' };

  // 1. Start not in future
  if (start > today) {
    return { valid: false, error: 'Start date cannot be in the future.' };
  }

  // 2. End not in future
  if (end && end > today) {
    return { valid: false, error: 'End date cannot be in the future.' };
  }

  // 3. End >= start
  if (end && end < start) {
    return { valid: false, error: 'End date must be on or after the start date.' };
  }

  // Logs excluding the one currently being edited
  const otherLogs = existingLogs.filter((l) => l.id !== editingId);

  // 4. Prevent multiple open cycles (check 1)
  if (!end) {
    const existingOpen = otherLogs.find((l) => l.period_end === null);
    if (existingOpen) {
      return {
        valid: false,
        error: `An active cycle already exists (started ${existingOpen.period_start}). Close it before starting a new one.`,
      };
    }
  }

  // 5. Overlap check — new start must not fall inside any existing log's date range
  for (const log of otherLogs) {
    const logEnd = log.period_end ?? today; // treat open log as running through today
    if (start >= log.period_start && start <= logEnd) {
      return {
        valid: false,
        error: `The start date overlaps with an existing cycle (${log.period_start} → ${log.period_end ?? 'present'}).`,
      };
    }
  }

  return { valid: true };
}
