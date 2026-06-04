import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Alert, Modal, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useAuth } from '@/src/context/AuthContext';
import {
  subscribeToCycleLogs, saveLogAndPredict, updateCycleLog, deleteCycleLog,
  subscribeToCycleSettings, saveCycleSettings,
  CycleLog, FlowStrength, CycleSettings, DEFAULT_CYCLE_SETTINGS, SymptomsField,
} from '@/src/services/cycleService';
import {
  computePrediction, computeSimplePrediction, getCyclePhaseInfo, getCurrentCycleDay,
  todayUTCString, addDays, diffDays, ConfidenceLabel, validateCycleLog,
} from '@/src/utils/cycleLogic';
import CyclePieChart from '@/components/CyclePieChart';
import { useNotifications } from '@/src/hooks/useNotifications';

// ─── Symptom options ──────────────────────────────────────────────────────────
const SYMPTOM_OPTIONS = ['Cramps', 'Bloating', 'Headache', 'Fatigue', 'Mood changes', 'Back pain', 'Breast tenderness', 'Spotting'];
const FLOW_OPTIONS: FlowStrength[] = ['light', 'medium', 'heavy'];

// ─── Symptom normalisation helpers ───────────────────────────────────────────
/**
 * Returns a flat list of { name, severity? } objects from any symptoms format.
 * Guarantees no crash regardless of whether symptoms is null, [], or {}.
 */
function normaliseSymptoms(
  symptoms: SymptomsField,
): Array<{ name: string; severity?: number }> {
  if (!symptoms) return [];

  // New format: Record<string, number>  e.g. { Cramps: 4, Fatigue: 2 }
  if (!Array.isArray(symptoms) && typeof symptoms === 'object') {
    return Object.entries(symptoms).map(([name, severity]) => ({ name, severity }));
  }

  // Legacy format: string[]  e.g. ['Cramps', 'Fatigue']
  if (Array.isArray(symptoms)) {
    return symptoms.map((name) => ({ name }));
  }

  return [];
}

/**
 * Coerce any SymptomsField to a plain string[] for the modal toggle UI.
 * The modal only supports selecting symptom names (no severity in the UI yet).
 */
function symptomsToStringArray(symptoms: SymptomsField): string[] {
  if (!symptoms) return [];
  if (Array.isArray(symptoms)) return symptoms as string[];
  if (typeof symptoms === 'object') return Object.keys(symptoms);
  return [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ConfidenceBadge({ label }: { label: ConfidenceLabel }) {
  const map: Record<ConfidenceLabel, { bg: string; text: string; dot: string }> = {
    High:         { bg: '#dcfce7', text: '#166534', dot: '#22c55e' },
    Medium:       { bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
    Low:          { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
    Insufficient: { bg: '#f1f5f9', text: '#475569', dot: '#94a3b8' },
  };
  const s = map[label];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: s.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.dot, marginRight: 5 }} />
      <Text style={{ color: s.text, fontSize: 12, fontWeight: '600' }}>{label} confidence</Text>
    </View>
  );
}

function LogCard({
  log, onEdit, onDelete, isFemale,
}: {
  log: CycleLog;
  onEdit: (l: CycleLog) => void;
  onDelete: (l: CycleLog) => void;
  isFemale: boolean;
}) {
  const isActive = log.period_end === null;
  const symptomItems = normaliseSymptoms(log.symptoms);
  const hasObjectFormat =
    log.symptoms != null &&
    !Array.isArray(log.symptoms) &&
    typeof log.symptoms === 'object';

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: isActive ? '#c084fc' : '#f3e8ff', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontWeight: '700', color: '#581C87', fontSize: 15 }}>
          {formatDisplayDate(log.period_start)}{log.period_end ? ` → ${formatDisplayDate(log.period_end)}` : ''}
        </Text>
        {isActive && (
          <View style={{ backgroundColor: '#e9d5ff', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: '#7c3aed', fontSize: 11, fontWeight: '700' }}>ACTIVE</Text>
          </View>
        )}
      </View>
      {log.flow_strength && <Text style={{ color: '#64748b', fontSize: 13, marginBottom: 2 }}>Flow: {log.flow_strength}</Text>}
      {log.pain_level   && <Text style={{ color: '#64748b', fontSize: 13, marginBottom: 2 }}>Pain: {log.pain_level}/5</Text>}

      {/* ── Symptom pills ─────────────────────────────────────────────────── */}
      {symptomItems.length > 0 && (
        <View style={{ marginBottom: 6 }}>
          <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 5, fontWeight: '600' }}>Symptoms</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {symptomItems.map(({ name, severity }) => (
              <View
                key={name}
                style={{
                  backgroundColor: hasObjectFormat ? '#faf5ff' : '#f3e8ff',
                  borderRadius: 20,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: hasObjectFormat ? '#c4b5fd' : '#e9d5ff',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Text style={{ color: '#6d28d9', fontSize: 12, fontWeight: '600' }}>{name}</Text>
                {severity !== undefined && (
                  <Text style={{ color: '#9333ea', fontSize: 11, fontWeight: '500' }}>
                    • {severity}/5
                  </Text>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {log.notes ? <Text style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>{log.notes}</Text> : null}
      {isFemale && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 10 }}>
          <TouchableOpacity onPress={() => onDelete(log)}>
            <Text style={{ color: '#ef4444', fontWeight: '600', fontSize: 13 }}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onEdit(log)}>
            <Text style={{ color: '#7c3aed', fontWeight: '600', fontSize: 13 }}>Edit</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Date formatting helper ───────────────────────────────────────────────────
function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ─── Inline Calendar Picker ───────────────────────────────────────────────────
function DatePickerField({
  label, required, value, maxDate, minDate, onSelect,
}: {
  label: string; required?: boolean; value: string;
  maxDate?: string; minDate?: string;
  onSelect: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const marked = value ? { [value]: { selected: true, selectedColor: '#7c3aed' } } : {};

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: '#7c3aed', fontWeight: '600', marginBottom: 6 }}>
        {label}{required && <Text style={{ color: '#ef4444' }}> *</Text>}
      </Text>
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        style={{
          backgroundColor: '#faf5ff', borderRadius: 12, padding: 14,
          borderWidth: 1, borderColor: open ? '#7c3aed' : '#e9d5ff',
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: value ? '#1e293b' : '#94a3b8', fontSize: 15 }}>
          {value ? formatDisplayDate(value) : 'Select date…'}
        </Text>
        <Text style={{ fontSize: 16 }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{
          borderRadius: 16, overflow: 'hidden', marginTop: 4,
          borderWidth: 1, borderColor: '#e9d5ff',
          shadowColor: '#7c3aed', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
        }}>
          <Calendar
            current={value || undefined}
            maxDate={maxDate}
            minDate={minDate}
            markedDates={marked}
            onDayPress={(day: { dateString: string }) => {
              // ── Diagnostic: verify the raw value is YYYY-MM-DD (never a display string)
              console.log('[DatePicker] raw selected value:', day.dateString);
              onSelect(day.dateString);
              setOpen(false);
            }}
            theme={{
              backgroundColor: '#fff',
              calendarBackground: '#fff',
              selectedDayBackgroundColor: '#7c3aed',
              selectedDayTextColor: '#fff',
              todayTextColor: '#7c3aed',
              dayTextColor: '#1e293b',
              textDisabledColor: '#d1d5db',
              arrowColor: '#7c3aed',
              monthTextColor: '#581C87',
              textMonthFontWeight: '700',
              textDayFontSize: 14,
              textMonthFontSize: 15,
            }}
          />
        </View>
      )}
    </View>
  );
}

// ─── Log Modal ────────────────────────────────────────────────────────────────
interface LogModalProps {
  visible: boolean;
  initial?: CycleLog | null;
  existingLogs: CycleLog[];
  pairId: string;
  onClose: () => void;
  onSave: (data: Omit<CycleLog, 'id' | 'created_at'>) => Promise<void>;
}

function LogModal({ visible, initial, existingLogs, pairId, onClose, onSave }: LogModalProps) {
  const today = todayUTCString();

  // ── Form state ────────────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate]     = useState<string>('');
  const [symptoms, setSymptoms]   = useState<string[]>([]);
  const [pain, setPain]           = useState<string>('');
  const [flow, setFlow]           = useState<FlowStrength | null>(null);
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  // ── Mount/unmount diagnostic ─────────────────────────────────────────────
  // If "[LogModal] unmounted" appears in the console right after selecting a
  // date, the component instance is being destroyed (e.g. due to a conditional
  // render in the parent). The fix is to always keep <LogModal> mounted and
  // gate visibility purely via the `visible` prop.
  useEffect(() => {
    console.log('[LogModal] mounted');
    return () => console.log('[LogModal] unmounted');
  }, []);

  // ── Track the last "open session" key to detect real open/edit transitions
  // Key = "<visible>|<initial?.id>". The form is (re)initialized only when
  // this key changes, i.e. when the modal truly opens or switches to a
  // different log. Re-renders while the modal is already open leave the key
  // unchanged, so user input is never wiped by Supabase real-time pushes.
  const sessionKeyRef = useRef<string>('');

  useEffect(() => {
    const currentKey = `${visible}|${initial?.id ?? 'new'}`;
    const isNewSession = currentKey !== sessionKeyRef.current;

    // ── Diagnostic: log every effect invocation ───────────────────────────
    console.log('[LogModal] useEffect fired', {
      visible,
      initialId: initial?.id ?? null,
      currentKey,
      previousKey: sessionKeyRef.current,
      isNewSession,
      startDateCurrent: startDate,
      endDateCurrent: endDate,
    });

    if (!isNewSession) {
      console.log('[LogModal] same session key — NOT resetting (protecting user input)');
      return;
    }

    // Always update the ref BEFORE checking `visible`, so a close→open with
    // the same log ID still triggers a fresh initialization next time.
    sessionKeyRef.current = currentKey;

    if (!visible) {
      // Modal closed — do not touch form state (avoids flash of empty form)
      console.log('[LogModal] modal closed — skipping form reset');
      return;
    }

    // ── Modal just opened (or switched to a different log): initialize ──────
    console.log('[LogModal] modal opened — initializing form state', {
      editingLogId: initial?.id ?? null,
      startDateAfter: initial?.period_start ?? '',
      endDateAfter: initial?.period_end ?? '',
    });

    setStartDate(initial?.period_start ?? '');
    setEndDate(initial?.period_end ?? '');
    setSymptoms(symptomsToStringArray(initial?.symptoms));
    setPain(initial?.pain_level?.toString() ?? '');
    setFlow(initial?.flow_strength ?? null);
    setNotes(initial?.notes ?? '');
    setSaving(false);
    setSaved(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial?.id]);
  // ↑ `initial?.id` is safe to include: it only changes when the parent
  //   deliberately switches to a different log (handleEdit). The object
  //   reference changes caused by Supabase realtime pushes leave the id
  //   unchanged, so those do NOT trigger a reset.

  const toggleSymptom = (s: string) =>
    setSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const handleSave = async () => {
    // ── Diagnostic: full state snapshot at save time ──────────────────────────
    console.log('[handleSave] current state:', {
      startDate,
      endDate,
      typeofStart: typeof startDate,
      startDateLength: startDate.length,
      symptoms,
      pain,
      flow,
      notes,
      saving,
      saved,
    });

    // ── 1. Missing period_start ───────────────────────────────────────────
    if (!startDate) {
      Alert.alert('Missing Start Date', 'Please select a period start date before saving.');
      return;
    }

    // ── 2. Future date guard ──────────────────────────────────────────────
    if (startDate > today) {
      Alert.alert('Future Date', 'Period start cannot be in the future. You can only log a period that has already begun.');
      return;
    }

    // ── 3. Explicit null coercion for end date ────────────────────────────
    // endDate may be '' (cleared by user) or 'YYYY-MM-DD' (set). Never send
    // an empty string to Supabase — always coerce to null for ongoing cycles.
    const endValue: string | null = endDate && endDate.trim() ? endDate.trim() : null;

    // ── 3. End before start ───────────────────────────────────────────────
    if (endValue && endValue < startDate) {
      Alert.alert('Invalid Date Range', 'Period end date cannot be before the start date.');
      return;
    }

    // ── 4. End in future ──────────────────────────────────────────────────
    if (endValue && endValue > today) {
      Alert.alert('Future Date', 'Period end date cannot be in the future.');
      return;
    }

    // ── 5. Full centralised validation (overlaps, open cycles, etc.) ──────
    const { valid, error } = validateCycleLog(startDate, endValue, existingLogs, initial?.id);
    if (!valid) {
      Alert.alert('Invalid Entry', error ?? 'Please check your dates.');
      return;
    }

    // ── 6. Pain level range guard ─────────────────────────────────────────
    const painNum = pain ? parseInt(pain, 10) : null;
    if (painNum !== null && (painNum < 1 || painNum > 5 || isNaN(painNum))) {
      Alert.alert('Invalid Pain Level', 'Pain level must be between 1 and 5.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        period_start: startDate,
        period_end: endValue,
        symptoms,
        pain_level: painNum,
        flow_strength: flow,
        notes,
      });
      setSaved(true);
      // Show success briefly, then close
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1400);
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message ?? 'Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
      >
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '95%' }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#581C87', marginBottom: 20, textAlign: 'center' }}>
              {initial ? 'Edit Cycle Log' : 'New Cycle Log'}
            </Text>

            {/* ── Date Pickers ─────────────────────────────────────────── */}
            <DatePickerField
              label="Period Start"
              required
              value={startDate}
              maxDate={today}
              onSelect={(dateString: string) => {
                console.log('[DatePickerField] Period Start selected:', dateString);
                setStartDate(dateString);
              }}
            />

            <DatePickerField
              label="Period End (leave unset if ongoing)"
              value={endDate}
              maxDate={today}
              minDate={startDate || undefined}
              onSelect={(dateString: string) => {
                console.log('[DatePickerField] Period End selected:', dateString);
                setEndDate(dateString);
              }}
            />
            {endDate ? (
              <TouchableOpacity
                onPress={() => setEndDate('')}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: -6,
                  marginBottom: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#fee2e2',
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ color: '#dc2626', fontSize: 13, fontWeight: '700' }}>✕  Clear — mark as ongoing</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ marginTop: -6, marginBottom: 14 }}>
                <Text style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>
                  Leave unset if period is still ongoing
                </Text>
              </View>
            )}

            {/* ── Flow Strength ─────────────────────────────────────────── */}
            <Text style={{ color: '#7c3aed', fontWeight: '600', marginBottom: 8 }}>Flow Strength</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              {FLOW_OPTIONS.map(f => (
                <TouchableOpacity key={f} onPress={() => setFlow(f === flow ? null : f)}
                  style={{ flex: 1, backgroundColor: flow === f ? '#7c3aed' : '#f3e8ff', borderRadius: 12, paddingVertical: 10, alignItems: 'center' }}>
                  <Text style={{ color: flow === f ? '#fff' : '#7c3aed', fontWeight: '600', textTransform: 'capitalize' }}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ color: '#7c3aed', fontWeight: '600', marginBottom: 4 }}>Pain Level (1 = mild, 5 = severe)</Text>
            <TextInput
              value={pain} onChangeText={setPain} keyboardType="numeric" placeholder="e.g. 3"
              style={{ backgroundColor: '#faf5ff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e9d5ff', marginBottom: 14, color: '#1e293b' }}
            />

            <Text style={{ color: '#7c3aed', fontWeight: '600', marginBottom: 8 }}>Symptoms</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {SYMPTOM_OPTIONS.map(s => (
                <TouchableOpacity key={s} onPress={() => toggleSymptom(s)}
                  style={{ backgroundColor: symptoms.includes(s) ? '#7c3aed' : '#f3e8ff', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Text style={{ color: symptoms.includes(s) ? '#fff' : '#7c3aed', fontSize: 13 }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ color: '#7c3aed', fontWeight: '600', marginBottom: 4 }}>Notes</Text>
            <TextInput
              value={notes} onChangeText={setNotes} multiline numberOfLines={3} placeholder="Optional notes..."
              style={{ backgroundColor: '#faf5ff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e9d5ff', marginBottom: 20, color: '#1e293b', textAlignVertical: 'top' }}
            />

            {/* ── Save Button with loading + success states ─────────────── */}
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || saved}
              style={{
                backgroundColor: saved ? '#22c55e' : saving ? '#c4b5fd' : '#7c3aed',
                borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 12,
                shadowColor: saved ? '#22c55e' : '#7c3aed',
                shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
              }}
            >
              {saving && !saved ? (
                <ActivityIndicator color="#fff" />
              ) : saved ? (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>✓ Log saved & Prediction updated!</Text>
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>💾 Save Log</Text>
              )}
            </TouchableOpacity>

            {!saving && !saved && (
              <TouchableOpacity onPress={onClose} style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={{ color: '#94a3b8', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Settings Modal ─────────────────────────────────────────────────────────
function SettingsModal({ visible, settings, onClose, onSave }: {
  visible: boolean; settings: CycleSettings;
  onClose: () => void; onSave: (s: Pick<CycleSettings, 'average_cycle_length' | 'average_period_duration'>) => Promise<void>;
}) {
  const [len, setLen] = useState(settings.average_cycle_length.toString());
  const [dur, setDur] = useState(settings.average_period_duration.toString());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setLen(settings.average_cycle_length.toString());
      setDur(settings.average_period_duration.toString());
    }
  }, [visible, settings]);

  const handleSave = async () => {
    const l = parseInt(len, 10), d = parseInt(dur, 10);
    if (isNaN(l) || l < 14 || l > 60) { Alert.alert('Invalid', 'Cycle length must be 14–60 days.'); return; }
    if (isNaN(d) || d < 1  || d > 10) { Alert.alert('Invalid', 'Period duration must be 1–10 days.'); return; }
    setSaving(true);
    try { await onSave({ average_cycle_length: l, average_period_duration: d }); onClose(); }
    finally { setSaving(false); }
  };

  const field = (label: string, val: string, set: (v: string) => void, ph: string) => (
    <>
      <Text style={{ color: '#7c3aed', fontWeight: '600', marginBottom: 4 }}>{label}</Text>
      <TextInput value={val} onChangeText={set} keyboardType="numeric" placeholder={ph}
        style={{ backgroundColor: '#faf5ff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e9d5ff', marginBottom: 16, color: '#1e293b' }} />
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#581C87', marginBottom: 4, textAlign: 'center' }}>⚙️ Cycle Settings</Text>
          <Text style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', marginBottom: 20 }}>Shared with your partner — used for all predictions.</Text>
          {field('Average Cycle Length (days)', len, setLen, '28')}
          {field('Average Period Duration (days)', dur, setDur, '5')}
          <TouchableOpacity onPress={handleSave} disabled={saving}
            style={{ backgroundColor: saving ? '#c4b5fd' : '#7c3aed', borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 12 }}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Save Settings</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ color: '#94a3b8', fontWeight: '600' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CycleTrackerScreen() {
  const { user, myId, partnerId } = useAuth();
  const isFemale = user?.gender === 'Female';
  const { sendPushToPartner } = useNotifications();

  const [logs, setLogs] = useState<CycleLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingLog, setEditingLog]       = useState<CycleLog | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [cycleSettings, setCycleSettings]     = useState<CycleSettings>(DEFAULT_CYCLE_SETTINGS);

  // ── Check 5: memoised pairId avoids duplicate Supabase channels on rerender
  const pairId = useMemo(
    () => (partnerId ? [myId, partnerId].sort().join('_') : myId ?? 'default'),
    [myId, partnerId],
  );

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const unsub = subscribeToCycleLogs(
      pairId,
      (newLogs) => { setLogs(newLogs); setLoading(false); },
      (err) => {
        console.error('[CycleTracker] Failed to load cycle data:', err?.message);
        setLoadError(err?.message ?? 'Unknown error loading cycle data.');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [pairId]);

  // Real-time settings subscription (shared between both partners)
  useEffect(() => {
    const unsub = subscribeToCycleSettings(
      pairId,
      (s) => setCycleSettings(s),
      (err) => console.error('[CycleTracker] Settings error:', err.message),
    );
    return () => unsub();
  }, [pairId]);

  const avgLen           = cycleSettings.average_cycle_length;
  const prediction       = computePrediction(logs);
  const cycleDay         = getCurrentCycleDay(logs);
  const phaseInfo        = getCyclePhaseInfo(cycleDay, avgLen);
  const lastLog          = logs.length > 0 ? logs[logs.length - 1] : null;
  const simplePrediction = lastLog
    ? computeSimplePrediction(lastLog.period_start, avgLen, cycleSettings.average_period_duration)
    : null;

  // ── "Period Started Today" ──
  const handlePeriodToday = useCallback(() => {
    const openLog = logs.find(l => l.period_end === null);
    const today = todayUTCString();

    if (openLog) {
      Alert.alert(
        'Active period found',
        `You have an open period that started on ${openLog.period_start}. Would you like to close it (set end to yesterday) before starting today?`,
        [
          {
            text: 'Close & Start New',
            onPress: async () => {
              const yesterday = addDays(today, -1);
              await updateCycleLog(pairId, openLog.id, { period_end: yesterday });
              setEditingLog(null);
              setModalVisible(true);
            },
          },
          {
            text: 'Edit Open Log First',
            onPress: () => { setEditingLog(openLog); setModalVisible(true); },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      setEditingLog(null);
      setModalVisible(true);
    }
  }, [logs, pairId]);

  const handleSaveLog = async (data: Omit<CycleLog, 'id' | 'created_at'>) => {
    const { predictedDate } = await saveLogAndPredict(
      pairId,
      data,
      editingLog?.id ?? null,
    );

    // Notify partner about cycle update via remote push
    if (partnerId) {
      const isEdit = Boolean(editingLog);
      const pushTitle = isEdit ? '💜 Cycle Log Updated' : '🩸 Period Logged';
      const pushBody = isEdit
        ? `${user?.fullName || 'Your partner'} updated a cycle log.`
        : `${user?.fullName || 'Your partner'} logged a new period. Cycle tracker is updated.`;
      sendPushToPartner(partnerId, pushTitle, pushBody).catch(() => {/* silent */});
    }

    // Show success + prediction feedback to both partners
    const today = todayUTCString();
    const daysAway = predictedDate ? diffDays(today, predictedDate) : null;
    const predMsg = predictedDate
      ? `\n\n📅 Next period predicted: ${predictedDate}${
          daysAway !== null
            ? ` (${daysAway > 0 ? `in ${daysAway} days` : daysAway === 0 ? 'today' : `${Math.abs(daysAway)}d overdue`})`
            : ''
        }`
      : '';

    Alert.alert(
      editingLog ? '✅ Log Updated' : '✅ Log Saved',
      `Your cycle log has been ${editingLog ? 'updated' : 'saved'} successfully.${predMsg}`,
      [{ text: 'OK' }],
    );
  };

  const handleEdit = (log: CycleLog) => {
    setEditingLog(log);
    setModalVisible(true);
  };

  const handleDelete = useCallback((log: CycleLog) => {
    Alert.alert(
      'Delete Cycle Log',
      `Delete the log starting ${log.period_start}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteCycleLog(pairId, log.id),
        },
      ],
    );
  }, [pairId]);

  const handleSaveSettings = useCallback(async (s: Pick<CycleSettings, 'average_cycle_length' | 'average_period_duration'>) => {
    await saveCycleSettings(pairId, s);
  }, [pairId]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAF5FF' }}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAF5FF', padding: 32 }}>
        <Text style={{ fontSize: 32, marginBottom: 12 }}>⚠️</Text>
        <Text style={{ color: '#7c3aed', fontWeight: '700', fontSize: 16, textAlign: 'center', marginBottom: 8 }}>Unable to load cycle data</Text>
        <Text style={{ color: '#ef4444', textAlign: 'center', fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
          {loadError}
        </Text>
        <Text style={{ color: '#94a3b8', textAlign: 'center', fontSize: 11 }}>
          Check your connection and try again.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#FAF5FF' }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>

        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: '#581C87' }}>Cycle Tracker</Text>
          {isFemale && (
            <TouchableOpacity onPress={() => setSettingsVisible(true)}
              style={{ backgroundColor: '#f3e8ff', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 18 }}>⚙️</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={{ color: '#7c3aed', marginBottom: 24, opacity: 0.7 }}>
          {isFemale ? 'Track, log and understand your patterns.' : "Viewing your partner's cycle insights."}
        </Text>

        {/* Pie Chart */}
        <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 20, marginBottom: 20, shadowColor: '#7c3aed', shadowOpacity: 0.08, shadowRadius: 16, elevation: 3, alignItems: 'center' }}>
          <CyclePieChart
            segments={phaseInfo.segments}
            cycleDay={cycleDay}
            avgLength={avgLen}
            phase={phaseInfo.phase}
          />
          <View style={{ marginTop: 12, backgroundColor: '#faf5ff', borderRadius: 14, padding: 14, width: '100%' }}>
            <Text style={{ color: '#7c3aed', fontSize: 13, lineHeight: 20, textAlign: 'center' }}>
              💜 {phaseInfo.proTip}
            </Text>
          </View>
        </View>

        {/* Current Status — always visible (read-only for male, informational for female) */}
        <View style={{
          backgroundColor: '#fff',
          borderRadius: 20,
          padding: 18,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: '#e9d5ff',
          shadowColor: '#7c3aed',
          shadowOpacity: 0.06,
          shadowRadius: 10,
          elevation: 2,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontWeight: '800', color: '#581C87', fontSize: 15 }}>Current Status</Text>
            {!isFemale && (
              <View style={{ backgroundColor: '#ede9fe', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: '#7c3aed', fontSize: 10, fontWeight: '700' }}>READ ONLY</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, backgroundColor: '#faf5ff', borderRadius: 14, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Phase</Text>
              <Text style={{ color: '#581C87', fontWeight: '700', fontSize: 13, textAlign: 'center' }}>
                {phaseInfo.phase.replace('Estimated ', 'Est. ')}
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#faf5ff', borderRadius: 14, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Cycle Day</Text>
              <Text style={{ color: '#581C87', fontWeight: '700', fontSize: 20 }}>{cycleDay}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#faf5ff', borderRadius: 14, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Days Left</Text>
              <Text style={{ color: '#581C87', fontWeight: '700', fontSize: 20 }}>{phaseInfo.daysRemainingInPhase}</Text>
            </View>
          </View>
          {!isFemale && (
            <Text style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center', marginTop: 10, fontStyle: 'italic' }}>
              Your partner's cycle data — updated in real-time.
            </Text>
          )}
        </View>

        {/* Prediction Card */}
        {simplePrediction ? (
          <View style={{ backgroundColor: '#7c3aed', borderRadius: 24, padding: 20, marginBottom: 20, shadowColor: '#7c3aed', shadowOpacity: 0.3, shadowRadius: 16, elevation: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Next Period Prediction</Text>
              {prediction && !prediction.insufficient && <ConfidenceBadge label={prediction.confidenceLabel} />}
            </View>

            {/* Primary prediction: DB-stored value (set by engine) or simple fallback */}
            <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 14, marginBottom: 10 }}>
              <Text style={{ color: '#e9d5ff', fontSize: 12, marginBottom: 2 }}>Next period estimated on</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 22 }}>
                {cycleSettings.predicted_next_period ?? simplePrediction.nextPeriodDate}
              </Text>
              <Text style={{ color: '#ddd6fe', fontSize: 12, marginTop: 4 }}>
                Last period + {avgLen}d average cycle
              </Text>
              {cycleSettings.predicted_next_period && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#a3e635', marginRight: 5 }} />
                  <Text style={{ color: '#a3e635', fontSize: 11, fontWeight: '600' }}>ML-updated prediction</Text>
                </View>
              )}
            </View>

            {prediction && !prediction.insufficient && (
              <>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 14, marginBottom: 10 }}>
                  <Text style={{ color: '#e9d5ff', fontSize: 12, marginBottom: 2 }}>Estimated Fertile Window</Text>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{prediction.fertileWindowStart} → {prediction.fertileWindowEnd}</Text>
                  <Text style={{ color: '#ddd6fe', fontSize: 11, marginTop: 4 }}>Based on {prediction.basedOnCycles} cycles. Not a contraceptive tool.</Text>
                </View>
                {prediction.isIrregular && (
                  <View style={{ backgroundColor: 'rgba(251,191,36,0.2)', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)' }}>
                    <Text style={{ color: '#fef08a', fontSize: 12, lineHeight: 18 }}>⚠️ Cycle appears irregular (±{prediction.variance}d). Predictions are estimates only.</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 12 }}>
                    <Text style={{ color: '#e9d5ff', fontSize: 11, marginBottom: 2 }}>Avg cycle</Text>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{prediction.avgCycleLength}d</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 12 }}>
                    <Text style={{ color: '#e9d5ff', fontSize: 11, marginBottom: 2 }}>Variation</Text>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>±{prediction.variance}d</Text>
                  </View>
                </View>
              </>
            )}
          </View>
        ) : (
          <View style={{ backgroundColor: '#f3e8ff', borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#e9d5ff' }}>
            <Text style={{ color: '#7c3aed', fontWeight: '700', marginBottom: 6 }}>📊 Building your predictions</Text>
            <Text style={{ color: '#6d28d9', fontSize: 13, lineHeight: 20 }}>
              Log your first period to see a prediction. Tap ⚙️ to set your average cycle length.
            </Text>
          </View>
        )}

        {/* Male Partner Countdown — visible to partner (non-female) only */}
        {!isFemale && simplePrediction !== null && (
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#dbeafe', shadowColor: '#3B82F6', shadowOpacity: 0.1, shadowRadius: 16, elevation: 3 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ fontWeight: '800', color: '#1e3a8a', fontSize: 15 }}>Partner's Cycle Status</Text>
              <View style={{ backgroundColor: '#dbeafe', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: '#1d4ed8', fontSize: 10, fontWeight: '700' }}>READ ONLY</Text>
              </View>
            </View>
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>🩸 Next Period In</Text>
              <Text style={{ fontSize: 60, fontWeight: '900', lineHeight: 68,
                color: simplePrediction.daysUntilNextPeriod <= 3 ? '#ef4444' : '#1e3a8a' }}>
                {Math.max(0, simplePrediction.daysUntilNextPeriod)}
              </Text>
              <Text style={{ fontSize: 16, color: '#64748b', marginBottom: 16 }}>days</Text>
              <View style={{ backgroundColor: '#eff6ff', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 10 }}>
                <Text style={{ color: '#1d4ed8', fontWeight: '700', fontSize: 14, textAlign: 'center' }}>
                  Phase: {phaseInfo.phase.replace('Estimated ', 'Est. ')}
                </Text>
              </View>
            </View>
            {simplePrediction.daysUntilNextPeriod >= 0 && simplePrediction.daysUntilNextPeriod <= 3 && (
              <View style={{ backgroundColor: '#fee2e2', borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#fca5a5' }}>
                <Text style={{ color: '#991b1b', fontSize: 12, textAlign: 'center' }}>
                  💜 Period is coming soon — be extra supportive!
                </Text>
              </View>
            )}
            <Text style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center', marginTop: 12, fontStyle: 'italic' }}>
              Your partner's cycle data — updated in real-time.
            </Text>
          </View>
        )}

        {/* Period Started Today — Female only */}
        {isFemale && (
          <TouchableOpacity onPress={handlePeriodToday}
            style={{ backgroundColor: '#f43f5e', borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginBottom: 16, shadowColor: '#f43f5e', shadowOpacity: 0.3, shadowRadius: 10, elevation: 3 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>🩸 Period started today</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>Tap to log — keeps predictions accurate</Text>
          </TouchableOpacity>
        )}

        {/* Add log button — Female only */}
        {isFemale && (
          <TouchableOpacity onPress={() => { setEditingLog(null); setModalVisible(true); }}
            style={{ backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 24, borderWidth: 2, borderColor: '#c4b5fd' }}>
            <Text style={{ color: '#7c3aed', fontWeight: '700', fontSize: 15 }}>+ Add / Edit Cycle Log</Text>
          </TouchableOpacity>
        )}

        {/* Log history */}
        <Text style={{ fontWeight: '800', color: '#581C87', fontSize: 17, marginBottom: 12 }}>Cycle History</Text>
        {logs.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 32, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#f3e8ff' }}>
            <Text style={{ fontSize: 40, marginBottom: 10 }}>🌸</Text>
            <Text style={{ color: '#7c3aed', fontWeight: '700', fontSize: 15, marginBottom: 6 }}>No cycles logged yet</Text>
            <Text style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 }}>
              {isFemale ? 'Tap "Period started today" or "Add Cycle Log" to get started.' : 'Your partner\'s cycle history will appear here.'}
            </Text>
          </View>
        ) : (
          [...logs].reverse().map(log => (
            <LogCard key={log.id} log={log} onEdit={handleEdit} onDelete={handleDelete} isFemale={isFemale} />
          ))
        )}
      </View>

      {/* Log Modal — always mounted; visibility gated via `visible` prop so
           the component instance (and its form state) survives realtime
           re-renders of the parent. isFemale guard lives in `visible` only. */}
      <LogModal
        visible={isFemale && modalVisible}
        initial={editingLog}
        existingLogs={logs}
        pairId={pairId}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveLog}
      />

      {/* Settings Modal — always mounted for the same reason */}
      <SettingsModal
        visible={isFemale && settingsVisible}
        settings={cycleSettings}
        onClose={() => setSettingsVisible(false)}
        onSave={handleSaveSettings}
      />
    </ScrollView>
  );
}
