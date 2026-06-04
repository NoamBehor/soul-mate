/**
 * board.tsx — Corkboard Memories Screen
 *
 * Jump-Proof Sync Architecture:
 *  1. Drag Isolation: refs/animated values only during drag; state+DB update ONLY on release.
 *  2. Absolute Coordinates: finalX = posRef.x + gesture.dx (never store raw dx/dy).
 *  3. Pending Mutation Tracking: pendingUpdatesRef[id] = { x, y, timestamp }.
 *  4. Echo Filtering: ignore realtime UPDATE if distance from pending < 2px.
 *  5. Threshold Reconciliation: ignore UPDATE if distance from current local < 5px.
 *  6. No Coordinate Randomization in realtime handlers.
 *  7. Subscription Safety: cleanup on PAIR_ID change.
 *  8. Stale-Closure Prevention: memoriesRef mirrors state for use inside async callbacks.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput,
  Dimensions,
  ActivityIndicator,
  Platform,
  StyleSheet,
  KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X } from 'lucide-react-native';
import Draggable from 'react-native-draggable';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/src/services/supabaseClient';
import { useAuth } from '@/src/context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type Memory = {
  id: string;
  image_url: string;
  storage_path: string | null;
  pair_id: string;
  x: number;
  y: number;
  tilt: string;
  caption: string;
};

type PendingUpdate = {
  x: number;
  y: number;
  timestamp: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPairId(idA: string, idB: string): string {
  return [idA, idB].sort().join('_');
}

const TILT_OPTIONS = [
  'rotate(1deg)', 'rotate(2deg)', 'rotate(3deg)',
  'rotate(-1deg)', 'rotate(-2deg)', 'rotate(-3deg)', 'rotate(0deg)',
];

function getRandomTilt(): string {
  return TILT_OPTIONS[Math.floor(Math.random() * TILT_OPTIONS.length)];
}

function getSpawnCoord(base: number): number {
  return base + (Math.random() * 60 - 30);
}

/** Euclidean distance between two points */
function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

// ─── DraggableImage ───────────────────────────────────────────────────────────

type DraggableImageProps = {
  memory: Memory;
  onDelete: (id: string) => void;
  /**
   * Called ONLY on drag release with final absolute board-relative coords.
   * Parent must NOT call setMemories in response — it must only update
   * memoriesRef and write to DB to avoid triggering a re-render that resets x/y.
   */
  onDragEnd: (id: string, x: number, y: number) => void;
};

const DraggableImage = memo(function DraggableImage({
  memory,
  onDelete,
  onDragEnd,
}: DraggableImageProps) {
  /**
   * posRef: committed absolute board position — seeded once from DB coords.
   * This ref is the single source of truth during drags.
   * We never re-derive from memory.x/y after mount to avoid stale-prop jumps.
   */
  const posRef = useRef({ x: memory.x, y: memory.y });

  /**
   * dragStartRef: snapshot of posRef taken at the first drag event.
   * Used so that gestureState.dx/dy are always relative to a stable origin.
   */
  const dragStartRef = useRef({ x: memory.x, y: memory.y });

  /**
   * isDraggingRef: true while a drag gesture is in progress.
   * Guards against partner-move re-renders overwriting an active drag.
   */
  const isDraggingRef = useRef(false);

  /**
   * When the parent receives a partner UPDATE and passes new memory.x/y,
   * we update posRef so the next drag starts from the correct location.
   * We do NOT update during an active drag.
   */
  useEffect(() => {
    if (!isDraggingRef.current) {
      posRef.current = { x: memory.x, y: memory.y };
    }
  }, [memory.x, memory.y]);

  const rotationDeg = useMemo(() => {
    const match = memory.tilt.match(/-?[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }, [memory.tilt]);

  /** First call in a gesture — snapshot stable start position */
  const handleDrag = useCallback((_e: any, _gestureState: any) => {
    if (!isDraggingRef.current) {
      isDraggingRef.current = true;
      dragStartRef.current = { x: posRef.current.x, y: posRef.current.y };
    }
  }, []);

  const handleDragRelease = useCallback(
    (_e: any, gestureState: any) => {
      // Absolute coords — Rule 2
      const newX = dragStartRef.current.x + gestureState.dx;
      const newY = dragStartRef.current.y + gestureState.dy;
      posRef.current = { x: newX, y: newY };
      isDraggingRef.current = false;
      onDragEnd(memory.id, newX, newY);
    },
    [memory.id, onDragEnd]
  );

  return (
    <Draggable
      x={memory.x}
      y={memory.y}
      minX={0}
      minY={0}
      shouldReverse={false}
      onDrag={handleDrag}
      onShortPressRelease={() => {}}
      onRelease={() => {}}
      onPressIn={() => {}}
      onPressOut={() => {}}
      onDragRelease={handleDragRelease}
    >
      <View style={[styles.card, { transform: [{ rotate: `${rotationDeg}deg` }] }]}>
        <View style={styles.pinWrapper}>
          <Ionicons name="pin" size={28} color="#ef4444" style={{ transform: [{ rotate: '15deg' }] }} />
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => onDelete(memory.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={14} color="#ef4444" />
        </TouchableOpacity>
        <Image
          source={{ uri: memory.image_url }}
          style={styles.photo}
          onError={(e) => {
            if (Platform.OS === 'web') {
              try { (e as any).currentTarget.style.display = 'none'; } catch (_) {}
            }
          }}
        />
        {!!memory.caption && (
          <Text style={styles.caption} numberOfLines={1}>{memory.caption}</Text>
        )}
      </View>
    </Draggable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BoardScreen() {
  const { user, isLoading: authLoading } = useAuth();

  const [PAIR_ID, setPAIR_ID] = useState<string | null>(null);
  const prevPairIdRef = useRef<string | null>(null);

  const [memories, setMemories] = useState<Memory[]>([]);

  /**
   * memoriesRef: always mirrors the `memories` state.
   * Used inside realtime callbacks and async handlers to prevent stale closures
   * from reading outdated coordinates and overwriting newer drag positions.
   */
  const memoriesRef = useRef<Memory[]>([]);
  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  /**
   * pendingUpdatesRef: tracks our own in-flight DB updates.
   * Structure: { [id]: { x, y, timestamp } }
   *
   * Set BEFORE the DB call in handleDragEnd.
   * Cleared in the realtime handler after the echo is detected and ignored.
   * Allows accurate echo detection even if timestamps differ slightly.
   */
  const pendingUpdatesRef = useRef<Record<string, PendingUpdate>>({});

  const [selectedImage, setSelectedImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [captionText, setCaptionText] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { width: windowWidth } = Dimensions.get('window');
  const boardCenterX = useMemo(() => windowWidth / 2 - 65, [windowWidth]);

  // ─── Compute PAIR_ID ──────────────────────────────────────────────────────

  useEffect(() => {
    if (authLoading) return;
    const myId = user?.id ?? null;
    const partnerId = user?.pairId ?? null;
    if (!myId || !partnerId) {
      setPAIR_ID(null);
      return;
    }
    setPAIR_ID(buildPairId(myId, partnerId));
  }, [authLoading, user?.id, user?.pairId]);

  // ─── Fetch + Realtime Subscription ───────────────────────────────────────

  useEffect(() => {
    if (authLoading) return;

    if (!PAIR_ID) {
      setIsFetching(false);
      if (prevPairIdRef.current !== null) {
        setMemories([]);
        memoriesRef.current = [];
        prevPairIdRef.current = null;
      }
      return;
    }

    if (prevPairIdRef.current !== PAIR_ID) {
      if (prevPairIdRef.current !== null) {
        setMemories([]);
        memoriesRef.current = [];
      }
      prevPairIdRef.current = PAIR_ID;
    }

    // ── Fetch ────────────────────────────────────────────────────────────
    const fetchMemories = async () => {
      setIsFetching(true);
      const { data, error } = await supabase
        .from('memories')
        .select('id, image_url, storage_path, pair_id, x, y, tilt, caption')
        .eq('pair_id', PAIR_ID)
        .order('created_at', { ascending: false });

      if (!error) {
        const rows = (data ?? []) as Memory[];
        setMemories((prev) => {
          const merged = [
            ...prev.filter((m) => !rows.some((r) => r.id === m.id)),
            ...rows,
          ];
          memoriesRef.current = merged;
          return merged;
        });
      } else {
        console.error('[Board] fetchMemories error:', error.message);
      }
      setIsFetching(false);
    };

    fetchMemories();

    // ── Realtime Subscription ─────────────────────────────────────────
    const channelName = `memories_board_${PAIR_ID}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memories', filter: `pair_id=eq.${PAIR_ID}` },
        (payload) => {
          const newRow = payload.new as Memory | undefined;
          const oldRow = payload.old as { id?: string } | undefined;

          // ── INSERT ─────────────────────────────────────────────────
          if (payload.eventType === 'INSERT' && newRow) {
            if (newRow.pair_id !== PAIR_ID) return;
            // Rule 6: use DB coords exactly — never call getSpawnCoord() here
            setMemories((prev) => {
              if (prev.some((m) => m.id === newRow.id)) return prev;
              const next = [newRow, ...prev];
              memoriesRef.current = next;
              return next;
            });
            return;
          }

          // ── UPDATE ─────────────────────────────────────────────────
          if (payload.eventType === 'UPDATE' && newRow) {
            if (newRow.pair_id !== PAIR_ID) return;

            const pending = pendingUpdatesRef.current[newRow.id];

            // Rule 4: Echo filtering — ignore if within 2px of our own pending write
            if (pending) {
              const echoDistance = dist(pending.x, pending.y, newRow.x, newRow.y);
              if (echoDistance < 2) {
                console.log('[Board] Echo ignored (distance', echoDistance.toFixed(2), 'px) for id:', newRow.id);
                delete pendingUpdatesRef.current[newRow.id];
                return;
              }
              // Not our echo — clear pending and apply partner move
              delete pendingUpdatesRef.current[newRow.id];
            }

            // Rule 5: Threshold reconciliation — ignore micro-jitter < 5px from current local state
            const current = memoriesRef.current.find((m) => m.id === newRow.id);
            if (current) {
              const localDistance = dist(current.x, current.y, newRow.x, newRow.y);
              if (localDistance < 5) {
                console.log('[Board] Update suppressed (distance', localDistance.toFixed(2), 'px) for id:', newRow.id);
                return;
              }
            }

            // Apply partner move — safe merge-by-id (Rule 8)
            console.log('[Board] Partner UPDATE applied for id:', newRow.id, 'at', newRow.x, newRow.y);
            setMemories((prev) => {
              const next = prev.map((m) => (m.id === newRow.id ? { ...m, x: newRow.x, y: newRow.y } : m));
              memoriesRef.current = next;
              return next;
            });
            return;
          }

          // ── DELETE ─────────────────────────────────────────────────
          if (payload.eventType === 'DELETE' && oldRow?.id) {
            setMemories((prev) => {
              const next = prev.filter((m) => m.id !== oldRow.id);
              memoriesRef.current = next;
              return next;
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('[Board] Channel', channelName, 'status:', status);
      });

    // Rule 7: Subscription Safety — clean up when PAIR_ID changes or unmounts
    return () => {
      console.log('[Board] Removing channel:', channelName);
      supabase.removeChannel(channel);
    };
  }, [PAIR_ID, authLoading]);

  // ─── Image Picker ─────────────────────────────────────────────────────────

  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0]);
      setUploadError(null);
    }
  }, []);

  // ─── Upload Pipeline ──────────────────────────────────────────────────────

  const handleAddPhoto = useCallback(async () => {
    if (!selectedImage || isUploading) return;
    if (!PAIR_ID) {
      setUploadError('You need a pair ID to pin memories.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      let blob: Blob;
      if (Platform.OS === 'web') {
        const response = await fetch(selectedImage.uri);
        if (!response.ok) throw new Error(`fetch() failed: ${response.status}`);
        blob = await response.blob();
      } else {
        blob = await new Promise<Blob>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = () => resolve(xhr.response as Blob);
          xhr.onerror = () => reject(new TypeError('XHR network request failed'));
          xhr.responseType = 'blob';
          xhr.open('GET', selectedImage.uri, true);
          xhr.send(null);
        });
      }

      const fileName = `${PAIR_ID}/${Date.now()}.jpg`;
      const { error: storageError } = await supabase.storage
        .from('memories')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });

      if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

      const { data: urlData } = supabase.storage.from('memories').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;
      if (!publicUrl || publicUrl.includes('undefined')) throw new Error(`Invalid public URL: "${publicUrl}"`);

      const insertPayload = {
        pair_id: PAIR_ID,
        image_url: publicUrl,
        storage_path: fileName,
        caption: captionText.trim().slice(0, 20),
        tilt: getRandomTilt(),
        x: getSpawnCoord(boardCenterX),
        y: getSpawnCoord(100),
      };

      const { data: insertedRows, error: dbError } = await supabase
        .from('memories')
        .insert([insertPayload])
        .select('id, image_url, storage_path, pair_id, x, y, tilt, caption');

      if (dbError) throw new Error(`DB insert failed: ${dbError.message}`);

      if (insertedRows?.[0]) {
        setMemories((prev) => {
          const newRow = insertedRows[0] as Memory;
          if (prev.some((m) => m.id === newRow.id)) return prev;
          const next = [newRow, ...prev];
          memoriesRef.current = next;
          return next;
        });
      }

      setSelectedImage(null);
      setCaptionText('');
    } catch (err: any) {
      const msg = err?.message ?? 'An unknown error occurred.';
      console.error('[Board] Upload failed:', msg);
      setUploadError(msg);
    } finally {
      setIsUploading(false);
    }
  }, [selectedImage, isUploading, captionText, PAIR_ID, boardCenterX]);

  // ─── Delete ───────────────────────────────────────────────────────────────

  const handleDelete = useCallback((id: string) => {
    (async () => {
      // 1. Look up storage_path from local mirror (avoids extra DB fetch)
      const memory = memoriesRef.current.find((m) => m.id === id);
      const storagePath = memory?.storage_path ?? null;

      // 2. Remove file from Supabase Storage (non-blocking — log error but continue)
      if (storagePath) {
        const { error: storageError } = await supabase.storage
          .from('memories')
          .remove([storagePath]);
        if (storageError) {
          console.error('[Board] Storage delete error:', storageError.message);
        } else {
          console.log('[Board] Storage file deleted:', storagePath);
        }
      } else {
        console.warn('[Board] No storage_path found for id:', id, '— skipping storage delete');
      }

      // 3. Delete DB row
      const { error } = await supabase.from('memories').delete().eq('id', id);
      if (error) console.error('[Board] DB delete error:', error.message);
    })();
  }, []);

  // ─── Drag End ─────────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(async (id: string, x: number, y: number) => {
    /**
     * Rule 1: Drag Isolation — update memoriesRef ONLY (no setMemories).
     * This prevents DraggableImage from receiving new x/y props, which would
     * cause the Draggable component to jump/teleport to the "new" position.
     *
     * Rule 3: Record pending update BEFORE DB call so the echo filter can
     * detect and ignore the Supabase realtime echo that fires afterward.
     */
    memoriesRef.current = memoriesRef.current.map((m) =>
      m.id === id ? { ...m, x, y } : m
    );

    // Rule 3: Track pending mutation with timestamp
    pendingUpdatesRef.current[id] = { x, y, timestamp: Date.now() };

    const { error } = await supabase
      .from('memories')
      .update({ x, y })
      .eq('id', id);

    if (error) {
      console.error('[Board] Position update error:', error.message);
      // On error, clear pending so future partner updates still apply
      delete pendingUpdatesRef.current[id];
    }
  }, []);

  // ─── Auth Guard ───────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <View style={styles.fullCentered}>
        <ActivityIndicator size="large" color="#d97706" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.screen}>
      <View style={styles.container}>

        <View style={styles.header}>
          <Text style={styles.title}>Memories</Text>
          <Text style={styles.subtitle}>Pin your favorite moments together.</Text>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.uploadPanel}>
          {selectedImage ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
              <TextInput
                value={captionText}
                onChangeText={setCaptionText}
                placeholder="Add a caption (max 20 chars)"
                placeholderTextColor="#a16207"
                maxLength={20}
                style={styles.captionInput}
              />
              {!!uploadError && <Text style={styles.errorText}>{uploadError}</Text>}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => { setSelectedImage(null); setCaptionText(''); setUploadError(null); }}
                  disabled={isUploading}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pinButton, isUploading && styles.pinButtonDisabled]}
                  onPress={handleAddPhoto}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <View style={styles.pinButtonInner}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.pinButtonText}>  Pinning…</Text>
                    </View>
                  ) : (
                    <Text style={styles.pinButtonText}>📌 Pin It!</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.pickButton} onPress={pickImage}>
              <Plus size={32} color="#d97706" />
              <Text style={styles.pickButtonText}>Pick an Image</Text>
            </TouchableOpacity>
          )}
        </View>
        </KeyboardAvoidingView>

        <View style={styles.board}>
          {isFetching ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#d97706" />
              <Text style={styles.loadingText}>Loading memories…</Text>
            </View>
          ) : !PAIR_ID ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No pair ID found.</Text>
              <Text style={styles.emptySubText}>Pair with your partner to share memories.</Text>
            </View>
          ) : memories.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No memories pinned yet.</Text>
              <Text style={styles.emptySubText}>Pick an image above to add your first memory!</Text>
            </View>
          ) : (
            memories.map((memory) => (
              <DraggableImage
                key={memory.id}
                memory={memory}
                onDelete={handleDelete}
                onDragEnd={handleDragEnd}
              />
            ))
          )}
        </View>

      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5E6CA' },
  container: { paddingHorizontal: 24, paddingVertical: 32 },
  fullCentered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5E6CA' },
  header: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: '#431407', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#92400e', opacity: 0.8 },
  uploadPanel: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  previewContainer: { alignItems: 'center' },
  previewImage: { width: 120, height: 120, borderRadius: 10, marginBottom: 12 },
  captionInput: {
    backgroundColor: '#fffbeb',
    width: '100%',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fde68a',
    color: '#451a03',
    fontSize: 14,
    marginBottom: 12,
  },
  errorText: { color: '#dc2626', fontSize: 12, marginBottom: 10, textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: 8 },
  cancelButton: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#e2e8f0', borderRadius: 10 },
  cancelButtonText: { color: '#475569', fontWeight: '600', fontSize: 14 },
  pinButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#d97706',
    borderRadius: 10,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinButtonDisabled: { backgroundColor: '#b45309' },
  pinButtonInner: { flexDirection: 'row', alignItems: 'center' },
  pinButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pickButton: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#fcd34d',
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickButtonText: { color: '#b45309', fontWeight: '600', marginTop: 8, fontSize: 15 },
  board: {
    width: '100%',
    height: 600,
    backgroundColor: '#c4a47c',
    borderWidth: 14,
    borderColor: '#3e2723',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    position: 'relative',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  loadingText: { color: '#92400e', marginTop: 8, fontSize: 13 },
  emptyText: { color: '#92400e', fontStyle: 'italic', fontWeight: '600', textAlign: 'center', fontSize: 15 },
  emptySubText: { color: '#78350f', fontSize: 12, textAlign: 'center', marginTop: 6, opacity: 0.7 },
  card: {
    width: 130,
    backgroundColor: '#fff',
    padding: 8,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: '#d1d5db',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  pinWrapper: { position: 'absolute', top: -12, left: '50%', marginLeft: -14, zIndex: 30 },
  deleteButton: {
    position: 'absolute',
    top: -14,
    right: -14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 99,
    padding: 4,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  photo: { width: '100%', height: 110, backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', borderWidth: 1 },
  caption: { textAlign: 'center', marginTop: 10, fontSize: 11, fontWeight: '500', color: '#1e293b' },
});
