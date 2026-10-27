import { storage } from './storage';
import { kSurpriseGuideSeen } from '@/shared/storage/keys';
import { sessionUserId } from './session-lifecycle';

export function hasSeenSurpriseGuide(userId:string){
  return storage.getString(kSurpriseGuideSeen.name)===userId;
}
export function acknowledgeSurpriseGuide(userId:string){
  if(sessionUserId()===userId)storage.set(kSurpriseGuideSeen.name,userId);
}
