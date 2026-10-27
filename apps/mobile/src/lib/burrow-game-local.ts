import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { storage } from './storage';
import { kGameLocal } from '../shared/storage/keys';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { getBurrowSnapshot, refreshBurrow } from './burrow-store';
import { gameOverview, gameSession, startGame, submitGame, unlockGame, viewGameResult, type GameOverview, type GameSession, type GameSummary } from './burrow-game-room-api';
import { localGameSession } from './burrow-game-room-content';
import { cacheGameOverview, cacheGameSession, getCachedGameOverview, getCachedGameSession } from './burrow-game-room-cache';
import { captureQuestFact, questProgress } from './quest-progress-store';
import type { QuestIntent } from './quest-progress-model';
import { burrowLocalDay } from './burrow-local-day';

export type LocalGame = { id: string; owner: string; scope: string; createdAt: string; session: GameSession;
  sessionId?: string; submitted: boolean; confirmed: boolean; error?: string; blocked?: boolean;
  freeUnlock?: boolean; quest?: QuestIntent;
  supersededDraft?: Pick<GameSession,'ownAnswers'|'guesses'> };
let owner: string | null = null, jobs: LocalGame[] = [], seen: Record<string,string[]> = {};
let pendingViews:Record<string,string[]> = {};
let revision = 0, generation = 0, flight: Promise<void> | null = null, timer: ReturnType<typeof setTimeout> | undefined, failures = 0;
const listeners = new Set<() => void>();
const isRoundId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const publish = () => { revision++; listeners.forEach(fn => fn()); };
function context() {
  const data = getBurrowSnapshot().data, user = sessionUserId();
  return data && user === data.profile.id && data.partner ? { owner: user,
    scope: `${user}:${data.partner.id}:${data.pairVersion ?? ''}` } : null;
}
function load() {
  const user = sessionUserId() ?? null; if (owner === user) return;
  owner = user; jobs = []; seen = {}; pendingViews = {};
  try {
    const record = JSON.parse(storage.getString(kGameLocal.name) ?? 'null');
    if(record?.owner!==user)return;
    jobs = (Array.isArray(record.jobs) ? record.jobs : []).filter((j:LocalGame) => j?.owner === user
      && typeof j.scope === 'string' && j.scope.startsWith(user + ':') && typeof j.id === 'string'
      && typeof j.submitted === 'boolean' && typeof j.confirmed === 'boolean' && validSession(j.session)
      && (!j.submitted || (j.session.ownAnswers.length === 6 && j.session.guesses.length === 6)));
    if(record.seen&&typeof record.seen==='object')seen=Object.fromEntries(Object.entries(record.seen)
      .filter(([key,value])=>key.startsWith(user+':')&&Array.isArray(value)&&value.every(id=>typeof id==='string'))
      .map(([key,value])=>[key,(value as string[]).slice(-300)]));
    if(record.pendingViews&&typeof record.pendingViews==='object')pendingViews=Object.fromEntries(Object.entries(record.pendingViews)
      .filter(([key,value])=>key.startsWith(user+':')&&Array.isArray(value)&&value.every(id=>typeof id==='string'&&isRoundId(id)))
      .map(([key,value])=>[key,value as string[]]));
  } catch { /* Corrupt drafts never become server commands. */ }
}
function validSession(s: GameSession) {
  return !!s && typeof s.id === 'string' && typeof s.gameId === 'string' && Array.isArray(s.questions) && s.questions.length === 6
    && s.questions.every(q=>q&&typeof q.self==='string'&&typeof q.partner==='string'&&Array.isArray(q.options)&&q.options.length===4)
    && [s.ownAnswers,s.guesses].every(a => Array.isArray(a) && a.length <= 6
      && a.every((n,i) => Number.isInteger(n) && n >= 0 && n < s.questions[i].options.length));
}
function commit(next: LocalGame[]) {
  storage.set(kGameLocal.name,JSON.stringify({owner,jobs:next,seen,pendingViews})); // durable acknowledgement before next question
  jobs=next;publish();
}
export function useLocalGames(scope: string) {
  useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>revision,()=>revision);
  load();return jobs.filter(j=>j.scope===scope&&j.owner===sessionUserId());
}
export function readLocalGame(id: string, scope: string) {
  load();return jobs.find(j=>j.scope===scope&&j.owner===sessionUserId()
    &&(j.id===id||j.sessionId===id||j.session.id===id||'local:'+j.id===id));
}
export function createLocalGame(game: GameSummary, existing?: GameSession, options?: { freeUnlock?: boolean }) {
  load();const ctx=context();if(!ctx)throw Error('not_paired');
  const prior=jobs.find(j=>j.scope===ctx.scope&&j.session.gameId===game.id
    && (existing ? j.sessionId===existing.id : !j.session.completedAt));
  if(prior)return prior.session;
  const id=randomUUID(),session=existing??localGameSession({id:`local:${id}`,gameId:game.id,completedAt:null,
    ownAnswers:[],guesses:[],partnerOwnCount:0,partnerGuessCount:0,partnerOwnAnswers:null,partnerGuesses:null,notifyReady:false,result:null});
  const job:LocalGame={id,owner:ctx.owner,scope:ctx.scope,createdAt:new Date().toISOString(),session,
    sessionId:existing?.id,submitted:false,confirmed:false,freeUnlock:!existing&&game.price===0&&options?.freeUnlock===true};
  // Never evict an offline draft or a round still waiting for the partner.
  const keep=jobs.filter(j=>!j.confirmed||!j.session.completedAt);
  const completed=jobs.filter(j=>j.confirmed&&!!j.session.completedAt).slice(-30);
  commit([...completed,...keep,job]);cacheGameSession(session,Date.now(),ctx.scope);
  if(job.freeUnlock)schedule(0);
  return session;
}
/** Every button does only one synchronous local append, never an HTTP request. */
export function saveLocalGameAnswer(id:string,phase:'own'|'guess',index:number,choice:number) {
  load();const ctx=context();if(!ctx)throw Error('session_changed');
  const job=readLocalGame(id,ctx.scope);if(!job||job.submitted)throw Error('already_done');
  const field=phase==='own'?'ownAnswers':'guesses',answers=job.session[field];
  if(index<answers.length&&answers[index]===choice)return job.session;
  if(index!==answers.length||index>=6||!Number.isInteger(choice)||choice<0
    ||choice>=job.session.questions[index].options.length||(phase==='guess'&&job.session.ownAnswers.length!==6))throw Error('invalid_answer');
  const session={...job.session,[field]:[...answers,choice]},submitted=session.ownAnswers.length===6&&session.guesses.length===6;
  // Existing rule: both players finish, not just the local twelve answers.
  const quest=job.quest??(submitted&&session.partnerOwnCount===6&&session.partnerGuessCount===6?captureQuestFact('play_game'):undefined);
  commit(jobs.map(j=>j.id===job.id?{...j,session,submitted,quest,error:undefined}:j));
  if(quest)questProgress.fact(`game:${job.id}`,quest,'pending');
  cacheGameSession(session,Date.now(),ctx.scope);
  if(submitted)schedule(0);return session;
}
export function reconcileLocalGame(remote:GameSession,scope:string) {
  if(remote.completedAt){const quest=captureQuestFact('play_game'),data=getBurrowSnapshot().data;
    if(quest&&data&&quest.scope===scope&&burrowLocalDay(Date.parse(remote.completedAt),data.economicTimezone ?? data.profile.timezone_name)===quest.day)
      questProgress.fact(`game:${remote.id}`,quest,'confirmed');}
  const job=readLocalGame(remote.id,scope);
  if(!job)return remote;
  // Repeated background reads are not new local actions. Avoid rewriting the
  // whole durable answer journal and waking screens for an identical receipt.
  if(job.confirmed&&!job.error&&!job.blocked&&JSON.stringify(job.session)===JSON.stringify(remote))return job.session;
  if(remote.completedAt&&remote.result){
    // An authoritative result must not be paired with a conflicting local
    // guess list from another device. Preserve that draft, but show the receipt.
    const matches=job.session.ownAnswers.every((choice,i)=>remote.ownAnswers[i]===choice)
      &&job.session.guesses.every((choice,i)=>remote.guesses[i]===choice);
    commit(jobs.map(j=>j.id===job.id?{...j,session:remote,submitted:true,confirmed:true,error:undefined,blocked:false,
      supersededDraft:matches?j.supersededDraft:{ownAnswers:j.session.ownAnswers,guesses:j.session.guesses}}:j));
    return remote;
  }
  // A stale poll/partial response can never rewind locally acknowledged answers.
  if(!job.confirmed){
    const session={...remote,ownAnswers:job.session.ownAnswers,guesses:job.session.guesses};
    commit(jobs.map(j=>j.id===job.id?{...j,session}:j));return session;
  }
  if(remote.ownAnswers.length<job.session.ownAnswers.length||remote.guesses.length<job.session.guesses.length)return job.session;
  if(job.session.completedAt&&!remote.completedAt)return job.session;
  commit(jobs.map(j=>j.id===job.id?{...j,session:remote}:j));return remote;
}
export function projectGameOverview(remote:GameOverview,scope:string) {
  load();const rows=[...remote.sessions];
  for(const job of jobs.filter(j=>j.scope===scope&&j.owner===sessionUserId())) {
    const s=job.session,id=job.sessionId??s.id,index=rows.findIndex(row=>row.id===id);
    const row={id,gameId:s.gameId,createdAt:job.createdAt,completedAt:s.completedAt,resultViewedAt:s.resultViewedAt,ownCount:s.ownAnswers.length,
      guessCount:s.guesses.length,partnerOwnCount:s.partnerOwnCount,partnerGuessCount:s.partnerGuessCount};
    if(index>=0)rows[index]={...rows[index],completedAt:rows[index].completedAt??row.completedAt,
      resultViewedAt:rows[index].resultViewedAt??row.resultViewedAt,
      ownCount:Math.max(rows[index].ownCount,row.ownCount),guessCount:Math.max(rows[index].guessCount,row.guessCount),
      partnerOwnCount:Math.max(rows[index].partnerOwnCount,row.partnerOwnCount),partnerGuessCount:Math.max(rows[index].partnerGuessCount,row.partnerGuessCount)};
    else rows.unshift(row);
  }
  return {...remote,sessions:rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))};
}
export function gameResultViewed(id:string,scope:string) {
  load();if(scope.split(':')[0]!==sessionUserId())return false;
  return !!getCachedGameOverview(scope)?.sessions.find(row=>row.id===id)?.resultViewedAt
    || Array.isArray(seen[scope])&&seen[scope].includes(id);
}
export function markGameResultViewed(id:string,scope:string) {
  load();if(scope!==context()?.scope||!isRoundId(id))return;
  const cached=getCachedGameSession(id,scope);
  const viewedAt=cached?.resultViewedAt??getCachedGameOverview(scope)?.sessions.find(row=>row.id===id)?.resultViewedAt;
  if(!viewedAt&&!pendingViews[scope]?.includes(id))pendingViews={...pendingViews,[scope]:[...(pendingViews[scope]??[]),id]};
  if(!seen[scope]?.includes(id))seen={...seen,[scope]:[...(seen[scope]??[]),id].slice(-300)};
  if(cached?.result)cacheGameSession({...cached,resultViewedAt:viewedAt??new Date().toISOString()},Date.now(),scope);
  try{commit(jobs);}catch{publish();} // A read-marker failure must never interrupt results/confetti.
  if(pendingViews[scope]?.length)schedule(0);
}
export function retryLocalGame(id:string,scope:string) {
  const job=readLocalGame(id,scope);if(!job)return;
  commit(jobs.map(j=>j.id===job.id?{...j,error:undefined,blocked:false}:j));schedule(0);
}
const active=()=>AppState.currentState==='active';
export function pauseLocalGames(){clearTimeout(timer);timer=undefined;}
function schedule(delay:number){pauseLocalGames();if(active())timer=setTimeout(()=>{timer=undefined;void resumeLocalGames();},delay);}
export function resumeLocalGames():Promise<void> {
  load();if(flight)return flight;
  pauseLocalGames();if(!active()||!context())return Promise.resolve();
  const own=generation,scope=context()?.scope;
  const task=drain(own).finally(()=>{if(flight===task)flight=null;
    if((own!==generation||scope!==context()?.scope)&&active())schedule(0);});
  flight=task;return task;
}
async function drain(own:number) {
  const current=(j:LocalGame)=>generation===own&&j.scope===context()?.scope&&j.owner===sessionUserId();
  while(active()&&own===generation) {
    const job=jobs.find(j=>j.scope===context()?.scope&&(j.submitted||j.freeUnlock)&&!j.confirmed&&!j.blocked);
    if(!job){await drainViews(own);return;}
    if(job.quest)questProgress.fact(`game:${job.id}`,job.quest,'pending');
    try {
      if(job.freeUnlock){
        // A zero-price intent can never become a paid purchase after repricing.
        await unlockGame(job.session.gameId,0);if(!current(job))return;
        const remote=getCachedGameOverview(job.scope);
        if(remote)cacheGameOverview({...remote,availableIds:[...new Set([...remote.availableIds,job.session.gameId])],ownedIds:[...new Set([...remote.ownedIds,job.session.gameId])]},Date.now(),job.scope);
        commit(jobs.map(j=>j.id===job.id?{...j,freeUnlock:false,error:undefined}:j));
        // Answers may have advanced while this request was pending. Restart
        // from the latest journal instead of submitting the captured draft.
        continue;
      }
      let id=job.sessionId;
      if(!id){const started=await startGame(job.session.gameId);if(!current(job))return;
        id=started.sessionId;commit(jobs.map(j=>j.id===job.id?{...j,sessionId:id}:j));}
      const result=await submitGame(id,job.session.ownAnswers,job.session.guesses,job.session.gameId);if(!current(job))return;
      commit(jobs.map(j=>j.id===job.id?{...j,session:result.session,confirmed:true,error:undefined}:j));
      const quest=job.quest??(result.session.completedAt?captureQuestFact('play_game'):undefined);
      if(quest)questProgress.fact(`game:${job.id}`,quest,result.session.completedAt?'confirmed':'rejected');
      cacheGameSession(result.session,Date.now(),job.scope);failures=0;
      // Metadata/notification visibility follows the committed server state.
      void gameOverview().then(value=>{if(current(job)){cacheGameOverview(value,Date.now(),job.scope);publish();}}).catch(()=>{});
      void refreshBurrow({silent:true});
    } catch(error) {
      if(!current(job))return;
      const code=error instanceof Error?error.message:'network';
      const savedId=readLocalGame(job.id,job.scope)?.sessionId;
      if(code==='already_done'&&savedId){
        try{const remote=await gameSession(savedId);if(!current(job))return;
          if(remote.completedAt&&remote.result){reconcileLocalGame(remote,job.scope);cacheGameSession(remote,Date.now(),job.scope);continue;}
        }catch{ /* Keep the durable draft and expose a retry, never fabricate a result. */ }
      }
      const blocked=['not_paired','pair_changed','not_found','answer_conflict','already_done','game_locked','price_changed','invalid_request','game_content_update_required','feature_disabled','plus_required','not_for_sale'].includes(code);
      if(blocked&&job.quest)questProgress.fact(`game:${job.id}`,job.quest,'rejected');
      try{commit(jobs.map(j=>j.id===job.id?{...j,error:code,blocked}:j));}catch{}
      if(!blocked)schedule(Math.min(60_000,2000*2**Math.min(failures++,5)));return;
    }
  }
}
async function drainViews(own:number){
  while(active()&&own===generation){
    const ctx=context(),id=ctx&&pendingViews[ctx.scope]?.[0];if(!ctx||!id)return;
    const current=()=>own===generation&&ctx.scope===context()?.scope&&ctx.owner===sessionUserId();
    try{
      const receipt=await viewGameResult(id);if(!current())return;
      const cached=getCachedGameOverview(ctx.scope);
      if(cached)cacheGameOverview({...cached,sessions:cached.sessions.map(row=>row.id===id?{...row,resultViewedAt:receipt.viewedAt}:row)},Date.now(),ctx.scope);
      const session=getCachedGameSession(id,ctx.scope);
      if(session)cacheGameSession({...session,resultViewedAt:receipt.viewedAt},Date.now(),ctx.scope);
      pendingViews={...pendingViews,[ctx.scope]:pendingViews[ctx.scope].filter(value=>value!==id)};commit(jobs);failures=0;
    }catch(error){
      if(!current())return;
      const code=error instanceof Error?error.message:'network';
      if(['not_found','pair_changed','not_paired','invalid_request'].includes(code)){
        pendingViews={...pendingViews,[ctx.scope]:pendingViews[ctx.scope].filter(value=>value!==id)};
        try{commit(jobs);}catch{};continue;
      }
      schedule(Math.min(60_000,2000*2**Math.min(failures++,5)));return;
    }
  }
}
subscribeSessionIdentity(()=>{generation++;pauseLocalGames();owner=null;jobs=[];seen={};pendingViews={};publish();});
