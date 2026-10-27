import type { MajorUpdateBootstrap } from './app-major-update-api';
import { storage } from './storage';
import { kQuestProgress } from '../shared/storage/keys';
import { createQuestProgress, questScope, type QuestIntent } from './quest-progress-model';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';

let read: () => MajorUpdateBootstrap | null = () => null;
const listeners = new Set<() => void>();
export const questProgress = createQuestProgress({
  load: () => JSON.parse(storage.getString(kQuestProgress.name) ?? 'null'),
  save: value => storage.set(kQuestProgress.name,JSON.stringify(value)),
  changed: () => listeners.forEach(fn => fn()),
});
subscribeSessionIdentity(() => questProgress.reload(sessionUserId()??null));
export function configureQuestProgress(provider: typeof read, changed: () => void) {
  read = provider; listeners.add(changed);
}
export function subscribeQuestProgress(changed:()=>void) {
  listeners.add(changed); return()=>{listeners.delete(changed);};
}
export function currentQuestData() {
  const data = read(); return data?.profile.id === sessionUserId() ? data : null;
}
export function captureQuestFact(questId: string): QuestIntent | undefined {
  const data = currentQuestData(); return data ? questProgress.capture(data,questId) : undefined;
}
export function guardQuestClaim(intent: QuestIntent) {
  const data = currentQuestData();let verified=intent.verified;
  if(data&&intent.assignmentId){
    try{verified=verified||questProgress.captureClaim(data,intent.assignmentId).verified;}catch{}
  }
  questProgress.guard({...intent,verified},data ? questScope(data) : null);
}
