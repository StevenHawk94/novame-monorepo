import {useEffect,useState} from 'react';
import {AppState} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {MajorUpdateBootstrap} from './app-major-update-api';
import {getBurrowSnapshot} from './burrow-store';
import {sessionEpoch,sessionUserId} from './session-lifecycle';
import {stageForegroundJobs} from './ui-idle';
import {burrowPageIsReady} from './burrow-page-entry';
import {burrowPreloadDestinations} from './burrow-destination-model';
import {useNotificationContentReady} from './burrow-attention';

/** Stable identities reuse the native stack's offscreen view, not a second
 * navigator. Parameterized tasks/deep links keep their original stack lifetime. */
export function useBurrowDestinationPreload(source:string,focused:boolean,data:MajorUpdateBootstrap|null){
  const navigation=useNavigation();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const eligible=source==='home'||source==='burrow';
  const journalReady=useNotificationContentReady(source==='burrow'?data:null,'journal');
  useEffect(()=>{
    if(!eligible)return;
    setForeground(AppState.currentState==='active');
    const app=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>app.remove();
  },[eligible]);
  const owner=data?.profile.id,partner=data?.partner?.id,pair=data?.pairVersion;
  useEffect(()=>{
    if(!focused||!foreground||!data?.catalogComplete||owner!==sessionUserId()||!['home','burrow'].includes(source))return;
    let parent=navigation.getParent();
    while(parent&&!parent.getState().routeNames.includes('burrow-detail'))parent=parent.getParent();
    if(!parent)return;
    const stack=parent,epoch=sessionEpoch();
    return stageForegroundJobs(burrowPreloadDestinations(data,source).map((section,index)=>({delayMs:400+index*220,run:()=>{
      const latest=getBurrowSnapshot().data;
      if(!navigation.isFocused()||AppState.currentState!=='active'||epoch!==sessionEpoch()||!latest||
        latest.profile.id!==owner||latest.partner?.id!==partner||latest.pairVersion!==pair||
        !burrowPreloadDestinations(latest,source).includes(section))return;
      const kind=section==='memories_room'?'journal':section==='affection'?'affection':'adventure';
      if(!burrowPageIsReady({kind}))return;
      const state=stack.getState() as ReturnType<typeof stack.getState>&{preloadedRoutes?:{name:string;params?:Record<string,unknown>}[]};
      if([...state.routes,...(state.preloadedRoutes??[])].some(route=>route.name==='burrow-detail'&&(route.params as Record<string,unknown>|undefined)?.section===section))return;
      stack.preload('burrow-detail',{section});
    }})));
  },[navigation,source,focused,foreground,journalReady,owner,partner,pair,data?.catalogComplete,data?.pairAccessVerified,
    data?.readyRecordId,data?.dailyAdventureUsed,data?.activeAdventure?.id,data?.activeAdventure?.status]);
}
