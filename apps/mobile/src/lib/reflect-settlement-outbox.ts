import { apiClient } from './api';
import { supabase } from './supabase';
import { storage } from './storage';
import { kReflectSettlement } from '../shared/storage/keys';
import type { PreparedReflect, ReflectMemoryDraft } from './reflect-api';

export interface SettlementCheckpoint {
  userId: string;
  draftId: string;
  revision: number;
  memories: ReflectMemoryDraft[];
}
const activeDrafts = new Set<string>();
let preparing = 0;
export function beginReflectPreparation() { preparing++; }
export function endReflectPreparation() { preparing = Math.max(0, preparing - 1); }
export function holdReflectSettlement(id: string) { activeDrafts.add(id); }
export function releaseReflectSettlement(id: string) { activeDrafts.delete(id); }
export function hasActiveReflectSettlement() { return preparing > 0 || activeDrafts.size > 0; }
function key(userId: string, draftId: string) { return kReflectSettlement.prefix + userId + ':' + draftId; }
export function readSettlementCheckpoint(userId: string, draftId: string): SettlementCheckpoint | null {
  try {
    const raw = storage.getString(key(userId, draftId));
    const value = raw ? JSON.parse(raw) as SettlementCheckpoint : null;
    return value?.userId === userId && value.draftId === draftId ? value : null;
  } catch { return null; }
}
export function writeSettlementCheckpoint(draft: PreparedReflect, memories: ReflectMemoryDraft[]) {
  if (!draft.userId || !draft.reflectId) return null; // backwards-compatible old API
  const previous = readSettlementCheckpoint(draft.userId, draft.draftId);
  const value: SettlementCheckpoint = {
    userId: draft.userId, draftId: draft.draftId,
    revision: Math.max(previous?.revision ?? 0, draft.revision ?? 0, Date.now()) + 1,
    memories,
  };
  // Synchronous MMKV write happens in the input handler, BEFORE scheduling I/O.
  storage.set(key(value.userId, value.draftId), JSON.stringify(value));
  return value;
}
export function clearSettlementCheckpoint(userId: string, draftId: string, revision: number) {
  const current = readSettlementCheckpoint(userId, draftId);
  if (current && current.revision <= revision) storage.remove(key(userId, draftId));
}
export async function flushSettlementCheckpoint(value: SettlementCheckpoint): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id !== value.userId) return false;
    const result = await apiClient.post<{ success?: boolean }>('/api/reflect/checkpoint', value);
    return result.success === true;
  } catch { return false; }
}

// Called once on launch/resume, with backoff ONLY while recovery actually fails.
// Never analyzes/generates copy and never touches another UUID's pending edits.
export async function recoverReflectSettlements(onRecovered: () => void = () => {}): Promise<boolean> {
  if (hasActiveReflectSettlement()) return true;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return true;
    const result = await apiClient.get<{ success: boolean; pending: Array<{ id: string }> }>('/api/reflect/checkpoint');
    if (!result.success) return false;
    const pendingIds = new Set(result.pending.map((d) => d.id));
    // Include unacknowledged Done requests: the server may have committed before
    // the response was lost, so those rows no longer appear in pending.
    for (const storedKey of storage.getAllKeys()) {
      if (!storedKey.startsWith(kReflectSettlement.prefix + userId + ':')) continue;
      pendingIds.add(storedKey.slice((kReflectSettlement.prefix + userId + ':').length));
    }
    for (const draftId of pendingIds) {
      if (hasActiveReflectSettlement()) return true;
      const session = await supabase.auth.getSession();
      if (session.data.session?.user.id !== userId) return true;
      const local = readSettlementCheckpoint(userId, draftId);
      const saved = await apiClient.post<{ success?: boolean }>('/api/reflect/finalize', {
        userId, draftId, useSaved: !local, revision: local?.revision,
        memories: local?.memories,
        visibility: local?.memories.map(({ itemId, visible }) => ({ itemId, visible })),
      });
      if (!saved.success) return false;
      if (local) clearSettlementCheckpoint(userId, draftId, local.revision);
    }
    if (pendingIds.size > 0) {
      const current = await supabase.auth.getSession();
      if (current.data.session?.user.id === userId) onRecovered();
    }
    return true;
  } catch { return false; }
}
