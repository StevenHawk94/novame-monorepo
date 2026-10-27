import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TurboModuleRegistry, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BURROW_ART, burrowArtForItem } from '@/lib/burrow-art-assets';
import { roomSlots } from '@/lib/burrow-presentation';
import { refillRoomNeed } from '@/lib/app-major-update-api';
import { getBurrowSnapshot, runBurrowAction, useBurrow } from '@/lib/burrow-store';
import { beginCareSubmission, careCoolingDown, markCareCompleted } from '@/lib/burrow-care-cooldown';
import { CareStatusDialog } from '@/components/burrow/care-status-dialog';
import { TOY_PHOTO_DAILY_LIMIT_MESSAGE, TOY_PHOTO_DAILY_LIMIT_TITLE } from '@/lib/room-photo-errors';
import { BurrowBackButton } from '@/components/burrow/burrow-back-button';
import { FeedInteraction, WaterInteraction } from '@/components/burrow/care-interaction';
import { CareQuestCelebration } from '@/components/burrow/care-quest-celebration';
import { InteractiveDoll } from '@/components/burrow/interactive-doll';
import { DollPhotoPreview } from '@/components/burrow/doll-photo-preview';
import type { LocalizedToy as LocalizedToyComponent } from '@/components/burrow/localized-toy';
import { RoomPhotoEditor } from '@/components/burrow/room-photo';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { toyPhotoFor, toyPhotoChangedToday } from '@/lib/burrow-toy-photos';
import { LoveNoteScreen } from '@/components/burrow/love-note-screen';
import { usePageBackGesture } from '@/lib/use-page-back-gesture';
import { recordToyInteraction, flushToyInteractions } from '@/lib/toy-interaction-records';
import { recordPhotoToyPlayForRating } from '@/lib/official-rating-milestones';
import { showBurrowToast } from '@/lib/burrow-toast';
import { PlushieRoomBackground } from '@/components/burrow/plushie-room-background';
import { plushieFloorY } from '@/lib/plushie-room-layout';
import {TouchNoteEntry} from '@/components/burrow/touch-note-entry';

type Kind='toy'|'food'|'water'|'frame'|'letter';
const kinds:Kind[]=['toy','food','water','frame','letter'];
// Metro reload cannot add a native module to an already-installed dev app.
// Keep that binary launchable until it is rebuilt with Skia.
let LocalizedToy:typeof LocalizedToyComponent|null=null;
if(Platform.OS==='web'||(globalThis as {SkiaApi?:unknown}).SkiaApi||TurboModuleRegistry.get('RNSkiaModule')){
  try{LocalizedToy=require('@/components/burrow/localized-toy').LocalizedToy;}
  catch{LocalizedToy=null;}
}

function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,(disabled||pressed)&&{opacity:.6}]}><Text style={styles.photoButtonText}>{label}</Text></Pressable>;
}

export default function RoomInteractionScreen(){
  const params=useLocalSearchParams<{kind?:string;ownerId?:string;actorId?:string;pairVersion?:string;compose?:string}>();
  const kind=kinds.includes(params.kind as Kind)?params.kind as Kind:'toy';
  const {data,loading}=useBurrow(false,kind==='toy'?'plushie':undefined);
  const ownerId=params.ownerId??data?.profile.id;
  const targetAllowed=!!data&&(!params.pairVersion||params.pairVersion===data.pairVersion)
    &&((!params.ownerId||params.ownerId===data.profile.id)
    || (['food','water','toy'].includes(kind)&&ownerId===data.partner?.id&&params.actorId===data.profile.id));
  const ownToy=!!data&&ownerId===data.profile.id;
  const insets=useSafeAreaInsets();
  const {width,height}=useWindowDimensions();
  const [photoMode,setPhotoMode]=useState<'camera'|'library'|null>(null);
  const [photoChoiceOpen,setPhotoChoiceOpen]=useState(false);
  const [toyMenuOpen,setToyMenuOpen]=useState(false);
  const [toyStageHeight,setToyStageHeight]=useState<number|null>(null);
  const [toyStageY,setToyStageY]=useState(52);
  const [toyInnerHeight,setToyInnerHeight]=useState<number|null>(null);
  const [toyPageHeight,setToyPageHeight]=useState<number|null>(null);
  const [photoChangeUsed,setPhotoChangeUsed]=useState(false);
  const [completed,setCompleted]=useState(false);
  const [careCelebration,setCareCelebration]=useState<'food'|'water'|null>(null);
  const [careStatus,setCareStatus]=useState<'food'|'water'|null>(null);
  const careScope=`${data?.profile.id??''}:${data?.partner?.id??''}:${data?.pairVersion??''}:${ownerId??''}:${kind}`;
  const activeCareScope=useRef(careScope);activeCareScope.current=careScope;
  const careOperation=useRef<object|null>(null);
  const careExitRequested=useRef(false);
  const isCare=kind==='food'||kind==='water';
  const careBlocked=!!data&&targetAllowed&&!!ownerId&&isCare&&!completed&&!careOperation.current
    &&careCoolingDown(data,kind,Date.now(),ownerId);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;careOperation.current=null;};},[]);
  useEffect(()=>{careOperation.current=null;careExitRequested.current=false;setCareCelebration(null);setCareStatus(null);setCompleted(false);},[careScope]);
  useEffect(()=>{if(careBlocked&&(kind==='food'||kind==='water'))setCareStatus(kind);},[careBlocked,careScope]);
  const [retry,setRetry]=useState(0);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>()=>{if(kind==='toy')flushToyInteractions();},[kind]);
  const slots=useMemo(()=>data&&targetAllowed?roomSlots(data,ownerId!):{},[data,ownerId,targetAllowed]);
  const toy=burrowArtForItem(slots.couple_doll,'couple_dolls')??BURROW_ART.couple_dolls[0];
  const flower=burrowArtForItem(slots.vase,'vases')??BURROW_ART.vases[0];
  const toyId=slots.couple_doll?.stable_id;
  const toyPhoto=data&&ownerId?toyPhotoFor(data.roomPhotos,ownerId,toyId):undefined;
  const toyPhotoChangeUsed=!!data&&toyPhotoChangedToday(data,toyId,ownerId)||photoChangeUsed;
  // Match the actual header (68), subtitle (52) and body padding (24) on
  // first paint, rather than moving the room seam after the first onLayout.
  const stageHeight=toyStageHeight??Math.max(1,height-insets.top-insets.bottom-144
    -(!ownToy||!toyPhoto?54:0)-(ownToy&&!LocalizedToy?22:0));
  const touchBody=Math.max(300,height-insets.top-68);
  const size=toyPhoto?Math.min(width*.94,touchBody*.43,420):Math.max(1,Math.min(width-40,Math.max(270,Math.min(height*.51,500)),stageHeight-(ownToy&&toyPhoto?78:0)));
  const scale=Math.min(size/toy.width,size/toy.height);
  const artStyle={position:'absolute' as const,left:(size-toy.width*scale)/2,top:(size-toy.height*scale)/2,width:toy.width*scale,height:toy.height*scale};
  const floorY=plushieFloorY(toy,scale,artStyle.top,size,toyPhoto?toyStageY:0,ownToy&&toyPhoto?toyInnerHeight??Math.max(1,stageHeight-78):stageHeight);
  useEffect(()=>{setCompleted(false);setError(null);setRetry(0);setPhotoMode(null);setPhotoChoiceOpen(false);setToyMenuOpen(false);},[kind,ownerId,targetAllowed,toyId]);
  useEffect(()=>setPhotoChangeUsed(false),[data?.profile.id,data?.localDate,toyId,ownerId]);
  function finishCare(which:'food'|'water'){
    if(!data||!targetAllowed||!ownerId||careOperation.current||completed)return;
    if(careCoolingDown(data,which,Date.now(),ownerId)){
      setCareStatus(which);
      setRetry(n=>n+1);
      return;
    }
    const operation={},targetId=ownerId,scope=careScope,epoch=sessionEpoch();
    careOperation.current=operation;
    const releaseSubmission=beginCareSubmission(data,which,targetId);
    let rejectedCode:string|undefined;
    // Completion feedback belongs to the final bite/drop, not the round-trip
    // or a second celebration phase. Only confirmed saves start the cooldown.
    setCompleted(true);setError(null);setCareCelebration(which);
    void runBurrowAction(`${which}:${targetId}`,key=>refillRoomNeed(targetId,which,key),{silent:true,
      expectedErrors:['already_full','care_cooldown'],onError:error=>{
        const failure=error as {body?:{error?:string};message?:string};
        rejectedCode=failure?.body?.error??failure?.message;
      }}).then(ok=>{
      releaseSubmission();
      if(epoch!==sessionEpoch())return;
      // The shared store keeps saving/reconciling after Done unmounts this
      // screen. Record confirmed cooldowns only for the same account/pair.
      const current=getBurrowSnapshot().data;
      if(!current||`${current.profile.id}:${current.partner?.id??''}:${current.pairVersion??''}:${targetId}:${which}`!==scope)return;
      if(ok)markCareCompleted(targetId,which);
      if(!mounted.current||careExitRequested.current||activeCareScope.current!==scope||careOperation.current!==operation)return;
      careOperation.current=null;
      if(!ok){
        setCareCelebration(null);setCompleted(false);setRetry(n=>n+1);
        const code=rejectedCode??getBurrowSnapshot().error;
        if(code==='care_cooldown'||code==='already_full')setCareStatus(which);
        else setError('That did not save. Please try again.');
      }
    });
  }
  function leaveCompletedCare(){
    if(!mounted.current||activeCareScope.current!==careScope||!careCelebration||careExitRequested.current)return;
    careExitRequested.current=true;
    // Navigation never waits on the save; its durable command continues in
    // the shared store without navigating or updating this screen again.
    setCareCelebration(null);
    if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)');
  }
  function leaveFullCare(){
    if(careExitRequested.current)return;
    careExitRequested.current=true;setCareStatus(null);
    if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)');
  }
  function recordToy(){
    if(!data||!targetAllowed||!ownToy||!toyPhoto)return;
    recordToyInteraction(slots.couple_doll?.stable_id);
    recordPhotoToyPlayForRating(data.profile.id,toyId,toyPhoto?.id);
  }
  function openToyPhotoChoice(){
    if(!targetAllowed)return;
    if(toyPhoto?.id.startsWith('local-plushie-')){showBurrowToast('Your photo is syncing. Please try again shortly.');return;}
    if(toyPhotoChangeUsed){Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE,TOY_PHOTO_DAILY_LIMIT_MESSAGE);return;}
    setPhotoChoiceOpen(true);
  }
  function selectPhoto(source:'camera'|'library'){
    setPhotoChoiceOpen(false);
    if(toyPhoto?.id.startsWith('local-plushie-')){showBurrowToast('Your photo is syncing. Please try again shortly.');return;}
    if(toyPhotoChangeUsed){Alert.alert(TOY_PHOTO_DAILY_LIMIT_TITLE,TOY_PHOTO_DAILY_LIMIT_MESSAGE);return;}
    const scope=careScope,epoch=sessionEpoch();
    setTimeout(()=>{if(mounted.current&&epoch===sessionEpoch()&&activeCareScope.current===scope)setPhotoMode(source);},320);
  }
  const partnerCare=!!data&&ownerId!==data.profile.id;
  usePageBackGesture(kind !== 'frame' && !photoMode
    && !photoChoiceOpen && !toyMenuOpen && !careCelebration && !careStatus && !careBlocked);
  const partnerName=data?.partner?.display_name?.trim()||'your person';
  const title={toy:toyPhoto?ownToy?'Your Plushie':`${partnerName}’s Plushie`:'Make a Plushie',food:partnerCare?`Feed ${partnerName}'s bunny`:'Feed your bunny',water:partnerCare?`Water ${partnerName}'s flower`:'Water your flower',frame:'Photo Frame',letter:'Love Note'}[kind];
  if(!data)return <View style={styles.root}><View style={{paddingTop:insets.top+15,paddingHorizontal:18}}><BurrowBackButton onPress={()=>router.back()}/></View><View style={styles.center}>{loading?<ActivityIndicator color="#5C3D2B"/>:<Text style={styles.caption}>Your room could not load. Please try again.</Text>}</View></View>;
  if(!targetAllowed)return <View style={[styles.root,{paddingTop:insets.top+12,paddingHorizontal:18}]}><BurrowBackButton onPress={()=>router.back()}/><View style={styles.center}><Text style={styles.caption}>Your connection changed. Return to the room to try again.</Text></View></View>;
  if(kind==='frame')return <View style={[styles.root,{paddingTop:insets.top}]}><RoomPhotoEditor embedded data={data} ownerId={data.profile.id} kind="frame" onClose={()=>router.back()}/></View>;
  if(kind==='letter')return <LoveNoteScreen key={`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}:${params.compose??''}`} data={data} compose={params.compose==='1'}/>;
  const careHeight=Math.max(1,height-insets.top-insets.bottom-68);
  return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.root} keyboardVerticalOffset={0}>
    <View style={[styles.header,kind==='toy'&&styles.plushieHeader,{paddingTop:insets.top+12}]}><BurrowBackButton light={kind==='toy'} onPress={()=>router.back()}/><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.85} style={[styles.headerTitle,isCare&&styles.careHeaderTitle,kind==='toy'&&styles.plushieHeaderTitle]}>{title}</Text>{kind==='toy'?<Pressable accessibilityRole="button" accessibilityLabel={ownToy?'Toy menu':'Touch Note History'} accessibilityState={{expanded:toyMenuOpen}} onPress={()=>{if(ownToy)setToyMenuOpen(value=>!value);else router.push({pathname:'/(main)/plushie-touch',params:{mode:'history',pairVersion:data.pairVersion}});}} style={styles.headerAction}><Feather name={ownToy?'more-vertical':'clock'} size={25} color="#FFFFFF"/></Pressable>:<View style={{width:44}}/>}</View>
    {kind==='toy'?<View style={styles.toyPage} onLayout={event=>setToyPageHeight(event.nativeEvent.layout.height)}>
      <PlushieRoomBackground wallpaper={slots.wallpaper} width={width} height={(toyPageHeight??Math.max(1,height-insets.top-insets.bottom-68))+insets.bottom}
        floorY={toyPhoto?touchBody*.56:floorY} bottomInset={insets.bottom}/>
      {ownToy&&toyPhoto&&data.partner&&<TouchNoteEntry scope={`${data.profile.id}:${data.partner.id}:${data.pairVersion??''}`} pairVersion={data.pairVersion}/>}
      <View testID="plushie-play-area" style={[styles.toyStage,toyPhoto&&{flex:undefined,position:'absolute',top:touchBody*.27,left:(width-size)/2,width:size,height:touchBody*.73}]} onLayout={event=>{setToyStageHeight(event.nativeEvent.layout.height);setToyStageY(event.nativeEvent.layout.y??52);}}>
      {/* An empty face is a photo-entry preview, never a live toy controller.
          Both Skia and native fallback therefore stay still: no rub, pull,
          particles, haptics or task/rating recording before a local photo. */}
      {!ownToy||!toyPhoto?<View style={toyPhoto?undefined:styles.toyPreview}><DollPhotoPreview asset={toy} photo={toyPhoto} style={{width:size,height:size,alignSelf:'center'}} artStyle={artStyle}
        onEditPhoto={openToyPhotoChoice} label={ownToy?'Add plushie photo':`Change ${partnerName}'s doll photo`}/></View>:LocalizedToy?<LocalizedToy key={slots.couple_doll?.stable_id} asset={toy} photo={toyPhoto} size={size} artStyle={artStyle}
        containerStyle={{width:size,height:touchBody*.73}} actionsStyle={{position:'absolute',top:touchBody*.73-insets.bottom-102,left:28-(width-size)/2,width:width-56}}
        onStageLayout={setToyInnerHeight} onInteract={()=>recordToy()} showActions={!!toyPhoto} interactionScope={`${careScope}:${slots.couple_doll?.stable_id}:${toyPhoto?.id??'empty'}`}/>
        :<InteractiveDoll key={slots.couple_doll?.stable_id} asset={toy} photo={toyPhoto} style={{width:size,height:size,alignSelf:'center'}} artStyle={artStyle}
         containerStyle={{width:size,height:touchBody*.73}} actionsStyle={{position:'absolute',top:touchBody*.73-insets.bottom-102,left:28-(width-size)/2,width:width-56}}
         onInteract={()=>recordToy()} showActions={!!toyPhoto} interactionScope={`${careScope}:${slots.couple_doll?.stable_id}:${toyPhoto?.id??'empty'}`}/>}
      </View>
      {!toyPhoto&&<Text style={[styles.toySubtitle,styles.toyEmptySubtitle]}>{ownToy?'Add your babe’s face and give them a squeeze.':`Add your face to let ${partnerName} squeeze`}</Text>}
      {(!ownToy||!toyPhoto)&&<View style={[styles.toyButtons,toyPhoto&&{position:'absolute',bottom:24,left:28,right:28}]}><Button label={toyPhoto?'Change Photo':'Add Photo'} onPress={openToyPhotoChoice}/></View>}
      {ownToy&&!LocalizedToy&&<Text style={styles.caption}>Rebuild the development app to enable local Toy deformation.</Text>}
    </View>:careBlocked?<View style={{flex:1}}/>:kind==='food'?<FeedInteraction key={retry} availableHeight={careHeight} complete={completed} onComplete={()=>finishCare('food')}/>
      :<WaterInteraction key={retry} availableHeight={careHeight} flower={flower} complete={completed} onComplete={()=>finishCare('water')}/>}
    {error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={{height:insets.bottom}}/>
    {kind==='toy'&&toyMenuOpen&&<View style={styles.toyMenuLayer}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close toy menu" style={StyleSheet.absoluteFillObject} onPress={()=>setToyMenuOpen(false)}/>
      <View accessibilityViewIsModal style={[styles.toyMenu,{top:insets.top+56}]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Touch Note History" onPress={()=>{setToyMenuOpen(false);router.push({pathname:'/(main)/plushie-touch',params:{mode:'history',pairVersion:data.pairVersion}});}} style={styles.toyMenuOption}><Feather name="clock" size={23} color="#4C2B22"/><Text style={styles.toyMenuText}>Touch Note History</Text></Pressable><View style={styles.toyMenuDivider}/>
        {ownToy&&<><Pressable accessibilityRole="button" accessibilityLabel="Plushies Collection" onPress={()=>{setToyMenuOpen(false);router.push('/(main)/toy-collection');}} style={styles.toyMenuOption}><Feather name="grid" size={23} color="#4C2B22"/><Text style={styles.toyMenuText}>Plushies Collection</Text></Pressable>
        <View style={styles.toyMenuDivider}/></>}
        <Pressable accessibilityRole="button" accessibilityLabel="Change Photo" onPress={()=>{setToyMenuOpen(false);openToyPhotoChoice();}} style={styles.toyMenuOption}><Feather name="image" size={23} color="#4C2B22"/><Text style={styles.toyMenuText}>Change Photo</Text></Pressable>
      </View>
    </View>}
    <Modal transparent visible={photoChoiceOpen} animationType="fade" presentationStyle="overFullScreen" onRequestClose={()=>setPhotoChoiceOpen(false)}><View style={styles.choiceScrim}><Pressable style={StyleSheet.absoluteFillObject} onPress={()=>setPhotoChoiceOpen(false)}/><View style={styles.choiceCard}><Text style={styles.choiceTitle}>Choose how to add photos</Text><Pressable accessibilityRole="button" onPress={()=>selectPhoto('camera')} style={styles.choiceButton}><Text style={styles.buttonText}>Take Photo</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>selectPhoto('library')} style={[styles.choiceButton,styles.choiceButtonSecondary]}><Text style={[styles.buttonText,{color:'#4C2B22'}]}>Upload Photo</Text></Pressable><Pressable onPress={()=>setPhotoChoiceOpen(false)} style={styles.choiceCancel}><Text style={styles.counterText}>Cancel</Text></Pressable></View></View></Modal>
    {careCelebration&&<CareQuestCelebration title={careCelebration==='food'?'Yum!':'Fresh and thirsty no more!'} message={partnerCare?careCelebration==='food'?`${partnerName}'s bunny is full and happy.`:`${partnerName}'s flower is feeling fresh and growing`:careCelebration==='food'?'Your bunny is full and happy.':undefined} onClose={leaveCompletedCare}/>}
    {careStatus&&<CareStatusDialog kind={careStatus} partnerName={partnerCare?partnerName:undefined} onClose={leaveFullCare}/>}
    {photoMode&&targetAllowed&&<RoomPhotoEditor key={`${kind}:${photoMode}:${careScope}:${toyId}`} data={data} ownerId={ownerId!} kind="doll" toyId={toyId} toyAsset={toy} initialSource={photoMode} captureOnly onDailyLimit={()=>setPhotoChangeUsed(true)} onClose={()=>setPhotoMode(null)}/>}
  </KeyboardAvoidingView>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#FFFAF2'},center:{flex:1,justifyContent:'center',alignItems:'center'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18,paddingBottom:12,borderBottomWidth:1,borderBottomColor:'#E9DED2'},
  plushieHeader:{backgroundColor:'#502B1E',borderBottomWidth:0},plushieHeaderTitle:{flex:1,paddingHorizontal:8,textAlign:'center',fontSize:22,color:'#FFFFFF'},
  headerTitle:{fontSize:23,fontWeight:'800',color:'#3F271B'},headerAction:{width:44,height:44,alignItems:'center',justifyContent:'center'},title:{fontSize:24,fontWeight:'800',color:'#3F271B',textAlign:'center'},caption:{fontSize:15,color:'#8B796B',textAlign:'center',lineHeight:22},
  careHeaderTitle:{flex:1,textAlign:'center',fontSize:20,paddingHorizontal:8},
  toyPage:{flex:1,paddingHorizontal:20,paddingBottom:24,overflow:'visible'},toyStage:{flex:1,minHeight:0,zIndex:1,overflow:'visible'},toyPreview:{flex:1,justifyContent:'center'},toyButtons:{flexDirection:'row',gap:12},
  toySubtitle:{fontSize:16,fontWeight:'400',color:'#745541',textAlign:'center',lineHeight:24,paddingTop:20,paddingBottom:8},
  toyEmptySubtitle:{color:'#FFFFFF',paddingTop:12,paddingBottom:16},
  toyMenuLayer:{...StyleSheet.absoluteFillObject,zIndex:20},toyMenu:{position:'absolute',right:18,width:200,backgroundColor:'#FFFCF7',borderRadius:15,borderWidth:1,borderColor:'#E4D6C5',paddingVertical:4,boxShadow:'0px 5px 18px #4C2B1E26'},toyMenuOption:{flexDirection:'row',alignItems:'center',gap:14,padding:16,minHeight:55},toyMenuText:{fontSize:15,color:'#3F271B'},toyMenuDivider:{height:1,backgroundColor:'#EEE3D5',marginHorizontal:12},
  button:{flex:1,minHeight:54,borderRadius:26,backgroundColor:'#FFD36F',alignItems:'center',justifyContent:'center',paddingHorizontal:18},photoButtonText:{fontSize:17,fontWeight:'800',color:'#4C2B1E',textAlign:'center'},buttonText:{fontSize:17,fontWeight:'800',color:'#FFF9F0',textAlign:'center'},
  counterText:{fontSize:14,color:'#9D6F5C'},
  choiceScrim:{flex:1,justifyContent:'center',paddingHorizontal:28,backgroundColor:'#21120BCC'},choiceCard:{backgroundColor:'#FFFAF2',padding:24,borderRadius:26,gap:14},choiceTitle:{fontSize:23,fontWeight:'800',color:'#4C2B22',textAlign:'center'},choiceButton:{height:54,borderRadius:28,backgroundColor:'#4C2B22',alignItems:'center',justifyContent:'center'},choiceButtonSecondary:{backgroundColor:'#F5DDC1'},choiceCancel:{alignItems:'center',padding:10},
  error:{textAlign:'center',color:'#A43B27',padding:12},
});
