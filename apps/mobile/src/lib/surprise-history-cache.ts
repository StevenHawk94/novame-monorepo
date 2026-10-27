import { storage } from './storage';
import { kSurpriseHistory } from '../shared/storage/keys';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import type { Surprise, SurpriseHistoryPage } from './surprise-api';

export type SurpriseDirection = 'received' | 'sent';
export type CachedSurprisePage = SurpriseHistoryPage & { loaded: boolean };
type Cache = { received: CachedSurprisePage; sent: CachedSurprisePage };
const empty = (): CachedSurprisePage => ({ items: [], nextCursor: null, loaded: false });
let currentScope = '', cache: Cache = { received: empty(), sent: empty() }, revision = 0;
const changed = new Map<string, number>();
subscribeSessionIdentity(() => { currentScope = ''; cache = { received: empty(), sent: empty() }; changed.clear(); revision++; });
const owns = (scope: string) => !!scope && scope.split(':')[0] === sessionUserId();
function metadata(item: Surprise): Surprise {
  // Never persist signed media URLs, files or recordings in this metadata cache.
  return { id: item.id, sender_id: item.sender_id, recipient_id: item.recipient_id, frame: item.frame,
    duration_ms: item.duration_ms, sent_at: item.sent_at, opened_at: item.opened_at };
}
function merge(items: Surprise[]) {
  return Array.from(new Map(items.map(item => [item.id, metadata(item)])).values())
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at) || b.id.localeCompare(a.id));
}
function activate(scope: string) {
  if (!owns(scope)) return false;
  if (scope === currentScope) return true;
  currentScope = scope; cache = { received: empty(), sent: empty() }; changed.clear(); revision++;
  try {
    const saved = JSON.parse(storage.getString(kSurpriseHistory.keyFor(scope)) ?? 'null');
    if (saved?.scope === scope && saved.savedAt <= Date.now() + 60_000) {
      const [userId, partnerId] = scope.split(':');
      for (const direction of ['received', 'sent'] as const) {
        const page = saved.pages?.[direction];
        if (Array.isArray(page?.items)) cache[direction] = {
          items: merge(page.items.filter((item: Surprise) => direction === 'received'
            ? item.recipient_id === userId && item.sender_id === partnerId
            : item.sender_id === userId && item.recipient_id === partnerId)).slice(0, 100),
          nextCursor: page.nextCursor ?? null, loaded: page.loaded === true,
        };
      }
    }
  } catch { /* A damaged cache must never block history. */ }
  return true;
}
function persist(scope: string) {
  try { storage.set(kSurpriseHistory.keyFor(scope), JSON.stringify({ scope, savedAt: Date.now(), pages: cache })); }
  catch { /* In-memory history remains usable when disk is unavailable. */ }
}
export function cachedSurpriseHistory(scope: string, direction: SurpriseDirection): CachedSurprisePage {
  return activate(scope) ? cache[direction] : empty();
}
export const surpriseHistoryRevision = () => revision;
export function saveSurpriseHistoryPage(scope: string, direction: SurpriseDirection, page: SurpriseHistoryPage,
  more = false, startedRevision = revision): CachedSurprisePage {
  if (!activate(scope)) return empty();
  const previous = cache[direction];
  // A send/open/inbox update that finished during this request wins over its stale snapshot.
  const newer = previous.items.filter(item => (changed.get(item.id) ?? -1) > startedRevision);
  const result = { items: merge([...(more ? previous.items : []), ...page.items, ...newer]),
    nextCursor: page.nextCursor, loaded: true };
  cache[direction] = { ...result, items: result.items.slice(0, 100) };
  persist(scope);
  return result;
}
export function rememberSurprises(scope: string, items: Surprise[]) {
  if (!activate(scope)) return;
  const [userId, partnerId] = scope.split(':');
  for (const item of items) {
    const direction = item.sender_id === userId && item.recipient_id === partnerId ? 'sent'
      : item.recipient_id === userId && item.sender_id === partnerId ? 'received' : null;
    if (!direction) continue;
    const previous = cache[direction];
    const old = previous.items.find(row => row.id === item.id);
    cache[direction] = { ...previous, items: merge([...previous.items.filter(row => row.id !== item.id),
      { ...item, opened_at: item.opened_at ?? old?.opened_at ?? null }]).slice(0, 100) };
    changed.set(item.id, ++revision);
  }
  persist(scope);
}
export function rememberSurpriseOpened(scope: string, id: string) {
  if (!activate(scope)) return;
  const item = cache.received.items.find(row => row.id === id);
  if (item) rememberSurprises(scope, [{ ...item, opened_at: new Date().toISOString() }]);
}
