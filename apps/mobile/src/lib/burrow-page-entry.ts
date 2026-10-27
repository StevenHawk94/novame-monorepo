import { router, type Href } from 'expo-router';
import type { MajorUpdateBootstrap } from './app-major-update-api';
import { getBurrowSnapshot, refreshBurrow } from './burrow-store';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { withDeadline } from './async-lifecycle';
import { cachedReleaseRoom, fetchReleaseRoom, releaseRoomScope } from './release-room-api';
import { gameHistory, gameOverview, gameSession } from './burrow-game-room-api';
import { cacheGameHistory, cacheGameOverview, cacheGameSession, getCachedGameHistory, getCachedGameOverview, getCachedGameSession } from './burrow-game-room-cache';
import { readLocalGame, reconcileLocalGame } from './burrow-game-local';
import { friendVisitReady, warmFriendVisit } from './friend-visit-local';
import { burrowPageArtReady, warmBurrowPageArt } from './burrow-page-art';
import { afterUiSettles } from './ui-idle';
import { uiWorkPriority } from './ui-work-priority';
import { beginInteractionTiming, markInteractionTiming } from './interaction-timing';
import { cachedCoupleJournal, preparedCoupleJournalVersion, prepareCoupleJournal } from './couple-journal';
import { prepareLoveNotes, loveNotesReady } from './use-love-notes';
import { notificationContentVersion } from './notification-content-version';
import { unreadBurrowUpdateIds } from './burrow-attention';
import {prefetchAdventureTeam} from './adventure-team-prefetch';

export type BurrowPageEntry = { kind?: 'page' | 'private' | 'game' | 'release' | 'shop' | 'surprise' | 'visit' | 'journal' | 'letter' | 'affection' | 'adventure'; sessionId?: string; history?: boolean; result?:boolean; intent?:string };
type Entry = { pending: boolean; error: boolean };
const idle: Entry = { pending: false, error: false };
let state = idle, generation = 0;
let retry: (() => void) | null = null;
let pendingIntent: string | null = null;
const listeners = new Set<() => void>();
export const getBurrowPageEntry = () => state;
export const subscribeBurrowPageEntry = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish(next: Entry) { state = next; listeners.forEach(fn => fn()); }
export function cancelBurrowPageEntry() { generation++; retry = null; pendingIntent = null; if (state !== idle) publish(idle); }
export function retryBurrowPageEntry() { if (state.error) retry?.(); }
subscribeSessionIdentity(cancelBurrowPageEntry);
let gameWarmup: { scope: string; epoch: number; promise: Promise<void> } | null = null;
let gamePreparedFor:{scope:string;epoch:number;catalog:MajorUpdateBootstrap['catalog'];hasPlus:boolean}|null=null;
export function warmBurrowGameOverview({force=false}:{force?:boolean}={}) {
  const data = currentData();
  if (!data) return Promise.resolve();
  const scope = releaseRoomScope(data), epoch = sessionEpoch();
  if (!force&&getCachedGameOverview(scope)?.games?.length&&gamePreparedFor?.scope===scope&&gamePreparedFor.epoch===epoch
    &&gamePreparedFor.catalog===data.catalog&&gamePreparedFor.hasPlus===data.hasPlus) return Promise.resolve();
  if (gameWarmup?.scope === scope && gameWarmup.epoch === epoch) return gameWarmup.promise;
  const read = { scope, epoch, promise: Promise.resolve() };
  read.promise = gameOverview().then(value => {
    const latest = currentData();
    if (epoch === sessionEpoch() && latest && releaseRoomScope(latest) === scope) {
      cacheGameOverview(value, Date.now(), scope);
      gamePreparedFor={scope,epoch,catalog:data.catalog,hasPlus:data.hasPlus};
    }
  }).finally(() => { if (gameWarmup === read) gameWarmup = null; });
  gameWarmup = read;
  return read.promise;
}

function currentData() {
  const data = getBurrowSnapshot().data;
  return data && data.profile.id === sessionUserId() && data.catalogComplete ? data : null;
}
export function burrowPageIsReady(entry: BurrowPageEntry = {}) {
  const data = currentData();
  if (!data) return false;
  const scope = releaseRoomScope(data);
  if(entry.kind==='private'&&data.partner&&!data.pairAccessVerified)return false;
  if((entry.kind==='journal'||entry.kind==='letter')&&data.partner&&!data.pairAccessVerified)return false;
  if(entry.kind==='journal'&&unreadBurrowUpdateIds(data,'journal').length&&(!cachedCoupleJournal(`${data.profile.id}:${data.pairVersion??'solo'}`)
    ||preparedCoupleJournalVersion(`${data.profile.id}:${data.pairVersion??'solo'}`)!==notificationContentVersion(data,'journal')))return false;
  if(entry.kind==='letter'&&unreadBurrowUpdateIds(data,'letters').length&&!loveNotesReady(data))return false;
  if(entry.kind==='visit'&&(!friendVisitReady(data,false)||(data.partner&&!data.pairAccessVerified)))return false;
  if (entry.kind === 'release') {
    const status = cachedReleaseRoom(scope, data.economicTimezone || data.profile.timezone_name || 'UTC', data.hasPlus);
    if (!status || (data.partner && status.monsters.some(m => m.partnerTamedCount === null))) return false;
  }
  if (entry.kind === 'game') {
    if(data.partner&&!data.pairAccessVerified)return false;
    if (!getCachedGameOverview(scope)?.games?.length) return false;
    if (entry.history && !getCachedGameHistory(scope)) return false;
    if (entry.sessionId && !readLocalGame(entry.sessionId, scope) && !getCachedGameSession(entry.sessionId, scope)) return false;
    if(entry.result&&entry.sessionId&&!getCachedGameSession(entry.sessionId,scope)?.result&&!readLocalGame(entry.sessionId,scope)?.session.result)return false;
  }
  // Decoding/display cache eviction is not loss of business authorization.
  // Retained native views may still own the decoded refs. Never put optional
  // image warming in front of an otherwise ready navigation.
  return true;
}

/** Only a missing business model/authorization can hold navigation. Optional
 * decoded-art cache work never blocks a cached, session-verified destination.
 * A cancelled request may warm caches, but can never navigate later. */
export function enterBurrowPage(entry: BurrowPageEntry, open: () => void) {
  uiWorkPriority.action(); beginInteractionTiming(entry.kind??'page');
  if(entry.kind==='adventure')void prefetchAdventureTeam();
  if (burrowPageIsReady(entry)) {
    // A ready destination must not inherit another read's spinner/error. Fence
    // that old navigation intent; its shared I/O may still finish warming data.
    cancelBurrowPageEntry();
    markInteractionTiming('dispatch'); open();
    const epoch=sessionEpoch(),data=currentData();
    if(data)afterUiSettles(()=>{
      if(epoch!==sessionEpoch()||currentData()?.profile.id!==data.profile.id)return;
      if(entry.kind==='visit')void warmFriendVisit(data).catch(()=>{});
      else if(entry.kind&&entry.kind!=='page'&&entry.kind!=='private'&&entry.kind!=='journal'&&entry.kind!=='letter'&&!burrowPageArtReady(entry.kind,data))void warmBurrowPageArt(entry.kind,data).catch(()=>{});
    });
    return;
  }
  const intent = JSON.stringify([entry.intent ?? entry.kind ?? 'page',entry.sessionId,!!entry.history,!!entry.result]);
  if ((state.pending || state.error) && pendingIntent === intent) return;
  cancelBurrowPageEntry();
  pendingIntent = intent;
  const epoch = sessionEpoch(), owner = sessionUserId();
  const initial = getBurrowSnapshot().data;
  const initialScope = initial ? releaseRoomScope(initial) : null;
  const valid = (token: number) => token === generation && epoch === sessionEpoch() && owner === sessionUserId();
  const attempt = () => {
    const token = ++generation;
    publish({ pending: true, error: false });
    const prepare = async () => {
      if (!currentData()||((entry.kind==='private'||entry.kind==='visit'||entry.kind==='game'||entry.kind==='journal'||entry.kind==='letter')&&currentData()?.partner&&!currentData()?.pairAccessVerified)) await refreshBurrow({ silent: true });
      if (!valid(token)) return;
      const data = currentData();
      if (!data) throw new Error('entry_unavailable');
      const scope = releaseRoomScope(data);
      // Only a missing conversation model can block a visit. Page-art warmup
      // normally finishes earlier; failure cannot revoke a valid model.
      if(entry.kind==='visit')await warmFriendVisit(data,false);
      const current=()=>valid(token)&&!!currentData()&&releaseRoomScope(currentData()!)===scope;
      if(entry.kind==='journal'&&!burrowPageIsReady(entry))await prepareCoupleJournal(data,current);
      if(entry.kind==='letter'&&!burrowPageIsReady(entry))await prepareLoveNotes(data,current);
      // Never replay an entry intended for the previous relationship.
      if (initialScope && initialScope !== scope) { cancelBurrowPageEntry(); return; }
      if (entry.kind === 'release' && !burrowPageIsReady(entry)) await fetchReleaseRoom(data);
      if (entry.kind === 'game') {
        await Promise.all([
          warmBurrowGameOverview(),
          !entry.history || getCachedGameHistory(scope) ? null : gameHistory().then(value => {
            if (valid(token)) cacheGameHistory(value, Date.now(), scope);
          }),
          !entry.sessionId || (!entry.result&&(readLocalGame(entry.sessionId, scope)||getCachedGameSession(entry.sessionId, scope))) || (entry.result&&(getCachedGameSession(entry.sessionId,scope)?.result||readLocalGame(entry.sessionId,scope)?.session.result))
            ? null : gameSession(entry.sessionId).then(value => {
              if (valid(token)) cacheGameSession(reconcileLocalGame(value,scope), Date.now(), scope);
            }),
        ]);
      }
      if (!valid(token)) return;
      const latest = currentData();
      if (!latest || releaseRoomScope(latest) !== scope) { cancelBurrowPageEntry(); return; }
      if (!burrowPageIsReady(entry)) throw new Error('entry_unavailable');
      retry = null; pendingIntent = null; publish(idle); markInteractionTiming('dispatch'); open();
    };
    // A UI wait is bounded independently of shared background reads.
    void withDeadline(prepare(), 15_000).catch(() => {
      if (valid(token)) {
        generation++; // late resolution cannot open a timed-out destination
        publish({ pending: false, error: true });
      }
    });
  };
  retry = attempt;
  attempt();
}

/** Shared stack entry for map, shop, partner-room, history and Home shortcuts. */
export function openPreparedBurrow(href: Href) {
  const path = typeof href === 'string' ? href.split('?')[0] : href.pathname;
  const params = typeof href === 'string' ? new URLSearchParams(href.split('?')[1]) : null;
  const sessionId = typeof href === 'string' ? params?.get('sessionId') ?? undefined
    : typeof href.params?.sessionId === 'string' ? href.params.sessionId : undefined;
  // Warm an unfinished round without making the destination skip its rules.
  const resumeSessionId = typeof href === 'string' ? params?.get('resumeSessionId') ?? undefined
    : typeof href.params?.resumeSessionId === 'string' ? href.params.resumeSessionId : undefined;
  const history = (typeof href === 'string' ? params?.get('history') : href.params?.history) === '1';
  const section=typeof href==='string'?params?.get('section'):href.params?.section;
  const result=(typeof href==='string'?params?.get('result'):href.params?.result)==='1';
  const interaction=typeof href==='string'?params?.get('kind'):href.params?.kind;
  const compose=(typeof href==='string'?params?.get('compose'):href.params?.compose)==='1';
  enterBurrowPage({ intent:JSON.stringify(href),kind: path === '/(main)/tame-enemy' ? 'release' : path === '/(main)/game-room' ? 'game'
    : path === '/(main)/surprise-room' ? 'surprise' : section==='friends_room'?'visit':section==='memories_room'?'journal'
    :section==='adventure'?'adventure':interaction==='letter'&&!compose?'letter':'page', sessionId:sessionId??resumeSessionId, history,result }, () => router.push(href));
}
