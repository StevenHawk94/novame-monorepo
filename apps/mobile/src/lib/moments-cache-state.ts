import type { MajorUpdateBootstrap } from './app-major-update-api';
import type { HistoryPage, HistoryCursor } from './burrow-history';
import { mergeHistory } from './burrow-history';
import { notificationContentVersion } from './notification-content-version';

export const momentsScope = (data: MajorUpdateBootstrap) => `${data.profile.id}:${data.partner?.id??'solo'}:${data.pairVersion??''}`;
type Snapshot = { page: HistoryPage | null; loading: boolean; refreshing: boolean; error: boolean };
const empty: Snapshot = { page: null, loading: false, refreshing: false, error: false };
/** A single authorized, in-memory timeline. No hidden-screen read receipts,
 * disk persistence of partner text, or navigation-triggered history reads. */
export function createMomentsCache(deps: {
  epoch(): number; valid(data: MajorUpdateBootstrap): boolean;
  fetch(partner: string | undefined, cursor: HistoryCursor): Promise<HistoryPage>;
  defer(): Promise<void>;
  now?(): number;
}) {
  let snapshot = empty, scope = '', epoch = -1, generation = 0;
  let desired: MajorUpdateBootstrap | null = null;
  let preparedRows: MajorUpdateBootstrap['moments'] | undefined, preparedTimezone: string | null | undefined;
  let attemptedRows: MajorUpdateBootstrap['moments'] | undefined;
  let readingRows: MajorUpdateBootstrap['moments'] | undefined, readingTimezone: string | null | undefined;
  let flight: Promise<void> | null = null, followup = false, followupManual = false;
  let retryAt=0,failures=0;
  let preparedVersion='',readingVersion='',attemptedVersion='';
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => { snapshot = next; listeners.forEach(fn => fn()); };
  const reset = () => {
    generation++; scope = ''; epoch = -1; desired = null; preparedRows = attemptedRows = undefined;
    preparedTimezone = undefined; flight = null; followup = false; followupManual = false; retryAt=0;failures=0;publish(empty);
    preparedVersion=readingVersion=attemptedVersion='';
  };
  const matches = (data: MajorUpdateBootstrap) => epoch === deps.epoch() && scope === momentsScope(data) && deps.valid(data);
  function request(data: MajorUpdateBootstrap, more = false, manual = false, force = false): Promise<void> {
    if (!deps.valid(data)) { reset(); return Promise.resolve(); }
    if (!matches(data)) { reset(); scope = momentsScope(data); epoch = deps.epoch(); }
    desired = data;
    const version=notificationContentVersion(data,'moments');
    if (flight) {
      if (!more && (manual || readingRows !== data.moments || readingTimezone !== data.profile.timezone_name || readingVersion!==version)) followup = true;
      if(manual){followupManual=true;publish({...snapshot,refreshing:true});}
      return flight;
    }
    if (!more && !manual && !force && ((snapshot.page && preparedRows === data.moments && preparedTimezone === data.profile.timezone_name&&preparedVersion===version)
      || (snapshot.error && attemptedRows === data.moments && readingTimezone===data.profile.timezone_name&&attemptedVersion===version
        && (deps.now?.()??Date.now())<retryAt))) return Promise.resolve();
    if (more && (!snapshot.page?.hasMore || !snapshot.page.next)) return Promise.resolve();
    const token = ++generation, cursor = more ? snapshot.page!.next : null, source = data.moments;
    attemptedRows = source;
    attemptedVersion=readingVersion=version;
    readingRows = source; readingTimezone = data.profile.timezone_name;
    publish({ ...snapshot, loading: true, refreshing: manual, error: false });
    const task: Promise<void> = Promise.resolve().then(async () => {
      try {
        const result = await deps.fetch(data.partner?.id, cursor);
        if (!manual) await deps.defer();
        if (token !== generation || !matches(data)) return;
        // A newer activity/version arrived while this read was running. Do
        // not commit an older head over it; the coalesced follow-up wins.
        if (desired?.moments !== source || desired.profile.timezone_name !== data.profile.timezone_name||notificationContentVersion(desired,'moments')!==version) { followup = true; return; }
        const rows = more ? mergeHistory(snapshot.page?.rows??[], result.rows) : result.rows;
        // Preserve identities of unchanged cards, including their decoded art.
        const old = new Map(snapshot.page?.rows.map(row => [row.id, row])??[]);
        const shared = rows.map(row => { const before = old.get(row.id); return before && JSON.stringify(before)===JSON.stringify(row) ? before : row; });
        preparedRows = source; preparedTimezone = data.profile.timezone_name;
        preparedVersion=version;
        retryAt=0;failures=0;
        publish({ page: { ...result, rows: shared }, loading: followup, refreshing: followupManual, error: false });
      } catch {
        if (token === generation && matches(data)) {
          retryAt=(deps.now?.()??Date.now())+Math.min(30_000,2000*2**Math.min(failures++,4));
          publish({ ...snapshot, loading: false, refreshing: false, error: true });
        }
      } finally {
        if (flight === task) {
          flight = null;
          if (followup && desired && deps.valid(desired)) {
            const manual=followupManual;followup = false;followupManual=false;await request(desired, false, manual, true);
          }
        }
      }
    });
    flight = task;
    return task;
  }
  return {
    read: (data: MajorUpdateBootstrap): Snapshot => matches(data) ? snapshot : empty,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    prepare: (data: MajorUpdateBootstrap) => request(data),
    refresh: (data: MajorUpdateBootstrap) => request(data, false, true),
    retry: (data: MajorUpdateBootstrap) => request(data, false, false, true),
    more: (data: MajorUpdateBootstrap) => request(data, true), reset,
  };
}
