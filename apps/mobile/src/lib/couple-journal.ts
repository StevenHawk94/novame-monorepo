import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { storage } from './storage';
import { kBurrowJournal, kJournalOutbox } from '../shared/storage/keys';
import { createJournalOutbox, type JournalScope } from './journal-outbox';
import { coupleJournalDate, coupleJournalQuestion, localJournalPageId, isLocalJournalPage } from './couple-journal-questions';
import type { MajorUpdateBootstrap } from './app-major-update-api';
import { notificationContentVersion } from './notification-content-version';
import { removeBurrowTextDraft } from './burrow-text-drafts';
import { yieldToUi } from './ui-idle';

export type CoupleJournalAnswer = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};
export type CoupleJournalPage = {
  id: string;
  date: string;
  private: boolean;
  pageNumber: number;
  questionId: string;
  question: string;
  answers: CoupleJournalAnswer[];
  protocol?:number;timezone?:string;completedAt?:string|null;nextAvailableAt?:string|null;createdAt?:string;
  unread?:boolean;unopened?:boolean;
};
export type CoupleJournalSnapshot = {
  protocol?:number;
  today: CoupleJournalPage;
  history: CoupleJournalPage[];
  hasMore: boolean;
  nextBefore: string | null;
  todayDate: string;
  timezone: string;
  pairVersion: string;
};

let cached: { scope: string; data: CoupleJournalSnapshot } | null = null;
let authoritative: {scope:string;data:CoupleJournalSnapshot}|null = null;
const reads = new Map<string, Promise<CoupleJournalSnapshot>>();
const listeners=new Set<()=>void>(),versions=new Map<string,string>();
let mutation=0;
let active=true;
let context:JournalScope|null=null;
const notify=()=>listeners.forEach(fn=>{try{fn();}catch{}});
const code=(error:unknown)=>String((error as {body?:{error?:unknown};message?:unknown})?.body?.error??(error as Error)?.message??'');
const scopeKey=(scope:JournalScope)=>`${scope.owner}:${scope.pairVersion}`;
const outbox=createJournalOutbox({
  load:scope=>JSON.parse(storage.getString(kJournalOutbox.keyFor(scopeKey(scope)))??'null'),
  persist:(scope,value)=>storage.set(kJournalOutbox.keyFor(scopeKey(scope)),JSON.stringify(value)),
  current:scope=>sessionUserId()===scope.owner&&context?.pairVersion===scope.pairVersion,
  active:()=>active,
  bind:async(job,scope)=>{const fresh=await fetchCoupleJournal(undefined,scopeKey(scope));
    if(fresh.today.questionId!==job.questionId||fresh.today.date!==job.date)throw Error('journal_page_changed');
    cacheCoupleJournal(scopeKey(scope),fresh);return fresh.today.id;},
  send:(job,scope)=>saveCoupleJournalAnswer(job.pageId,job.body,job.expectedUpdatedAt,job.key,scope.pairVersion),
  read:async job=>{await apiClient.patch('/api/vnext/couple-journal',job);},
  apply:(job,result)=>{const page=result as CoupleJournalPage;if(authoritative&&context&&authoritative.scope===scopeKey(context)){
    const data=replaceJournalPage(authoritative.data,page);cacheCoupleJournal(authoritative.scope,data);
    removeBurrowTextDraft(scopeKey(context),job.pageId,job.key);
    removeBurrowTextDraft(scopeKey(context),localJournalPageId(job.date),job.key);
  }},
  changed:()=>{if(authoritative&&context&&authoritative.scope===scopeKey(context))cached={...authoritative,data:projectJournal(authoritative.data)};notify();},
  code,schedule:(fn,ms)=>setTimeout(fn,ms),cancel:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),
});
export function configureJournal(data:MajorUpdateBootstrap){
  const next={owner:data.profile.id,pairVersion:data.pairVersion??'solo'};
  context=next;
  // Corrupt local intent storage must not crash a room or block navigation.
  // The queue remains unavailable (Save fails safely) until storage recovers.
  try{outbox.receive(next);}catch{notify();}
}
export function observeJournalAppState(state:string){active=state==='active';if(active)outbox.resume();else outbox.pause();}
export function journalJobs(){return outbox.snapshot().writes;}
export function discardRejectedJournal(key:string){outbox.discardRejected(key);}
export function enqueueJournal(scope:string,page:CoupleJournalPage,body:string,expectedUpdatedAt:string|null,key:string){
  if(!context||scopeKey(context)!==scope)throw Error('session_changed');
  if(outbox.snapshot().writes.some(j=>j.pageId===page.id&&!j.error))throw Error('journal_save_pending');
  outbox.enqueue({key,pageId:page.id,questionId:page.questionId,date:page.date,body:body.trim(),expectedUpdatedAt});
}
export function acknowledgeJournal(scope:string,page:CoupleJournalPage){
  if(!context||scopeKey(context)!==scope||isLocalJournalPage(page.id))return;
  const at=page.answers.filter(a=>a.authorId!==context!.owner).map(a=>a.updatedAt).sort().at(-1)??null;
  outbox.acknowledge({pageId:page.id,answerAt:at});
  if(authoritative?.scope===scope){const base=[authoritative.data.today,...authoritative.data.history].find(p=>p.id===page.id);
    if(base){const next=replaceJournalPage(authoritative.data,{...base,unread:false,unopened:false});cacheCoupleJournal(scope,next);}}
}
function projectJournal(snapshot:CoupleJournalSnapshot):CoupleJournalSnapshot{
  const project=(page:CoupleJournalPage)=>{const job=outbox.snapshot().writes.filter(j=>!j.error&&j.pageId===page.id).at(-1);
    const read=outbox.snapshot().reads.find(r=>r.pageId===page.id);
    if(read){const partner=page.answers.find(a=>a.authorId!==context?.owner);page={...page,unopened:false,
      unread:!!partner&&(!read.answerAt||Date.parse(partner.updatedAt)>Date.parse(read.answerAt))};}
    if(!job||!context)return page;
    const before=page.answers.find(a=>a.authorId===context!.owner);
    return {...page,answers:[...page.answers.filter(a=>a.authorId!==context!.owner),{
      id:before?.id??`pending:${job.key}`,authorId:context.owner,body:job.body,createdAt:before?.createdAt??new Date().toISOString(),updatedAt:before?.updatedAt??''}]};};
  return {...snapshot,today:project(snapshot.today),history:snapshot.history.map(project)};
}
export function replaceJournalPage(snapshot:CoupleJournalSnapshot,page:CoupleJournalPage){
  return {...snapshot,today:snapshot.today.id===page.id?page:snapshot.today,
    history:snapshot.history.map(p=>p.id===page.id?page:p)};
}
export const subscribeCoupleJournalCache=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const preparedCoupleJournalVersion=(scope:string)=>versions.get(scope);
subscribeSessionIdentity(() => { context=null;outbox.reset();cached = null;authoritative=null; reads.clear();versions.clear();notify(); });
function readCachedJournal(scope: string) {
  if (scope.split(':')[0] !== sessionUserId()) return null;
  if (cached?.scope !== scope) {
    try {
      const record = JSON.parse(storage.getString(kBurrowJournal.keyFor(scope)) ?? 'null');
      if (record?.scope === scope && Number.isFinite(record.savedAt) && record.savedAt <= Date.now() + 60_000
        && Date.now() - record.savedAt < 7 * 86_400_000 && record.data?.today&&Array.isArray(record.data.today.answers)
        &&Array.isArray(record.data?.history)&&record.data.history.every((page:CoupleJournalPage)=>page&&Array.isArray(page.answers))) {authoritative=record;cached={...record,data:projectJournal(record.data)};}
    } catch {}
  }
  if (cached?.scope !== scope) return null;
  return cached.data;
}
export function cachedCoupleJournal(scope: string) {
  const data = readCachedJournal(scope);
  if(data?.protocol===2)return !data.today.nextAvailableAt||Date.parse(data.today.nextAvailableAt)>Date.now()?data:null;
  return data && coupleJournalDate(data.timezone) === data.todayDate ? data : null;
}
/** First paint never waits for the API. Old answers remain on their original
 * date, while today's bundled prompt can be read and drafted immediately. */
export function localCoupleJournal(scope: string, fallbackTimezone = 'UTC'): CoupleJournalSnapshot | null {
  if (!scope || scope.split(':')[0] !== sessionUserId()) return null;
  const previous = readCachedJournal(scope);
  // A device clock cannot invent a new shared page or reassign its draft.
  if(previous?.protocol===2)return previous;
  // Without an authoritative shared identity/topic, do not offer a guessed
  // calendar question that may differ from the completion-driven book.
  // Solo retains its existing local-day drafting contract.
  if(!scope.endsWith(':solo'))return previous;
  const timezone = previous?.timezone || fallbackTimezone;
  const date = coupleJournalDate(timezone);
  if (previous?.todayDate === date) return previous;
  const history = previous ? [previous.today, ...previous.history]
    .filter((page, index, pages) => page.date < date && page.answers.length > 0
      && !isLocalJournalPage(page.id) && pages.findIndex(other => other.id === page.id) === index) : [];
  const prompt = coupleJournalQuestion(date);
  return {
    today: { id: localJournalPageId(date), date, private: scope.endsWith(':solo'),
      pageNumber: (previous?.today.pageNumber ?? 0) + 1, questionId: prompt.id, question: prompt.question, answers: [] },
    history, hasMore: previous?.hasMore ?? false, nextBefore: previous?.nextBefore ?? null,
    todayDate: date, timezone, pairVersion: scope.slice(scope.indexOf(':') + 1),
  };
}
export function cacheCoupleJournal(scope: string, data: CoupleJournalSnapshot, durable = true) {
  if (scope.split(':')[0] !== sessionUserId()) return;
  if(authoritative?.scope===scope){
    const known=new Map([authoritative.data.today,...authoritative.data.history].map(p=>[p.id,p]));
    const merge=(page:CoupleJournalPage)=>{const old=known.get(page.id);if(!old)return page;
      const answers=[...page.answers];for(const a of old.answers){const i=answers.findIndex(b=>b.authorId===a.authorId);
        if(i<0)answers.push(a);else if(Date.parse(a.updatedAt)>Date.parse(answers[i].updatedAt))answers[i]=a;}
      return {...page,answers,completedAt:page.completedAt??old.completedAt,nextAvailableAt:page.nextAvailableAt??old.nextAvailableAt};};
    data={...data,today:merge(data.today),history:data.history.map(merge)};
  }
  if(data.today.completedAt&&!data.history.some(p=>p.id===data.today.id))data={...data,history:[data.today,...data.history]};
  mutation++;authoritative={scope,data};cached = { scope, data:context&&scopeKey(context)===scope?projectJournal(data):data };
  notify();
  if (durable && !isLocalJournalPage(data.today.id)) try {
    const ownPage = (page: CoupleJournalPage) => ({ ...page, answers: page.answers.filter(answer => answer.authorId === sessionUserId()) });
    storage.set(kBurrowJournal.keyFor(scope), JSON.stringify({ scope, savedAt: Date.now(), data: {
      ...data, today: ownPage(data.today), history: data.history.map(ownPage),
    } }));
  } catch {}
}

/** Hydrate partner answers before publishing a notification, never on a tap. */
export async function prepareCoupleJournal(data:MajorUpdateBootstrap,current:()=>boolean){
  const scope=`${data.profile.id}:${data.pairVersion??'solo'}`,version=notificationContentVersion(data,'journal');
  if(versions.get(scope)===version&&cachedCoupleJournal(scope))return;
  const before=mutation;
  const fresh=await fetchCoupleJournal(undefined,scope);
  if(!current())return;
  if(before!==mutation)throw Error('journal_changed_during_read');
  const required=data.attention?.journal??[];
  const previous=cachedCoupleJournal(scope);
  fresh.history=[...fresh.history,...(previous?.history??[]).filter(p=>p.id!==fresh.today.id&&!fresh.history.some(row=>row.id===p.id))];
  const targets=[...new Set(required.map(item=>item.pageId).filter((id):id is string=>!!id))];
  const ready=(pageId:string)=>{const page=[fresh.today,...fresh.history].find(p=>p.id===pageId);
    return !!page&&required.filter(item=>item.pageId===pageId&&item.answerId).every(item=>page.answers.some(a=>a.id===item.answerId&&a.updatedAt===item.revision));};
  const missing=targets.filter(id=>!ready(id));let cursor=0;
  // Four pages per cooperative batch, two concurrent reads. Long absences
  // cannot monopolize a foreground task or fan out hundreds of requests.
  await Promise.all([0,1].map(async()=>{while(cursor<Math.min(4,missing.length)){
    const page=await fetchCoupleJournalPage(missing[cursor++]);if(!current())return;
    fresh.history=[...fresh.history.filter(p=>p.id!==page.id),page];await yieldToUi();if(!current())return;
  }}));
  if(!current())return;
  if(before!==mutation)throw Error('journal_changed_during_read');
  if(missing.length>4){cacheCoupleJournal(scope,fresh);throw Error('notification_batch_pending');}
  const available=new Set([fresh.today,...fresh.history].flatMap(page=>page.answers.map(answer=>`${answer.id}:${answer.updatedAt}`)));
  if(required.some(item=>item.kind==='page'?![fresh.today,...fresh.history].some(p=>p.id===item.pageId):
    item.answerId?![fresh.today,...fresh.history].some(p=>p.answers.some(a=>a.id===item.answerId&&a.updatedAt===item.revision)):!available.has(item.id)))throw Error('journal_revision_not_ready');
  const history=[...fresh.history,...(previous?.history??[]).filter(page=>page.id!==fresh.today.id&&!fresh.history.some(row=>row.id===page.id))]
    .sort((a,b)=>b.date.localeCompare(a.date));
  versions.set(scope,version);cacheCoupleJournal(scope,{...fresh,history});
}

export function fetchCoupleJournal(before?: string, scope = sessionUserId() ?? '') {
  const epoch = sessionEpoch();
  const key = `${epoch}:${scope}:${before ?? 'today'}`;
  const existing = reads.get(key);
  if (existing) return existing;
  const path = `/api/vnext/couple-journal?v=2${before ? `&before=${encodeURIComponent(before)}` : ''}`;
  const task = withDeadline(
    apiClient.get<CoupleJournalSnapshot & { success: boolean }>(path), 20_000,
  ).then(result => {
    if (epoch !== sessionEpoch()) throw new Error('session_changed');
    if (!result.success||!result.today||!Array.isArray(result.today.answers)||!Array.isArray(result.history)) throw new Error('journal_unavailable');
    return result;
  });
  reads.set(key, task);
  const clear = () => { if (reads.get(key) === task) reads.delete(key); };
  void task.then(clear, clear);
  return task;
}
export async function fetchCoupleJournalPage(pageId: string) {
  const epoch = sessionEpoch();
  const result = await withDeadline(apiClient.get<{ success: boolean; page: CoupleJournalPage }>(`/api/vnext/couple-journal?page=${encodeURIComponent(pageId)}`), 20_000);
  if (epoch !== sessionEpoch()) throw Error('session_changed');
  if (!result.success||!result.page||!Array.isArray(result.page.answers)) throw Error('journal_unavailable');
  return result.page;
}

export async function saveCoupleJournalAnswer(
  pageId: string, body: string, expectedUpdatedAt: string | null, idempotencyKey: string,pairVersion?:string,
) {
  const epoch = sessionEpoch();
  const result = await withDeadline(
    apiClient.post<{ success: boolean; page: CoupleJournalPage }>('/api/vnext/couple-journal', {
      pageId, body, expectedUpdatedAt, idempotencyKey,...(pairVersion?{protocol:2,pairVersion}:{}),
    }), 20_000,
  );
  if (epoch !== sessionEpoch()) throw new Error('session_changed');
  if (!result.success) throw new Error('journal_unavailable');
  return result.page;
}
