import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { NativeVerticalGradient } from './native-vertical-gradient';
import { ADVENTURE_PROGRESS_COLORS } from '@/lib/burrow-surface';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdventureDiggingRoute } from './adventure-digging-route';
import { BurrowBackButton } from './burrow-back-button';
import { adventureCountdown, adventureOrdinal, adventureProgressLayout } from '@/lib/adventure-screen-layout';
import { createAdventurePresentationClock } from '@/lib/adventure-presentation-clock';
import { burrowClock } from '@/lib/burrow-store';
import { retryAdventureJournalJob, useAdventureJournalJob } from '@/lib/adventure-journal-jobs';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import {adventureModeCopy,teamStateFor} from '@/lib/cooperative-adventure';
import {queueAdventureNudge,useAdventureNudge} from '@/lib/adventure-nudge';
import {useBunnyVariant} from '@/lib/bunny-identity';
import {showBurrowToast} from '@/lib/burrow-toast';

export function AdventureProgressScreen({data,now,onHome}:{data:MajorUpdateBootstrap;now:number;onHome:()=>void}) {
  const {width,height}=useWindowDimensions(),insets=useSafeAreaInsets();
  const journal=useAdventureJournalJob();
  const layout=adventureProgressLayout(width,height,insets.top,insets.bottom,64+(journal?.error?30:0)),scale=layout.scale;
  const journey=data.activeAdventure!;
  const coordination=teamStateFor(data),team=coordination?.team;
  const variant=useBunnyVariant();
  const nudge=useAdventureNudge(team?.id);
  const plus=team?.plus??data.hasPlus,couple=!!team?.followerId;
  const mode=adventureModeCopy(plus,couple,data.partner?.display_name||'your partner');
  // Unknown coordination is not an unpaired/Solo fact. Entry already knows
  // the confirmed partner while the personal Start receipt reconciles.
  const canInvite=!!data.partner&&(!coordination||coordination.nudgeAvailable);
  const footerCopy=!couple&&!canInvite
    ?`${plus?'You’re enjoying 2x adventure speed.':'Join Plus to finish 2x faster.'}\n${!data.partner?'Connect a partner to team up on a future adventure.':'Each bunny keeps their own adventure rewards.'}`
    :mode.copy;
  const pending=journey.id.startsWith('pending:')||journey.localStartPending===true;
  const scope=`${data.profile.id}:${data.partner?.id??'solo'}:${data.pairVersion??''}`;
  const clock=useRef(createAdventurePresentationClock());
  // The queue's receipt is persisted just before the Bootstrap projection.
  // Its selector may briefly return no job between those two notifications;
  // that must not create a new clock/character lifetime.
  const display=clock.current.read({identity:scope,adventureId:journey.id,pending,
    startedAt:journey.started_at,endsAt:journey.ends_at,now,clockNow:burrowClock(),team});
  const {progress,remaining}=display;
  const completed=data.specialQuests.find(quest=>quest.questId==='adventures_completed')?.progress;
  const ordinal=adventureOrdinal(typeof completed==='number'?completed+1:null);
  return <View style={s.root}>
    <NativeVerticalGradient colors={ADVENTURE_PROGRESS_COLORS} style={StyleSheet.absoluteFillObject}/>
    <View style={[s.header,{top:layout.headerTop,height:layout.headerHeight}]}>
      <Text style={[s.title,{fontSize:Math.max(23,30*scale),lineHeight:Math.max(30,38*scale)}]}>Adventure</Text>
      <Text style={[s.subtitle,{fontSize:Math.max(16,22*scale),lineHeight:Math.max(23,30*scale)}]}>Your {ordinal}adventure</Text>
    </View>
    <BurrowBackButton light onPress={onHome} style={{position:'absolute',left:26*scale,top:layout.headerTop,width:Math.max(44,60*scale),height:Math.max(44,60*scale),borderRadius:30*scale}}/>
    {plus&&<View style={[s.plus,{right:24*scale,top:layout.headerTop+8}]}><Text style={s.plusText}>Plus</Text></View>}
    <View style={{position:'absolute',left:layout.routeLeft,top:layout.routeTop}}>
      {/* This ongoing page owns one journey. Pending record/adventure IDs are
          aliases, not a new character/animation lifetime. Scope changes reset. */}
      <AdventureDiggingRoute key={`${scope}:${display.lifetime}`} progress={progress} remaining={remaining} pending={pending}
        motion={display.motion} timeline={display.timeline} scale={layout.routeScale}
        leaderVariant={team?.leaderVariant??variant} followerVariant={team?.followerId?team.followerVariant:undefined}/>
    </View>
    <View style={[s.status,{top:layout.statusTop,height:layout.statusHeight}]}>
      <Text style={[s.digging,{height:layout.diggingHeight,fontSize:Math.max(22,30*scale),lineHeight:layout.diggingHeight}]}>Digging...</Text>
      <Text style={[s.time,{marginTop:20*scale,height:layout.timeHeight,fontSize:Math.max(40,58*scale),lineHeight:layout.timeHeight}]}>{adventureCountdown(remaining).padStart(8,'0')}</Text>
      <Text style={[s.caption,{marginTop:10*scale,height:layout.captionHeight,fontSize:Math.max(15,23*scale),lineHeight:layout.captionHeight}]}>Until your bunny returns</Text>
    </View>
    {journal?.error&&<Pressable accessibilityRole="button" accessibilityLabel="Retry syncing adventure record" style={[s.sync,{bottom:layout.footerBottom+layout.buttonHeight+70}]} onPress={()=>retryAdventureJournalJob(journal.id)}>
      <Text numberOfLines={2} style={s.syncNote}>Your day is saved on this device. {journal.blocked?'Tap to retry syncing.':'We’ll sync when connected.'}</Text>
    </Pressable>}
    <View style={{position:'absolute',left:28*scale,right:28*scale,bottom:layout.footerBottom,width:undefined}}>
      {couple?<View accessibilityRole="text" style={[s.mode,{height:layout.buttonHeight}]}><Text style={[s.homeText,{fontSize:Math.max(18,23*scale)}]}>{mode.label}</Text></View>
       :<Pressable accessibilityRole="button" disabled={!coordination?.nudgeAvailable||pending||remaining<=600000||nudge==='queued'||nudge==='sent'||!!team?.nudged}
        onPress={()=>{try{if(team){queueAdventureNudge(team.id);showBurrowToast('Reminder submitted ✓');}}catch{showBurrowToast('Could not save the invitation. Please try again.');}}}
        style={({pressed})=>[s.mode,{height:layout.buttonHeight},pressed&&s.pressed]}>
        <Text style={[s.homeText,{fontSize:Math.max(18,23*scale)}]}>{nudge==='queued'||nudge==='sent'||team?.nudged?'Reminder submitted ✓':!data.partner?'Solo Adventure':remaining<=600000?'Your bunny is almost back':coordination&&!coordination.nudgeAvailable?'Solo Adventure':mode.label}</Text>
       </Pressable>}
      <Text style={[s.modeCopy,{fontSize:Math.max(12,14*scale)}]}>{footerCopy}</Text>
    </View>
  </View>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#360e02'},
  header:{position:'absolute',left:'22%',right:'22%',alignItems:'center',justifyContent:'center'},
  title:{fontFamily:'Inter_800ExtraBold',color:'#FFF9F2',textAlign:'center'},
  subtitle:{fontFamily:'Inter_600SemiBold',color:'#DAC9BD',textAlign:'center'},
  status:{position:'absolute',left:12,right:12,alignItems:'center'},
  digging:{fontFamily:'Inter_800ExtraBold',color:'#FFF9F2',textAlign:'center'},
  time:{fontFamily:'Inter_800ExtraBold',fontVariant:['tabular-nums'],color:'#FFFFFF',textAlign:'center'},
  caption:{fontFamily:'Inter_600SemiBold',color:'#E9D9CD',textAlign:'center'},
  home:{position:'absolute',overflow:'hidden',alignItems:'center',justifyContent:'center'},
  homeText:{fontFamily:'Inter_800ExtraBold',color:'#402000'},pressed:{transform:[{translateY:2}],opacity:.9},
  sync:{position:'absolute',left:24,right:24},syncNote:{fontSize:11,lineHeight:12,color:'#FFF3E5',textAlign:'center'},
  mode:{backgroundColor:'#FFC13D',borderRadius:24,alignItems:'center',justifyContent:'center',paddingHorizontal:10},
  modeCopy:{color:'#FFF9F2',textAlign:'center',lineHeight:19,marginTop:14},plus:{position:'absolute',backgroundColor:'#FFC13D',paddingHorizontal:15,paddingVertical:6,borderRadius:10},plusText:{fontFamily:'Inter_800ExtraBold',fontSize:17,color:'#49270F'},
});
