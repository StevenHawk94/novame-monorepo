import { AppState } from 'react-native';
import { apiClient } from './api';
import { storage } from './storage';
import { kAccountProfileEdits, kAccountProfile } from '../shared/storage/keys';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import type { AccountProfile } from './account-api';

type Fields = Pick<AccountProfile, 'display_name' | 'birthday' | 'gender'>;
type Field = keyof Fields;
type Edit = { value: Fields[Field]; previous: Fields[Field]; revision: number; pending: boolean };
type Journal = { owner: string; edits: Partial<Record<Field, Edit>>; error: string };
const listeners = new Set<() => void>();
let revision = 0, flight: object | null = null, timer: ReturnType<typeof setTimeout> | null = null, attempts = 0;
export const accountProfileRevision = () => revision;
function read(): Journal {
  const owner = sessionUserId() || '';
  try { const row = JSON.parse(storage.getString(kAccountProfileEdits.name) || 'null');
    if (row?.owner === owner && row.edits) { for (const edit of Object.values(row.edits) as Edit[]) revision = Math.max(revision, edit.revision); return row; }
  } catch { /* No account-owned journal yet. */ }
  return { owner, edits: {}, error: '' };
}
function emit() { listeners.forEach(fn => { try { fn(); } catch { /* Isolate observers. */ } }); }
function write(row: Journal) {
  storage.set(kAccountProfileEdits.name, JSON.stringify(row));
  try { const cached = cachedAccountProfile(); if (cached) storage.set(kAccountProfile.name, JSON.stringify(projectAccountProfile(cached, -1))); } catch { /* The journal remains durable. */ }
  emit();
}
export const subscribeAccountProfile = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const accountProfileSyncError = () => read().error;
/** A read started before an edit/receipt cannot overwrite that edit. */
export function projectAccountProfile<T extends { id: string; display_name: string | null }>(profile: T, started = Infinity): T {
  const row = read();
  if (profile.id !== row.owner) return profile;
  const patch: Record<string, unknown> = {};
  for (const [field, edit] of Object.entries(row.edits)) {
    if (edit && (edit.pending || edit.revision > started)) patch[field] = edit.value;
  }
  return Object.entries(patch).some(([field,value])=>!Object.is(profile[field as keyof T],value))
    ? { ...profile, ...patch } : profile;
}
export function cachedAccountProfile(): AccountProfile | null {
  try { const row = JSON.parse(storage.getString(kAccountProfile.name) || 'null');
    return row?.id === sessionUserId() ? projectAccountProfile(row) : null;
  } catch { return null; }
}
function schedule(delay = 0) {
  if (timer || flight || AppState.currentState !== 'active' || !Object.values(read().edits).some(e => e?.pending)) return;
  timer = setTimeout(() => { timer = null; void syncAccountProfile(); }, delay);
}
/** Accept only non-sensitive profile data, durably, before closing the editor. */
export function saveAccountProfile(fields: Partial<Fields>, base: AccountProfile) {
  const row = read();
  if (!row.owner || row.owner !== base.id) throw Error('session_changed');
  const edits = { ...row.edits };
  for (const field of Object.keys(fields) as Field[]) {
    if (!['display_name', 'birthday', 'gender'].includes(field)) throw Error('Unsupported profile field');
    const value = fields[field];
    if (value === undefined) continue;
    if (field === 'display_name' && (typeof value !== 'string' || !value.trim() || value.length > 15)) throw Error('Invalid name');
    if (field === 'birthday' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || Date.parse(value) > Date.now())) throw Error('Invalid date of birth');
    if (field === 'gender' && !['woman', 'man', 'non_binary', 'prefer_not_to_say'].includes(value || '')) throw Error('Invalid gender');
    edits[field] = { value, previous: edits[field] ? edits[field]!.previous : base[field], revision: ++revision, pending: true };
  }
  write({ ...row, edits, error: '' });
  try { storage.set(kAccountProfile.name, JSON.stringify(projectAccountProfile(base))); } catch { /* Durable journal is sufficient for retry. */ }
  schedule();
  return projectAccountProfile(base);
}
export async function syncAccountProfile() {
  const row = read(), keys = (Object.keys(row.edits) as Field[]).filter(k => row.edits[k]?.pending);
  if (!row.owner || !keys.length || flight || AppState.currentState !== 'active') return;
  const token = {}, epoch = sessionEpoch(), controller = new AbortController(); flight = token;
  const current = () => epoch === sessionEpoch() && row.owner === sessionUserId();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let delay = 0;
  try {
    const body: Record<string, unknown> = { userId: row.owner };
    for (const key of keys) body[key === 'display_name' ? 'displayName' : key] = row.edits[key]!.value;
    const response = await apiClient.post<{ success?: boolean }>('/api/update-profile', body, { signal: controller.signal });
    if (!response.success) throw Error('profile_sync_failed');
    if (!current()) return;
    const latest = read();
    for (const key of keys) {
      const sent = row.edits[key]!, next = latest.edits[key];
      if (!next) continue;
      // Preserve a newer local edit, but its rejection must restore this receipt.
      latest.edits[key] = next.revision === sent.revision
        ? { ...next, pending: false, previous: sent.value, revision: ++revision }
        : { ...next, previous: sent.value };
    }
    attempts = 0; latest.error = ''; write(latest);
  } catch (error) {
    if (!current()) return;
    const latest = read(), status = (error as { status?: number }).status;
    if (status === 400 || status === 422) {
      for (const key of keys) {
        const edit = latest.edits[key];
        if (edit && edit.revision === row.edits[key]?.revision) latest.edits[key] = { ...edit, value: edit.previous, pending: false, revision: ++revision };
      }
      latest.error = 'These details could not be saved. Please check them and try again.';
    } else {
      latest.error = 'Your changes are saved on this device. We will retry syncing automatically.';
      delay = Math.min(5000 * 2 ** Math.min(attempts++, 6), 300000);
    }
    try { write(latest); } catch { /* Original intent remains on disk. */ }
  } finally {
    clearTimeout(timeout);
    if (flight === token) { flight = null; schedule(delay); }
  }
}
subscribeSessionIdentity(() => { revision++; attempts = 0; if (timer) clearTimeout(timer); timer = null; flight = null; emit(); schedule(); });
AppState.addEventListener('change', next => { if (next === 'active') schedule(); else { if (timer) clearTimeout(timer); timer = null; } });
