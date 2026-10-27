import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {router} from 'expo-router';
import {useIsFocused} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {MajorUpdateBootstrap} from '@/lib/app-major-update-api';
import {refreshBurrowAfterCurrent} from '@/lib/burrow-store';
import {friendVisitLocal,warmFriendVisit} from '@/lib/friend-visit-local';
import {BURROW_BACKGROUNDS} from '@/lib/burrow-art-assets';
import {Image} from './burrow-image';
import {FriendDialogue} from './friend-dialogue';
import {FriendRoomEmptyIcon} from './friend-room-empty-icon';
import {AdventureEncounterLayout} from './adventure-encounter-layout';
import {AdventureStageTransition} from './adventure-stage-transition';
import {FriendTextPanel} from './friend-text-panel';
import type {FriendTextPage} from '@/lib/friend-text-layout';
import {friendVisitPresentation} from '@/lib/friend-visit-presentation';
import {adventureFriendGender} from '@/lib/adventure-friend-identity';
import {BurrowBackButton} from './burrow-back-button';
import {ROOM_TITLE_STYLE} from '@/lib/room-header-typography';

/** One fixed actor stage from welcome through the final reply. A frozen
 * presentation survives background sync removing a completed visitor. */
export function CoupleFriendVisitCard({data,runtime=friendVisitLocal}:{data:MajorUpdateBootstrap;busy?:boolean;showArt?:boolean;runtime?:typeof friendVisitLocal}) {
  const visit=data.friendVisit?.version===2?data.friendVisit:null;
  const [id,setId]=useState(()=>visit?.id??'');
  const row=useSyncExternalStore(runtime.subscribe,()=>runtime.read(id),()=>undefined),insets=useSafeAreaInsets();
  const [error,setError]=useState<string|null>(null);
  const [expiredId,setExpiredId]=useState('');
  const exiting=useRef(false);
  const owner=data.profile.id;
  const focused=useIsFocused();
  useEffect(()=>{if(!focused)runtime.dismissReward?.(id,owner);},[focused,id,owner,runtime]);
  useEffect(()=>()=>runtime.dismissReward?.(id,owner),[id,owner,runtime]);
  const {height:screenHeight}=useWindowDimensions();
  useEffect(()=>{if(visit&&id!==visit.id&&(!row||row.done))setId(visit.id);},[id,visit?.id,row?.done]);
  useLayoutEffect(()=>{if(id&&row&&!row.frozen&&!runtime.open(id))setError('Your conversation couldn’t be saved on this device. Please try again.');},[id,row?.frozen,row?.candidate,runtime]);
  useEffect(()=>{if(!visit?.expiresAt)return;
    const remaining=Date.parse(visit.expiresAt)-Date.parse(data.serverNow);
    if(!Number.isFinite(remaining))return;
    const timer=setTimeout(()=>{setExpiredId(visit.id);void refreshBurrowAfterCurrent();},Math.max(0,remaining));
    return()=>clearTimeout(timer);
  },[visit?.id,visit?.expiresAt,data.serverNow]);
  const conversation=row?.frozen??row?.candidate;
  const friend=data.friends.find(f=>f.stable_id===(conversation?.friendId??visit?.friend_id));
  const answered=!!row?.choiceId;
  const completed=!!row?.done&&!exiting.current||(!answered&&visit?.myCompleted);
  const currentVisit=visit?.id===id?visit:null;
  const activeVisit=!!currentVisit&&currentVisit.id!==expiredId&&(!currentVisit.expiresAt||Date.parse(currentVisit.expiresAt)>Date.parse(data.serverNow));
  const available=!!conversation&&(answered||activeVisit&&!visit?.myCompleted);
  const intro=conversation?[conversation.scene,...conversation.lines].filter((line):line is string=>!!line):[];
  const choice=conversation?.choices.find(c=>c.id===row?.choiceId);
  const lines=answered?choice?.feedback??[]:intro;
  const step=row?.step??-1;
  const choosing=!answered&&step>=intro.length;
  const summary=answered&&step>=lines.length;
  const finish=()=>{
    if(exiting.current||runtime.read(id)?.step!==step)return;
    exiting.current=true;
    if(runtime.finish(id)){router.back();}
    else{exiting.current=false;setError('Your progress couldn’t be saved on this device. Please try again.');}
  };
  const advance=()=>{
    // A second event from the outgoing native drawing must not skip a line
    // the user has not seen yet during the compact transition.
    if(runtime.read(id)?.step!==step)return;
    if(!runtime.advance(id))setError('Your progress couldn’t be saved on this device. Please try again.');
  };
  const answer=(choiceId:string)=>{if(!runtime.answer(id,choiceId))setError('Your reply couldn’t be saved on this device. Please try again.');};
  const quiet=!available||completed;
  const state=friendVisitPresentation(currentVisit,data.serverNow,expiredId,row,!quiet);
  const waiting=state==='waiting'||state==='syncing';
  const stage=quiet?state:step<0?'invite':summary?'summary':choosing?'choices':`${answered?'reply':'intro'}:${step}`;
  const visitMode=quiet&&!waiting?'quiet':step<0&&!waiting?'invite':'dialogue';
  const dialogue=!quiet&&step>=0&&row?.status!=='rejected'&&!choosing;
  const gender=adventureFriendGender(undefined,friend,conversation?.friendId??visit?.friend_id);
  const invitePage={title:`${friend?.name??'A friend'} is here`,body:`${gender==='he'?'He':gender==='she'?'She':'They'} ${gender?'has':'have'} a little story to share.`,action:`Talk to ${friend?.name??'your visitor'}`};
  const summaryCopy='Thank you for sharing a little moment together.';
  const waitingPage={title:state==='syncing'?'Your reply is saved':`${friend?.name??'Your visitor'} is waiting`,
    body:state==='syncing'?'Your reply is saved on this device and will sync when connected.':visit?.waitingCopy??`Waiting for ${data.partner?.display_name??'your partner'} to share a little moment.`,action:'Back to Burrow'};
  const quietPage:FriendTextPage=state==='prepare'?{title:'Your visitor is getting ready',body:'Your conversation is being prepared.',action:'Prepare conversation'}:
    {title:'No visitors right now',body:"We'll let you know when a friend stops by.",action:'Back to Burrow',graphic:true,align:'center'};
  const choicePage={body:conversation?.question,options:conversation?.choices.map(c=>c.label)};
  const pages:FriendTextPage[]=quiet?[waiting?waitingPage:quietPage]:[invitePage,choicePage,{body:summaryCopy,hint:true},
    ...intro.map(body=>({body,hint:true})),...(conversation?.choices.flatMap(c=>c.feedback.map(body=>({body,hint:true})))??[])];
  return <View style={s.root}>
    {/* Lift the room's existing view, without stretching its artwork, so the
        chairs and table remain above the welcome/quiet card. */}
    <Image source={BURROW_BACKGROUNDS.friendsRoom} contentFit="cover" style={[StyleSheet.absoluteFillObject,{transform:[{translateY:-screenHeight*.12}]}]}/>
    <View style={[s.content,{paddingTop:insets.top+42,paddingBottom:insets.bottom+16}]}>
      <AdventureEncounterLayout friendName={friend?.name} answered={answered||waiting} visitMode={visitMode} pages={pages}>
        <AdventureStageTransition compact stageKey={stage}>
          {dialogue?<FriendDialogue key={`${answered?'reply':'intro'}:${step}`} onPress={summary?finish:advance}
            onVisible={answered&&step===0&&!summary?()=>runtime.rewardReady?.(id,owner):undefined}>{summary?summaryCopy:lines[step]}</FriendDialogue>:
            quiet?<FriendTextPanel page={waiting?waitingPage:quietPage} error={error}
              graphic={!waiting&&quietPage.graphic?<FriendRoomEmptyIcon/>:undefined}
              onAction={state==='prepare'?()=>{void warmFriendVisit(data).catch(()=>setError('Your conversation is safe. Please try again.'));}:()=>router.back()}/>:
            step<0?<FriendTextPanel page={{...invitePage,welcome:'visit'}} onAction={advance} error={error}/>:
            row?.status==='rejected'?<FriendTextPanel page={{body:'This visit could not be completed. Your balance will sync automatically.',action:'Back to Burrow'}} onAction={()=>router.back()} error={error}/>:
            choosing?<FriendTextPanel page={choicePage} onChoice={index=>answer(conversation!.choices[index].id)} error={error}/>:null}
        </AdventureStageTransition>
      </AdventureEncounterLayout>
    </View>
    <View style={[s.header,{top:insets.top+8}]}><BurrowBackButton light onPress={()=>router.back()}/>
      <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={[s.headerTitle,ROOM_TITLE_STYLE]}>Friend's Room</Text></View>
  </View>;
}
const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#854222'},content:{flex:1},
  header:{position:'absolute',left:16,right:16,flexDirection:'row',alignItems:'center',gap:12,height:44},
  headerTitle:{flex:1,fontSize:23,lineHeight:30,fontWeight:'800',color:'#FFF9EF'},
});
