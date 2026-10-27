import type { GameCompletion, GameOverview, GameSession, GameSessionSummary, GameHistoryPage } from './burrow-game-room-api';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { storage } from './storage';
import { kGameHistory, kGameProgress, kGameOverview } from '../shared/storage/keys';
import { gameReads } from './game-read-coordinator';
import { afterUiSettles } from './ui-idle';

// Display caches may lag disk; the answer outbox remains independently
// synchronous/durable. Coalesce repeated background cache serializations.
const displayWrites=new Map<string,()=>void>();
let cancelDisplayWrite:(()=>void)|undefined;
function persistDisplay(key:string,scope:string,record:unknown){
  displayWrites.set(key,()=>{if(scope.split(':')[0]===sessionUserId())try{storage.set(key,JSON.stringify(record));}catch{}});
  if(cancelDisplayWrite)return;
  cancelDisplayWrite=afterUiSettles(()=>{cancelDisplayWrite=undefined;const batch=[...displayWrites.values()];displayWrites.clear();batch.forEach(write=>write());});
}

// Catalogue art/questions barely change; active rounds can change on the
// partner's phone, so they get a shorter background revalidation window.
const OVERVIEW_IDLE_TTL_MS = 2 * 60_000;
const OVERVIEW_ACTIVE_TTL_MS = 30_000;
const SESSION_TTL_MS = 10_000;
const HISTORY_TTL_MS = 60_000;
const MAX_CACHED_SESSIONS = 32;
type Cached<T> = { value: T; savedAt: number; scope?: string };

let overview: Cached<GameOverview> | null = null;
const sessions = new Map<string, Cached<GameSession>>();
let notificationSessions={scope:'',ids:new Set<string>()};
export function retainNotificationGameSessions(ids:string[],scope:string){notificationSessions={scope,ids:new Set(ids)};}
let history: (Cached<GameHistoryPage> & { scope: string }) | null = null;
type Progress = { scope: string; ownedIds: string[]; availableIds: string[]; completion: Record<string,GameCompletion>; lastRounds: Record<string,GameSessionSummary> };
let progress: Progress | null = null;
const changes = new Set<() => void>();
export function subscribeGameRoomChanges(listener: () => void): () => void {
  changes.add(listener);return () => { changes.delete(listener); };
}
/** Private broadcasts invalidate only the current user's visible game screens. */
export function notifyGameRoomChanged(userId: string): void {
  if (userId === sessionUserId()) {gameReads.invalidate();for (const listener of changes) listener();}
}
subscribeSessionIdentity(() => { gameReads.invalidate();cancelDisplayWrite?.();cancelDisplayWrite=undefined;displayWrites.clear();overview = null; sessions.clear(); history = null; progress = null;notificationSessions={scope:'',ids:new Set()}; });
function safeSummary(row: GameSessionSummary): GameSessionSummary | null {
  if(!row||typeof row.id!=='string'||typeof row.gameId!=='string'||!Number.isFinite(Date.parse(row.createdAt))
    ||![row.ownCount,row.guessCount,row.partnerOwnCount,row.partnerGuessCount].every(n=>Number.isInteger(n)&&n>=0&&n<=6)
    ||row.completedAt!==null&&!Number.isFinite(Date.parse(row.completedAt)))return null;
  return {id:row.id,gameId:row.gameId,createdAt:row.createdAt,completedAt:row.completedAt,
    resultViewedAt:typeof row.resultViewedAt==='string'?row.resultViewedAt:null,
    ownCount:row.ownCount,guessCount:row.guessCount,partnerOwnCount:row.partnerOwnCount,partnerGuessCount:row.partnerGuessCount};
}
function readProgress(scope: string): Progress | null {
  if (!scope || scope.split(':')[0] !== sessionUserId()) return null;
  if (progress?.scope === scope) return progress;
  try {
    const saved = JSON.parse(storage.getString(kGameProgress.keyFor(scope)) ?? 'null');
    if (saved?.scope !== scope || !Array.isArray(saved.ownedIds) || !Array.isArray(saved.availableIds)
      || !saved.completion || typeof saved.completion !== 'object') return null;
    progress = {scope,ownedIds:saved.ownedIds.filter((id:unknown)=>typeof id==='string'),
      availableIds:saved.availableIds.filter((id:unknown)=>typeof id==='string'),completion:Object.fromEntries(
        Object.entries(saved.completion).filter(([,v])=>v&&typeof v==='object').map(([id,v])=>{
          const value=v as GameCompletion;return [id,{mineFinished:value.mineFinished===true,partnerFinished:value.partnerFinished===true}];
        })),lastRounds:Object.fromEntries(Object.values(saved.lastRounds??{}).map(row=>safeSummary(row as GameSessionSummary))
          .filter((row): row is GameSessionSummary=>!!row).map(row=>[row.gameId,row]))};
    return progress;
  } catch { return null; }
}
function saveProgress(scope: string, completion: Record<string,GameCompletion>, ownedIds?: string[], availableIds?: string[], rounds: GameSessionSummary[] = []) {
  if (!scope || scope.split(':')[0] !== sessionUserId()) return;
  const prior=readProgress(scope);
  const next={scope,ownedIds:[...new Set([...(prior?.ownedIds??[]),...(ownedIds??[])])],
    availableIds:[...new Set([...(prior?.availableIds??[]),...(availableIds??[])])],completion:{...prior?.completion},lastRounds:{...prior?.lastRounds}};
  for(const raw of rounds){
    const row=safeSummary(raw);if(!row)continue;
    const old=next.lastRounds[row.gameId];
    if(old?.completedAt&&!row.completedAt)continue;
    if(!old||row.completedAt&&!old.completedAt||row.createdAt>old.createdAt||row.createdAt===old.createdAt&&row.id>=old.id)
      next.lastRounds[row.gameId]={...row,resultViewedAt:row.resultViewedAt??(old?.id===row.id?old.resultViewedAt:null),
        ...(old?.id===row.id?{ownCount:Math.max(old.ownCount,row.ownCount),guessCount:Math.max(old.guessCount,row.guessCount),
          partnerOwnCount:Math.max(old.partnerOwnCount,row.partnerOwnCount),partnerGuessCount:Math.max(old.partnerGuessCount,row.partnerGuessCount)}:{})};
  }
  for(const [id,done] of Object.entries(completion))next.completion[id]={
    mineFinished:!!next.completion[id]?.mineFinished||done.mineFinished,
    partnerFinished:!!next.completion[id]?.partnerFinished||done.partnerFinished};
  if(JSON.stringify(prior)===JSON.stringify(next))return;
  progress=next;
  persistDisplay(kGameProgress.keyFor(scope),scope,next);
}
function completionOf(value: GameOverview): Record<string,GameCompletion> {
  const done={...value.completion};
  for(const row of value.sessions){
    const mineFinished=!!row.completedAt||row.ownCount===6&&row.guessCount===6;
    const partnerFinished=!!row.completedAt||row.partnerOwnCount===6&&row.partnerGuessCount===6;
    if(mineFinished||partnerFinished)done[row.gameId]={mineFinished:!!done[row.gameId]?.mineFinished||mineFinished,
      partnerFinished:!!done[row.gameId]?.partnerFinished||partnerFinished};
  }
  return done;
}

export function getCachedGameOverview(scope?: string): GameOverview | null {
  if(!overview&&scope&&scope.split(':')[0]===sessionUserId()) {
    try {
      const saved=JSON.parse(storage.getString(kGameOverview.keyFor(scope))??'null');
      if(saved?.scope===scope&&Array.isArray(saved.value?.games)&&saved.value.games.length
        &&Array.isArray(saved.value.categories)&&Array.isArray(saved.value.ownedIds)&&Array.isArray(saved.value.availableIds)
        &&Array.isArray(saved.value.sessions)&&Number.isFinite(saved.savedAt))overview=saved;
    }catch{}
  }
  if(scope!==undefined&&overview&&overview.scope!==scope)return null;
  const saved=scope?readProgress(scope):null;
  if(!overview&&saved)overview={savedAt:0,scope,value:{paired:true,categories:[],games:[],sessions:[],...saved}};
  if(overview&&saved&&overview.value.paired&&overview.value.completion!==saved.completion)
    overview={...overview,value:{...overview.value,completion:saved.completion,lastRounds:saved.lastRounds}};
  return overview?.value??null;
}
export function gameOverviewNeedsRefresh(now = Date.now(), scope?:string): boolean {
  if (!overview || scope!==undefined&&overview.scope!==scope) return true;
  const ttl = overview.value.sessions.some(session => !session.completedAt)
    ? OVERVIEW_ACTIVE_TTL_MS : OVERVIEW_IDLE_TTL_MS;
  return now - overview.savedAt >= ttl;
}
export function cacheGameOverview(value: GameOverview, now = Date.now(), scope?: string): GameOverview {
  // Unlocks are permanent within a relationship scope. A read started before
  // an unlock receipt must not erase it, even if it finishes afterwards.
  // Never merge prices/Plus or another account/pair's permissions.
  if(scope&&overview?.scope===scope&&overview.value.paired&&value.paired){
    const ownedIds=[...new Set([...overview.value.ownedIds,...value.ownedIds])];
    const availableIds=[...new Set([...overview.value.availableIds,...value.availableIds])];
    value={...value,ownedIds,availableIds};
  }
  if(scope&&value.paired){
    saveProgress(scope,completionOf(value),value.ownedIds,value.availableIds,value.sessions);
    const saved=readProgress(scope);
    if(saved)value={...value,ownedIds:saved.ownedIds,availableIds:saved.availableIds,completion:saved.completion,lastRounds:saved.lastRounds};
  }
  overview = { value, savedAt: now, scope };
  if(scope&&scope.split(':')[0]===sessionUserId()) {
    // Persist summaries only. Unknown wire fields must never put private
    // answers/questions in the long-lived display cache.
    const display={paired:value.paired,categories:value.categories,games:value.games?.map(game=>({
      id:game.id,category:game.category,categoryId:game.categoryId,number:game.number,title:game.title,
      hook:game.hook,spicy:game.spicy,questionCount:game.questionCount,price:game.price,plus_only:game.plus_only,active:game.active,
    })),products:value.products,ownedIds:value.ownedIds,availableIds:value.availableIds,
      sessions:value.sessions.map(safeSummary).filter(Boolean),completion:value.completion,lastRounds:value.lastRounds};
    persistDisplay(kGameOverview.keyFor(scope),scope,{...overview,value:display});
  }
  return value;
}
export function getCachedGameSession(id: string, scope?: string): GameSession | null {
  const cached=sessions.get(id);
  return scope!==undefined && cached?.scope!==scope ? null : cached?.value ?? null;
}
export function gameSessionNeedsRefresh(id: string, now = Date.now()): boolean {
  const cached = sessions.get(id);
  return !cached || now - cached.savedAt >= SESSION_TTL_MS;
}
export function cacheGameSession(value: GameSession, now = Date.now(), scope = ''): void {
  const previous=getCachedGameSession(value.id,scope);
  // A background GET started before the final submission must never overwrite
  // its full result receipt (or rewind acknowledged answers) when it ends late.
  if(previous?.completedAt&&previous.result&&!value.completedAt)return;
  if(previous&&!value.completedAt&&(value.ownAnswers.length<previous.ownAnswers.length||value.guesses.length<previous.guesses.length))return;
  const mineFinished=value.ownAnswers?.length===6&&value.guesses?.length===6;
  const partnerFinished=value.partnerOwnCount===6&&value.partnerGuessCount===6;
  if(value.gameId&&(mineFinished||partnerFinished||value.completedAt))saveProgress(scope,{[value.gameId]:{
    mineFinished:!!value.completedAt||mineFinished,partnerFinished:!!value.completedAt||partnerFinished}});
  sessions.delete(value.id);
  sessions.set(value.id, { value, savedAt: now, scope });
  if(sessions.size>MAX_CACHED_SESSIONS)for(const [id,row]of sessions){
    if(sessions.size<=MAX_CACHED_SESSIONS)break;
    if(notificationSessions.scope===row.scope&&notificationSessions.ids.has(id))continue;
    sessions.delete(id);
  }
  if (value.completedAt && value.resultViewedAt && history && !history.value.rounds.some(round => round.id === value.id)) history.savedAt = 0;
  if (value.completedAt && value.result && value.resultViewedAt && ownsHistory(scope)) {
    const previous = getCachedGameHistory(scope);
    const createdAt = overview?.value.sessions.find(round => round.id === value.id)?.createdAt
      ?? previous?.rounds.find(round => round.id === value.id)?.createdAt ?? value.completedAt;
    cacheGameHistory({ paired: true, nextCursor: previous?.nextCursor ?? null,
      rounds: [{ id: value.id, gameId: value.gameId, createdAt, completedAt: value.completedAt, resultViewedAt:value.resultViewedAt, result: value.result },
        ...(previous?.rounds.filter(round => round.id !== value.id) ?? [])] }, 0, scope);
  }
}
const ownsHistory = (scope: string) => !!scope && scope.split(':')[0] === sessionUserId();
function validRound(round: GameHistoryPage['rounds'][number]): boolean {
  const result = round?.result;
  return typeof round?.id === 'string' && typeof round.gameId === 'string'
    && typeof round.createdAt === 'string' && Number.isFinite(Date.parse(round.createdAt))
    && typeof round.completedAt === 'string' && Number.isFinite(Date.parse(round.completedAt))
    && (result === null || !!result && ['win', 'tie', 'lose'].includes(result.outcome)
      && Number.isInteger(result.mine) && result.mine >= 0 && result.mine <= 6
      && Number.isInteger(result.partner) && result.partner >= 0 && result.partner <= 6);
}
export function getCachedGameHistory(scope = ''): GameHistoryPage | null {
  if (scope && !ownsHistory(scope)) return null;
  if (history?.scope === scope) return history.value;
  if (!scope) return null;
  try {
    const saved = JSON.parse(storage.getString(kGameHistory.keyFor(scope)) ?? 'null');
    if (saved?.scope === scope && typeof saved.savedAt === 'number' && Array.isArray(saved.value?.rounds)) {
      const value = { paired: saved.value.paired === true, rounds: saved.value.rounds.filter(validRound).slice(0, 300),
        nextCursor: typeof saved.value.nextCursor === 'string' ? saved.value.nextCursor : null };
      history = { scope, savedAt: saved.savedAt, value };
      return value;
    }
  } catch { /* Damaged/unavailable storage never blocks history. */ }
  return null;
}
export function gameHistoryNeedsRefresh(now = Date.now(), scope = ''): boolean {
  getCachedGameHistory(scope);
  return !history || history.scope !== scope || now - history.savedAt >= HISTORY_TTL_MS;
}
export function cacheGameHistory(value: GameHistoryPage, now = Date.now(), scope = ''): void {
  if (scope && !ownsHistory(scope)) return;
  history = { value, savedAt: now, scope };
  if (!scope) return;
  // Persist only list metadata/scores, not private answer arrays or questions.
  const rounds = value.rounds.filter(validRound).slice(0, 300).map(round => ({ id: round.id, gameId: round.gameId,
    createdAt: round.createdAt, completedAt: round.completedAt, resultViewedAt:round.resultViewedAt, result: round.result }));
  persistDisplay(kGameHistory.keyFor(scope),scope,{ scope, savedAt: now, value: { ...value, rounds } });
}
