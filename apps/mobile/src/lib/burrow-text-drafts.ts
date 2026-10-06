import { storage } from './storage';
import { kBurrowTextDrafts } from '../shared/storage/keys';
import { sessionUserId } from './session-lifecycle';
import { randomUUID } from 'expo-crypto';

export type BurrowTextDraft = { body: string; key: string; expectedUpdatedAt: string | null; savedAt: number };
const storageKey = (scope: string) => `${kBurrowTextDrafts.prefix}${scope}`;
const owns = (scope: string) => !!sessionUserId() && scope.split(':')[0] === sessionUserId();
function read(scope: string): Record<string, BurrowTextDraft> {
  try {
    if (!owns(scope)) return {};
    const value = JSON.parse(storage.getString(storageKey(scope)) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, BurrowTextDraft] => {
      const draft = entry[1] as Partial<BurrowTextDraft> | null;
      return !!draft && typeof draft.body === 'string' && typeof draft.key === 'string'
        && typeof draft.savedAt === 'number' && Number.isFinite(draft.savedAt)
        && (draft.expectedUpdatedAt === null || typeof draft.expectedUpdatedAt === 'string');
    }));
  } catch { return {}; }
}
export function readBurrowTextDraft(scope: string, target: string) {
  const draft = read(scope)[target];
  return draft && typeof draft.body === 'string' && typeof draft.key === 'string' ? draft : null;
}
/** Keep the same receipt key until the text changes or the save is confirmed. */
export function keepBurrowTextDraft(scope: string, target: string, body: string, expectedUpdatedAt: string | null = null) {
  const drafts = read(scope), previous = drafts[target];
  const next: BurrowTextDraft = previous?.body === body ? previous : { body, expectedUpdatedAt, key: randomUUID(), savedAt: Date.now() };
  if (!owns(scope)) throw Error('session_changed');
  drafts[target] = next;
  const retained = Object.entries(drafts).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 100);
  storage.set(storageKey(scope), JSON.stringify(Object.fromEntries(retained)));
  return next;
}
export function removeBurrowTextDraft(scope: string, target: string, key: string) {
  const drafts = read(scope);
  if (!owns(scope) || drafts[target]?.key !== key) return;
  delete drafts[target]; storage.set(storageKey(scope), JSON.stringify(drafts));
}
/** A confirmed conflict cannot be retried with the obsolete version. Keep
 * the user's words but create a fresh request for their explicit next Save. */
export function rebaseBurrowTextDraft(scope: string, target: string, key: string, expectedUpdatedAt: string | null) {
  const drafts = read(scope), previous = drafts[target];
  if (!owns(scope) || previous?.key !== key) throw Error('draft_changed');
  drafts[target] = { ...previous, expectedUpdatedAt, key: randomUUID(), savedAt: Date.now() };
  storage.set(storageKey(scope), JSON.stringify(drafts));
}
