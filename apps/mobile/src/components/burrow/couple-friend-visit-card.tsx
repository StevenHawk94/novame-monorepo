import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import {AdventureReveal} from './adventure-reveal';
import {BurrowBackButton} from './burrow-back-button';
import {ROOM_TITLE_STYLE} from '@/lib/room-header-typography';

/** One fixed actor stage from welcome through the final reply. A frozen
 * presentation survives background sync removing a completed visitor. */
export function CoupleFriendVisitCard({data,runtime=friendVisitLocal}:{data:MajorUpdateBootstrap;busy?:boolean;showArt?:boolean;runtime?:typeof friendVisitLocal}) {
  const visit=data.friendVisit?.version===2?data.friendVisit:null;
  const [id,setId]=useState(()=>visit?.id??'');
  const row=useSyncExternalStore(runtime.subscribe,()=>runtime.read(id),()=>undefined),insets=useSafeAreaInsets();
  const [error,setError]=useState<string|null>(null);
  const exiting=useRef(false);
  const owner=data.profile.id;
  const focused=useIsFocused();
  useEffect(()=>{if(!focused)runtime.dismissReward?.(id,owner);},[focused,id,owner,runtime]);
  useEffect(()=>()=>runtime.dismissReward?.(id,owner),[id,owner,runtime]);
  const {height:screenHeight}=useWindowDimensions();
  useEffect(()=>{if(!id&&visit)setId(visit.id);},[id,visit?.id]);
  useLayoutEffect(()=>{if(id&&row&&!row.frozen&&!runtime.open(id))setError('Your conversation couldn’t be saved on this device. Please try again.');},[id,row?.frozen,row?.candidate,runtime]);
  useEffect(()=>{if(!visit?.expiresAt)return;
    const timer=setTimeout(()=>void refreshBurrowAfterCurrent(),Math.max(0,Date.parse(visit.expiresAt)-Date.parse(data.serverNow)));
    return()=>clearTimeout(timer);
  },[visit?.id,visit?.expiresAt,data.serverNow]);
  const conversation=row?.frozen??row?.candidate;
  const friend=data.friends.find(f=>f.stable_id===(conversation?.friendId??visit?.friend_id));
  const answered=!!row?.choiceId;
  const completed=!!row?.done&&!exiting.current||(!answered&&visit?.myCompleted);
  const available=!!conversation&&(answered||visit?.id===id&&!visit.myCompleted);
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
  const button=(label:string,press:()=>void,choice=false)=><Pressable accessibilityRole="button" onPress={press}
    style={({pressed})=>[s.button,choice&&s.choiceButton,pressed&&s.pressed]}><Text style={[s.buttonText,choice&&s.choiceText]}>{label}</Text></Pressable>;
  const stage=!available||completed?'quiet':step<0?'invite':summary?'summary':choosing?'choices':`${answered?'reply':'intro'}:${step}`;
  const quiet=!available||completed;
  const visitMode=quiet?'quiet':step<0?'invite':'dialogue';
  const dialogue=!quiet&&step>=0&&row?.status!=='rejected'&&!choosing;
  return <View style={s.root}>
    {/* Lift the room's existing view, without stretching its artwork, so the
        chairs and table remain above the welcome/quiet card. */}
    <Image source={BURROW_BACKGROUNDS.friendsRoom} contentFit="cover" style={[StyleSheet.absoluteFillObject,{transform:[{translateY:-screenHeight*.12}]}]}/>
    <View style={[s.content,{paddingTop:insets.top+42,paddingBottom:insets.bottom+16}]}>
      <AdventureEncounterLayout friendName={friend?.name} answered={answered} visitMode={visitMode}>
        <AdventureStageTransition compact stageKey={stage}>
          {dialogue?<FriendDialogue key={`${answered?'reply':'intro'}:${step}`} onPress={summary?finish:advance}
            onVisible={answered&&step===0&&!summary?()=>runtime.rewardReady?.(id,owner):undefined}>{summary?'Thank you for sharing a little moment together.':lines[step]}</FriendDialogue>:<ScrollView bounces={false} showsVerticalScrollIndicator={false} style={s.scroll}
            contentContainerStyle={[s.panel,(quiet||step<0)&&s.welcome,quiet&&s.quiet]}>
            {quiet?<>
              <View style={s.welcomeWords}>
                <FriendRoomEmptyIcon/>
                <Text style={s.welcomeTitle}>No visitors right now</Text>
                <Text style={s.welcomeCopy}>We'll let you know when a friend stops by.</Text>
              </View>
              {!conversation&&visit&&!visit.myCompleted&&button('Prepare conversation',()=>{void warmFriendVisit(data).catch(()=>setError('Your conversation is safe. Please try again.'));})}
              {button('Back to Burrow',()=>router.back())}
            </>:<>
              {step<0?<>
                <View style={s.welcomeWords}>
                  <Text style={s.visitorBadge}>VISITOR</Text>
                  <Text style={s.welcomeTitle}>{friend?.name??'A friend'} is here</Text>
                  <Text style={s.welcomeCopy}>They have a little story to share.</Text>
                </View>
                <AdventureReveal delay={180} style={s.fullWidth}>{button(`Talk to ${friend?.name??'your visitor'} →`,advance)}</AdventureReveal>
              </>:row?.status==='rejected'?<>
                <Text accessibilityRole="alert" style={s.copy}>This visit could not be completed. Your balance will sync automatically.</Text>
                {button('Back to Burrow',()=>router.back())}
              </>:choosing?<>
                <AdventureReveal><Text style={s.copy}>{conversation!.question}</Text></AdventureReveal>
                {conversation!.choices.map((option,index)=><AdventureReveal key={option.id} delay={180+index*50}>
                  {button(option.label,()=>answer(option.id),true)}
                </AdventureReveal>)}
              </>:null}
            </>}
          </ScrollView>}
          {error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        </AdventureStageTransition>
      </AdventureEncounterLayout>
    </View>
    <View style={[s.header,{top:insets.top+8}]}><BurrowBackButton light onPress={()=>router.back()}/>
      <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={[s.headerTitle,ROOM_TITLE_STYLE]}>Friend's Room</Text></View>
  </View>;
}
const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#854222'},content:{flex:1},scroll:{flex:1},
  header:{position:'absolute',left:16,right:16,flexDirection:'row',alignItems:'center',gap:12,height:44},
  headerTitle:{flex:1,fontSize:23,lineHeight:30,fontWeight:'800',color:'#FFF9EF'},
  panel:{padding:20,gap:16,flexGrow:1,justifyContent:'center'},
  welcome:{paddingHorizontal:24,paddingVertical:20,alignItems:'center',justifyContent:'space-between',gap:16},quiet:{paddingVertical:12,gap:12},
  welcomeWords:{flexGrow:1,justifyContent:'center',alignItems:'center',gap:10,width:'100%'},fullWidth:{width:'100%'},
  welcomeTitle:{fontSize:27,lineHeight:34,fontWeight:'800',color:'#4F2C19',textAlign:'center'},
  welcomeCopy:{fontSize:18,lineHeight:25,fontWeight:'400',color:'#806A58',textAlign:'center',maxWidth:290},
  visitorBadge:{overflow:'hidden',borderRadius:20,backgroundColor:'#C76B4E',paddingHorizontal:20,paddingVertical:7,color:'#FFF9EF',fontSize:13,lineHeight:18,fontWeight:'800'},
  copy:{color:'#4F2C19',fontSize:22,lineHeight:30,fontWeight:'700',textAlign:'left',width:'80%',alignSelf:'center'},
  button:{paddingHorizontal:16,paddingVertical:12,minHeight:54,width:'100%',justifyContent:'center',borderRadius:28,backgroundColor:'#6B3B24'},
  buttonText:{color:'#FFF9EF',fontSize:20,lineHeight:26,fontWeight:'800',textAlign:'center'},
  choiceButton:{backgroundColor:'#F8E6D9',borderWidth:1.5,borderColor:'#C8663A',borderRadius:17,minHeight:48},choiceText:{color:'#1E1712',fontSize:19,lineHeight:25,fontWeight:'700'},
  pressed:{transform:[{translateY:3}],opacity:.85},error:{fontSize:15,color:'#A13B24',padding:12,textAlign:'center'},
});
