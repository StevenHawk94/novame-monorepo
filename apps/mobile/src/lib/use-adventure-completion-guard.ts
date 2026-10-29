import {useEffect,useSyncExternalStore} from 'react';
import {BackHandler} from 'react-native';
import {useIsFocused,usePreventRemove} from '@react-navigation/native';
import {usePageBackGesture} from './use-page-back-gesture';
import {sessionUserId,subscribeSessionIdentity} from './session-lifecycle';
import {useBurrowSelector} from './burrow-store';
import {adventureScope} from './adventure-entry-state';
import type {MajorUpdateBootstrap} from './app-major-update-api';

/** Client-only normal-flow lock. System background/process death is never
 * intercepted; only completion or security/scope loss releases it. Retryable
 * storage/network errors remain in this same recoverable flow, not an exit. */
export function useAdventureCompletionGuard(data:MajorUpdateBootstrap,finished:boolean){
  const focused=useIsFocused(),owner=useSyncExternalStore(subscribeSessionIdentity,sessionUserId,sessionUserId);
  const scope=useBurrowSelector(s=>s.data?adventureScope(s.data):'');
  const blocked=focused&&!finished&&owner===data.profile.id&&scope===adventureScope(data);
  usePreventRemove(blocked,()=>{});
  usePageBackGesture(!blocked);
  useEffect(()=>{if(!blocked)return;const back=BackHandler.addEventListener('hardwareBackPress',()=>true);return()=>back.remove();},[blocked]);
  return blocked;
}
