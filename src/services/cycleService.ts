/**
 * cycleService.ts
 * Supabase CRUD + real-time listener for cycle_logs.
 * All dates are stored as 'YYYY-MM-DD' strings (timezone-neutral).
 *
 * Supabase table schemas:
 *
 *  cycle_logs:
 *    id            uuid primary key default gen_random_uuid()
 *    pair_id       text not null
 *    period_start  text not null          -- 'YYYY-MM-DD'
 *    period_end    text                   -- 'YYYY-MM-DD' or null
 *    symptoms      text[] default '{}'
 *    pain_level    smallint               -- 1–5 or null
 *    flow_strength text                   -- 'light' | 'medium' | 'heavy' or null
 *    notes         text default ''
 *    created_at    timestamptz default now()
 *
 *  cycle_settings:
 *    pair_id                 text primary key
 *    average_cycle_length    smallint not null default 28
 *    average_period_duration smallint not null default 5
 *    predicted_next_period   text               -- 'YYYY-MM-DD' or null
 *    updated_at              timestamptz default now()
 */
import { supabase } from './supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ─── Diagnostic helper ────────────────────────────────────────────────────────
function diagLog(label: string, ...args: unknown[]) {
  console.log(`%c[cycleService DIAG] ${label}`, 'color: #a855f7; font-weight: bold;', ...args);
}
function diagError(label: string, ...args: unknown[]) {
  console.error(`[cycleService ERROR] ${label}`, ...args);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type FlowStrength = 'light' | 'medium' | 'heavy';

/**
 * symptoms can arrive as:
 *   - string[]              — legacy format (text[] column)
 *   - Record<string,number> — new structured format (jsonb column), e.g. { Cramps: 4 }
 * Both are stored transparently; the UI normalises for display.
 */
export type SymptomsField = string[] | Record<string, number> | null | undefined;

export interface CycleLog {
  id: string;               // Supabase uuid
  period_start: string;     // 'YYYY-MM-DD'
  period_end: string | null;// 'YYYY-MM-DD' or null = currently active
  symptoms: SymptomsField;
  pain_level: number | null; // 1–5
  flow_strength: FlowStrength | null;
  notes: string;
  created_at: string;       // ISO timestamp string (from Supabase)
}

export type CycleLogInput = Omit<CycleLog, 'id' | 'created_at'>;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Add a new cycle log. Returns the new Supabase row id.
 */
export async function addCycleLog(
  pairId: string,
  log: CycleLogInput,
): Promise<string> {
  const { data, error } = await supabase
    .from('cycle_logs')
    .insert([{ ...log, pair_id: pairId }])
    .select('id')
    .single();

  if (error) throw new Error(`[cycleService] addCycleLog failed: ${error.message}`);
  return data.id as string;
}

/**
 * Partially update an existing log (e.g., set period_end, update symptoms).
 *
 * Supabase `update()` performs a server-side partial merge — only the
 * specified fields are overwritten. This provides natural last-write-wins
 * (LWW) semantics per field: the final write always wins, and no other fields
 * are silently deleted. This is correct for concurrent edits.
 */
export async function updateCycleLog(
  pairId: string,
  logId: string,
  patch: Partial<CycleLogInput>,
): Promise<void> {
  const { error } = await supabase
    .from('cycle_logs')
    .update(patch)
    .eq('id', logId)
    .eq('pair_id', pairId);

  if (error) throw new Error(`[cycleService] updateCycleLog failed: ${error.message}`);
}

/**
 * Delete a cycle log by its Supabase row id.
 * Prediction engine reacts automatically via the realtime channel listener.
 */
export async function deleteCycleLog(
  pairId: string,
  logId: string,
): Promise<void> {
  const { error } = await supabase
    .from('cycle_logs')
    .delete()
    .eq('id', logId)
    .eq('pair_id', pairId);

  if (error) throw new Error(`[cycleService] deleteCycleLog failed: ${error.message}`);
}

/**
 * Fetch all logs once (for initial load / one-off reads).
 */
export async function fetchCycleLogs(pairId: string): Promise<CycleLog[]> {
  // ── Diagnostic: current auth session ──────────────────────────────────────
  const { data: { session } } = await supabase.auth.getSession();
  diagLog('fetchCycleLogs called', {
    table: 'cycle_logs',
    pairId,
    pairIdType: typeof pairId,
    pairIdTruthy: Boolean(pairId),
    authUserId: session?.user?.id ?? 'NO AUTH USER',
    authEmail: session?.user?.email ?? 'none',
  });

  const { data, error } = await supabase
    .from('cycle_logs')
    .select('id, pair_id, period_start, period_end, symptoms, pain_level, flow_strength, notes, created_at')
    .eq('pair_id', pairId);

  if (error) {
    diagError('fetchCycleLogs SELECT error — RAW SUPABASE ERROR:', {
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint,
      statusCode: (error as any).status ?? (error as any).statusCode,
      fullError: error,
    });
    throw new Error(`[cycleService] fetchCycleLogs failed: ${error.message}`);
  }

  diagLog('fetchCycleLogs SUCCESS', { rowCount: (data ?? []).length, pairId });
  return rowsToSortedLogs(data ?? []);
}

/**
 * Subscribe to real-time updates via a Supabase Postgres Changes channel.
 * Returns an unsubscribe function.
 *
 * ── Lifecycle fix ────────────────────────────────────────────────────────────
 * Supabase caches channel objects by name: calling supabase.channel("same-name")
 * twice returns the SAME object. If that object is already subscribed, any
 * subsequent .on() call throws "cannot add postgres_changes callbacks after
 * subscribe()". This happened because both index.tsx and cycle.tsx called
 * subscribeToCycleLogs with the same pairId.
 *
 * Fix: each call appends a monotonically-incrementing instance counter to the
 * channel name. This guarantees a FRESH channel per subscription, so every
 * .on() is always attached BEFORE .subscribe() — the only correct order.
 *
 * ── pairId stability ─────────────────────────────────────────────────────────
 * Callers must still memoise pairId (useMemo) so that the useEffect dependency
 * doesn't re-fire on every render, which would recreate the channel needlessly.
 *
 * @param onError  Optional error handler. If omitted, errors are logged to console.
 */

// Monotonic counter — ensures every call gets a unique channel name even when
// the same pairId is used from multiple components simultaneously.
let _channelCounter = 0;

export function subscribeToCycleLogs(
  pairId: string,
  callback: (logs: CycleLog[]) => void,
  onError?: (error: Error) => void,
): () => void {
  // Local mirror updated by each realtime event to avoid a full re-fetch on change
  let localLogs: CycleLog[] = [];

  // Unique name per call — prevents Supabase from returning a cached,
  // already-subscribed channel and triggering the lifecycle error.
  const channelName = `cycle_logs_${pairId}_${++_channelCounter}`;

  // ── Diagnostic: log subscription context ──────────────────────────────────
  diagLog('subscribeToCycleLogs INIT', {
    channelName,
    table: 'cycle_logs',
    filter: `pair_id=eq.${pairId}`,
    pairId,
    pairIdType: typeof pairId,
    pairIdTruthy: Boolean(pairId),
    pairIdIsDefault: pairId === 'default',
    pairIdLength: pairId?.length ?? 0,
  });

  if (!pairId || pairId === 'default') {
    diagError('subscribeToCycleLogs — pairId is NULL or "default"! This will cause RLS to block all rows.', { pairId });
  }

  // ── IMPORTANT: ALL .on() handlers must be chained BEFORE .subscribe() ──────
  const channel = supabase
    .channel(channelName)
    .on<CycleLog>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'cycle_logs',
        filter: `pair_id=eq.${pairId}`,
      },
      (payload: RealtimePostgresChangesPayload<CycleLog>) => {
        diagLog('postgres_changes event received', {
          eventType: payload.eventType,
          table: (payload as any).table,
          schema: (payload as any).schema,
          newKeys: payload.new ? Object.keys(payload.new) : null,
          oldKeys: payload.old ? Object.keys(payload.old) : null,
        });
        try {
          if (payload.eventType === 'INSERT' && payload.new) {
            const newRow = mapRow(payload.new as any);
            // Deduplicate: ignore if already in local mirror
            if (!localLogs.some((l) => l.id === newRow.id)) {
              localLogs = [...localLogs, newRow];
            }
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = mapRow(payload.new as any);
            localLogs = localLogs.map((l) => (l.id === updated.id ? updated : l));
          } else if (payload.eventType === 'DELETE' && (payload.old as any)?.id) {
            const deletedId = (payload.old as any).id as string;
            localLogs = localLogs.filter((l) => l.id !== deletedId);
          }
          callback(sortedLogs(localLogs));
        } catch (err: any) {
          diagError('realtime handler error', err);
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      },
    )
    // ── .subscribe() is called LAST — no .on() calls may follow ──────────────
    .subscribe(async (status, err) => {
      // ── Diagnostic: log every subscription status change ──────────────────
      diagLog('subscribe() status callback', {
        status,
        channelName,
        pairId,
        hasError: Boolean(err),
        errorMessage: err?.message ?? null,
        rawError: err ?? null,
      });

      if (status === 'SUBSCRIBED') {
        diagLog('Channel SUBSCRIBED — running initial fetch', { pairId, table: 'cycle_logs' });
        // Seed the local mirror with the current DB state once the channel is live
        try {
          const rows = await fetchCycleLogs(pairId);
          localLogs = rows;
          callback(rows);
        } catch (fetchErr: any) {
          diagError('initial fetchCycleLogs failed after SUBSCRIBED', {
            message: fetchErr?.message,
            code: fetchErr?.code,
            rawError: fetchErr,
          });
          onError?.(fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)));
        }
      } else if (status === 'CHANNEL_ERROR') {
        diagError('CHANNEL_ERROR — RAW ERROR:', {
          message: err?.message ?? 'no message',
          rawError: err,
          pairId,
          channelName,
          hint: 'Check: 1) Realtime enabled for cycle_logs in Supabase dashboard, 2) RLS policies for realtime, 3) table exists',
        });
        onError?.(new Error(`CHANNEL_ERROR: ${err?.message ?? 'unknown'}`));
      } else if (status === 'TIMED_OUT') {
        diagError('TIMED_OUT — subscription timed out', {
          pairId,
          channelName,
          rawError: err,
          hint: 'Realtime may not be enabled for cycle_logs table in Supabase Dashboard > Database > Replication',
        });
        onError?.(new Error(`TIMED_OUT: ${err?.message ?? 'unknown'}`));
      } else if (status === 'CLOSED') {
        diagLog('Channel CLOSED', { channelName, pairId });
      } else {
        diagLog('Unknown status', { status, err });
      }
    });

  // Cleanup: always remove the channel so it doesn't linger in Supabase's
  // internal registry and cause the next subscribe call to receive a stale object.
  return () => {
    diagLog('Unsubscribing channel', { channelName, pairId });
    supabase.removeChannel(channel);
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapRow(row: any): CycleLog {
  // Normalise symptoms: keep as-is if array or plain object; default to [].
  // Never call .join() here — leave format detection to the UI layer.
  const rawSymptoms = row.symptoms;
  const symptoms: SymptomsField =
    rawSymptoms == null
      ? []
      : Array.isArray(rawSymptoms)
      ? rawSymptoms
      : typeof rawSymptoms === 'object'
      ? rawSymptoms as Record<string, number>
      : [];

  return {
    id:            row.id            ?? '',
    period_start:  row.period_start  ?? '',
    period_end:    row.period_end    ?? null,
    symptoms,
    pain_level:    row.pain_level    ?? null,
    flow_strength: row.flow_strength ?? null,
    notes:         row.notes         ?? '',
    created_at:    row.created_at    ?? '',
  };
}

function rowsToSortedLogs(rows: any[]): CycleLog[] {
  return sortedLogs(rows.map(mapRow));
}

/**
 * Sort chronologically by period_start so that prediction math is always
 * stable regardless of Supabase insertion order or concurrent writes.
 *
 * Edge-case safety (check 2): always sort before any calculation.
 */
function sortedLogs(logs: CycleLog[]): CycleLog[] {
  return [...logs].sort((a, b) => a.period_start.localeCompare(b.period_start));
}

// ─── Cycle Settings ────────────────────────────────────────────────────────────

/**
 * Supabase table (created in SQL editor):
 *
 *   create table if not exists cycle_settings (
 *     pair_id                 text primary key,
 *     average_cycle_length    smallint not null default 28,
 *     average_period_duration smallint not null default 5,
 *     predicted_next_period   text,          -- 'YYYY-MM-DD' or null
 *     updated_at              timestamptz default now()
 *   );
 *
 * RLS: disabled (per user request).
 * Realtime: enable via Supabase Dashboard → Database → Replication
 *           to make subscribeToCycleSettings receive live updates.
 */

export interface CycleSettings {
  average_cycle_length: number;    // default 28
  average_period_duration: number; // default 5
  predicted_next_period: string | null; // 'YYYY-MM-DD' — written by prediction engine
}

export const DEFAULT_CYCLE_SETTINGS: CycleSettings = {
  average_cycle_length: 28,
  average_period_duration: 5,
  predicted_next_period: null,
};

/**
 * Fetch the current cycle settings for a pair. Returns defaults if no row exists.
 */
export async function fetchCycleSettings(pairId: string): Promise<CycleSettings> {
  const { data, error } = await supabase
    .from('cycle_settings')
    .select('average_cycle_length, average_period_duration, predicted_next_period')
    .eq('pair_id', pairId)
    .maybeSingle();

  if (error) {
    diagError('fetchCycleSettings failed', { message: error.message, pairId });
    throw new Error(`[cycleService] fetchCycleSettings failed: ${error.message}`);
  }

  if (!data) return { ...DEFAULT_CYCLE_SETTINGS };

  return {
    average_cycle_length:    data.average_cycle_length    ?? 28,
    average_period_duration: data.average_period_duration ?? 5,
    predicted_next_period:   data.predicted_next_period   ?? null,
  };
}

/**
 * Upsert cycle settings for a pair (creates the row if it doesn't exist).
 * Does NOT touch predicted_next_period — use runPredictionEngine for that.
 */
export async function saveCycleSettings(
  pairId: string,
  settings: Pick<CycleSettings, 'average_cycle_length' | 'average_period_duration'>,
): Promise<void> {
  const { error } = await supabase
    .from('cycle_settings')
    .upsert({
      pair_id: pairId,
      average_cycle_length:    settings.average_cycle_length,
      average_period_duration: settings.average_period_duration,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'pair_id' });

  if (error) throw new Error(`[cycleService] saveCycleSettings failed: ${error.message}`);
}

/**
 * Subscribe to real-time updates for cycle settings.
 * Calls `callback` immediately with the current DB values, then again on any change.
 * Returns an unsubscribe function.
 */
export function subscribeToCycleSettings(
  pairId: string,
  callback: (settings: CycleSettings) => void,
  onError?: (error: Error) => void,
): () => void {
  const channelName = `cycle_settings_${pairId}_${++_channelCounter}`;

  const channel = supabase
    .channel(channelName)
    .on<any>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'cycle_settings',
        filter: `pair_id=eq.${pairId}`,
      },
      (payload: any) => {
        const row = payload.new && Object.keys(payload.new).length > 0 ? payload.new : null;
        if (row) {
          callback({
            average_cycle_length:    row.average_cycle_length    ?? 28,
            average_period_duration: row.average_period_duration ?? 5,
            predicted_next_period:   row.predicted_next_period   ?? null,
          });
        }
      },
    )
    .subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        try {
          const settings = await fetchCycleSettings(pairId);
          callback(settings);
        } catch (fetchErr: any) {
          onError?.(fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)));
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        diagError('subscribeToCycleSettings channel error', { status, message: err?.message, pairId });
        // Fall back: fetch once so the UI still gets valid settings
        try {
          const settings = await fetchCycleSettings(pairId);
          callback(settings);
        } catch { /* ignore — already defaulted in state */ }
        onError?.(new Error(`Settings channel ${status}: ${err?.message ?? 'unknown'}`));
      }
    });

  return () => { supabase.removeChannel(channel); };
}

// ─── Prediction Engine ─────────────────────────────────────────────────────────

/**
 * Add 'n' days to a YYYY-MM-DD string. Returns YYYY-MM-DD.
 * (Duplicated locally to avoid a circular dependency with cycleLogic.ts)
 */
function addDaysLocal(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Difference in days between two YYYY-MM-DD strings (b − a).
 */
function diffDaysLocal(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = new Date(Date.UTC(ay, am - 1, ad));
  const db = new Date(Date.UTC(by, bm - 1, bd));
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Extract cycle-to-cycle lengths (period_start gaps) from sorted completed logs.
 * Only gaps in the plausible range [14, 60] are used.
 */
function extractCycleLengthsLocal(logs: CycleLog[]): number[] {
  const completed = [...logs]
    .filter((l) => l.period_end !== null)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  const lengths: number[] = [];
  for (let i = 1; i < completed.length; i++) {
    const len = diffDaysLocal(completed[i - 1].period_start, completed[i].period_start);
    if (len >= 14 && len <= 60) lengths.push(len);
  }
  return lengths;
}

/**
 * ─── runPredictionEngine ────────────────────────────────────────────────────
 *
 * Core of the prediction system. Called after every save/edit/delete.
 *
 * Algorithm:
 *  1. Fetch the latest logs and current settings.
 *  2. ML-Light: if 3+ completed logs exist, recalculate average_cycle_length
 *     from actual period-start gaps (last 6 cycles, sanity-clamped to [14, 60]).
 *  3. Prediction: predicted_next_period = last_period_start + average_cycle_length.
 *  4. Upsert the updated values into cycle_settings so both partners see them live.
 *
 * @returns The predicted next period date string, or null if insufficient data.
 */
export async function runPredictionEngine(pairId: string): Promise<string | null> {
  diagLog('runPredictionEngine START', { pairId });

  // 1. Load current data
  const [logs, currentSettings] = await Promise.all([
    fetchCycleLogs(pairId),
    fetchCycleSettings(pairId),
  ]);

  // Need at least one log to predict
  const sorted = [...logs].sort((a, b) => a.period_start.localeCompare(b.period_start));
  if (sorted.length === 0) {
    diagLog('runPredictionEngine — no logs, skipping', { pairId });
    return null;
  }

  // 2. ML-Light: recalculate average_cycle_length if 3+ completed logs exist
  const lengths = extractCycleLengthsLocal(logs);
  let newAvgCycleLength = currentSettings.average_cycle_length;

  if (lengths.length >= 2) {
    // We need at least 2 gaps (= 3 completed periods) for a meaningful average
    const rawAvg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    // Clamp to medically plausible range
    newAvgCycleLength = Math.round(Math.max(14, Math.min(60, rawAvg)));
    diagLog('runPredictionEngine ML-Light', {
      gaps: lengths,
      rawAvg,
      newAvgCycleLength,
      previousAvg: currentSettings.average_cycle_length,
    });
  }

  // 3. Prediction: last_period_start + average_cycle_length
  const lastLog = sorted[sorted.length - 1];
  const predictedNextPeriod = addDaysLocal(lastLog.period_start, newAvgCycleLength);

  diagLog('runPredictionEngine RESULT', {
    lastPeriodStart: lastLog.period_start,
    newAvgCycleLength,
    predictedNextPeriod,
    basedOnGaps: lengths.length,
  });

  // 4. Upsert updated settings (avg length + prediction) into DB
  const { error } = await supabase
    .from('cycle_settings')
    .upsert(
      {
        pair_id: pairId,
        average_cycle_length:    newAvgCycleLength,
        average_period_duration: currentSettings.average_period_duration,
        predicted_next_period:   predictedNextPeriod,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'pair_id' },
    );

  if (error) {
    diagError('runPredictionEngine upsert failed', { message: error.message });
    throw new Error(`[cycleService] runPredictionEngine failed: ${error.message}`);
  }

  diagLog('runPredictionEngine UPSERT SUCCESS', { predictedNextPeriod, newAvgCycleLength });
  return predictedNextPeriod;
}

/**
 * ─── saveLogAndPredict ───────────────────────────────────────────────────────
 *
 * Atomic "save + predict" helper used by cycle.tsx handleSaveLog:
 *  1. Insert or update the cycle log in cycle_logs.
 *  2. Immediately run the prediction engine to update cycle_settings.
 *
 * @param pairId   Pair identifier
 * @param log      Log data to save
 * @param editId   If provided, performs an UPDATE instead of INSERT
 * @returns        The predicted next period date string, or null
 */
export async function saveLogAndPredict(
  pairId: string,
  log: CycleLogInput,
  editId?: string | null,
): Promise<{ logId: string | null; predictedDate: string | null }> {
  let logId: string | null = null;

  if (editId) {
    // UPDATE existing log
    await updateCycleLog(pairId, editId, log);
    logId = editId;
  } else {
    // INSERT new log
    logId = await addCycleLog(pairId, log);
  }

  // Run prediction engine after the mutation
  const predictedDate = await runPredictionEngine(pairId);

  return { logId, predictedDate };
}
