import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,BackHandler,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Image} from './burrow-image';
import {useIsFocused,usePreventRemove} from '@react-navigation/native';
import {router,useLocalSearchParams} from 'expo-router';
import {Feather} from '@expo/vector-icons';
import {useSharedValue,useReducedMotion} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {TouchClip} from '@novame/domain';
import {useAppViewport} from '@/lib/app-viewport';
import {useBurrow} from '@/lib/burrow-store';
import {roomSlots} from '@/lib/burrow-presentation';
import {burrowArtForItem} from '@/lib/burrow-art-assets';
import {toyPhotoFor} from '@/lib/burrow-toy-photos';
import {createTouchRecorder,type TouchRecordingCheckpoint} from '@/lib/plushie-touch-recorder';
import {usePageBackGesture} from '@/lib/use-page-back-gesture';
import {showBurrowToast} from '@/lib/burrow-toast';
import {getInteractionPreferences,setInteractionPreference} from '@/lib/interaction-preferences';
import {touchCapabilities,touchInitialQuality,touchVisualOnly,testTouchVibration,touchVibrationVerified,confirmTouchVibration,type TouchCapabilities} from '@/lib/touch-note-runtime';
import {usePlushieTouches,touchMessage,touchDraft,saveTouchDraft,discardTouchDraft,touchGuideSeen,acknowledgeTouchGuide,
 touchRecording,saveTouchRecording,discardTouchRecording,queuePlushieTouch,refreshPlushieTouch,prepareTouchPage,prepareTouchMessage,
 markTouchPlayed,recoverTouchJob,discardBlockedTouchJob,pinTouchMessage,touchSnapshot,type TouchMessage} from '@/lib/plushie-touch-store';
import {BurrowBackButton} from './burrow-back-button';
import {PlushieRoomBackground} from './plushie-room-background';
import {PlushieTouchRecording,type RecordingStatus} from './plushie-touch-recording';
import {PlushieTouchPlayback} from './plushie-touch-playback';
import {PlushieTouchToy} from './plushie-touch-toy';
import {TouchHeartMeter} from './plushie-touch-heart';
import {TouchNoteButton as Action,TouchNoteDialog,TouchNoteIcon,touchNoteStyles as t} from './touch-note-ui';

type Composer={clip:TouchClip|null;initial:TouchRecordingCheckpoint|null;phase:'guide'|'recording'|'preview';toyId?:string;photoId?:string;jobKey?:string};
export function restoreTouchComposer():Composer{
 const draft=touchDraft(),recording=touchRecording(),finished=recording?.checkpoint.elapsedMs===60000;
 const clip=draft?.clip??(finished?createTouchRecorder(recording!.checkpoint).finishElapsed(60000):null);
 return {clip,initial:recording?.checkpoint??null,toyId:draft?.toyId??recording?.toyId,photoId:draft?.photoId??recording?.photoId,jobKey:draft?.recoveryKey,
  phase:clip||finished?'preview':recording?.checkpoint.started||touchGuideSeen()?'recording':'guide'};
}
export function PlushieTouchScreen(){
 const {mode,pairVersion,messageId}=useLocalSearchParams<{mode?:string;pairVersion?:string;messageId?:string}>(),inbox=mode==='inbox'||mode==='history';
 const {data}=useBurrow(false,'plushie'),state=usePlushieTouches(),insets=useSafeAreaInsets(),{width,height}=useAppViewport(),focused=useIsFocused(),reduced=useReducedMotion();
 const scope=`${data?.profile.id??''}:${data?.partner?.id??''}:${data?.pairVersion??''}`;
 const valid=!!data?.partner&&!!data.pairVersion&&state.scope===scope&&(!pairVersion||pairVersion===data.pairVersion);
 const [composer,setComposer]=useState(restoreTouchComposer),{clip,initial,phase}=composer;
 const [status,setStatus]=useState<RecordingStatus>({started:initial?.started??false,seconds:Math.ceil((60000-(initial?.elapsedMs??0))/1000),count:initial?.touches??0});
 const [attempt,setAttempt]=useState(0),[history,setHistory]=useState(mode==='history'),[discard,setDiscard]=useState(false);
 const [entryDismissed,setEntryDismissed]=useState(false);
 const [selected,setSelected]=useState<string|null>(messageId??null),[playState,setPlayState]=useState<'idle'|'playing'|'paused'|'finished'>('idle');
 const [activeMessage,setActiveMessage]=useState<TouchMessage|null>(null),[replay,setReplay]=useState(0),[error,setError]=useState<string|null>(null);
 const [caps,setCaps]=useState<TouchCapabilities|null>(null),[quality,setQuality]=useState<'full'|'standard'>('standard');
 const [hapticDialog,setHapticDialog]=useState(false),[hapticHelp,setHapticHelp]=useState(false),[hapticTested,setHapticTested]=useState(false),hapticConfirmed=useRef(touchVibrationVerified(data?.profile.id));
 const completeProgress=useSharedValue(1),leaving=useRef(false);
 const playbackRequest=useRef(0),liveScope=useRef(scope);liveScope.current=scope;
 useEffect(()=>()=>{playbackRequest.current++;},[]);
 useEffect(()=>{if(focused)setEntryDismissed(false);},[focused]);
 const rows=state.meta?.items??[],incoming=rows.filter(m=>m.recipient_id===data?.profile.id);
 const unread=incoming.find(m=>!m.read_at&&!state.seen.includes(m.id));
 const id=selected??messageId??unread?.id??incoming[0]?.id;
 const prepared=touchMessage(id),message=activeMessage??prepared,expired=!!id&&!!state.meta&&!rows.some(m=>m.id===id)&&!activeMessage;
 const owner=inbox?data?.partner?.id:data?.profile.id,slots=useMemo(()=>data&&owner?roomSlots(data,owner):{},[data,owner]);
 const selectedToy=!inbox&&composer.toyId?data?.catalog.find(item=>item.stable_id===composer.toyId):slots.couple_doll;
 const toy=burrowArtForItem(selectedToy,'couple_dolls'),toyId=selectedToy?.stable_id;
 const photo=data&&owner?(!inbox&&composer.photoId?data.roomPhotos.find(p=>p.id===composer.photoId&&p.ownerId===owner):toyPhotoFor(data.roomPhotos,owner,toyId)):undefined;
 const bodyHeight=Math.max(300,height-insets.top-68),size=Math.min(width*.94,bodyHeight*.43,420),toyTop=bodyHeight*.27;
 const locked=valid&&!inbox&&phase==='recording'&&status.started&&!!toy&&!!photo;
 const quota=state.meta?.remaining??0,quotaReady=state.meta?.version===2&&state.meta.sameDomain;
 const canRecord=status.started||!!initial?.started||!!quota&&quotaReady&&!photo?.id.startsWith('local-');
 const recording=!inbox&&phase==='recording'&&!!toy&&!!photo&&canRecord;
 const pending=state.jobs.some(j=>j.state==='queued');
 const quotaDialog=valid&&!inbox&&phase!=='preview'&&!status.started&&!!state.meta&&!quota&&!pending;
 const guide=valid&&!inbox&&phase==='guide'&&!quotaDialog;
 const playing=inbox&&playState!=='idle'&&!!message;
 const name=data?.partner?.display_name?.trim()||'Your person',count=clip?.touches??status.count;
 const ownReplay=message?.sender_id===data?.profile.id;
 usePreventRemove(locked,()=>{});
 usePageBackGesture(!locked&&!discard&&!hapticDialog&&!guide&&!quotaDialog);
 useEffect(()=>{if(!locked||!focused)return;const sub=BackHandler.addEventListener('hardwareBackPress',()=>true);return()=>sub.remove();},[locked,focused]);
 useEffect(()=>{void refreshPlushieTouch();},[scope]);
 const rowVersion=rows.map(m=>m.id).join(':');
 useEffect(()=>{let current=true;if(valid&&inbox&&rowVersion)void prepareTouchPage(0).catch(()=>{if(current)setError('Could not prepare your touch notes. Tap to retry.');});else if(valid&&inbox)setError(null);return()=>{current=false;};},[valid,inbox,rowVersion]);
 useEffect(()=>{
  let current=true;
  if(prepared)setError(e=>e==='Could not open this touch note. Tap to retry.'||e==='Could not prepare your touch notes. Tap to retry.'?null:e);
  else if(valid&&inbox&&id&&!expired)void prepareTouchMessage(id).catch(()=>{if(current)setError('Could not open this touch note. Tap to retry.');});
  return()=>{current=false;};
 },[valid,inbox,id,prepared,expired]);
 useEffect(()=>{let live=true;void touchCapabilities().then(c=>{if(live){setCaps(c);setQuality(touchInitialQuality(c,reduced));}});return()=>{live=false;};},[scope,reduced]);
 useEffect(()=>{pinTouchMessage(playing?message?.id??null:null);return()=>pinTouchMessage(null);},[playing,message?.id]);
 useEffect(()=>{
  const restored=restoreTouchComposer();setComposer(restored);setStatus({started:restored.initial?.started??false,seconds:Math.ceil((60000-(restored.initial?.elapsedMs??0))/1000),count:restored.initial?.touches??0});
  setPlayState('idle');setActiveMessage(null);setSelected(messageId??null);setHistory(mode==='history');setError(null);setDiscard(false);leaving.current=false;
  hapticConfirmed.current=touchVibrationVerified(data?.profile.id);setHapticDialog(false);setHapticTested(false);setHapticHelp(false);
 },[scope,messageId,mode]);
 function defaultPage(){
  if(leaving.current)return;leaving.current=true;setPlayState('idle');
  if(inbox&&data?.partner){router.replace({pathname:'/(main)/room-interaction',params:{kind:'toy',ownerId:data.partner.id,actorId:data.profile.id,pairVersion:data.pairVersion}});}
  else if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)');
 }
 function exit(){
  if(locked)return;
  if(playing){defaultPage();return;}
  if(history&&mode!=='history'){setHistory(false);setSelected(null);return;}
  if(!inbox&&phase==='preview'){setDiscard(true);return;}
  if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)');
 }
 const checkpoint=useCallback((c:TouchRecordingCheckpoint)=>{
  if(!toyId||!photo)throw Error('touch_not_ready');saveTouchRecording(toyId,photo.id,c,scope);
 },[toyId,photo?.id,scope]);
 const complete=useCallback((c:TouchClip)=>{
  setComposer(v=>({...v,clip:c,phase:'preview',toyId,photoId:photo?.id,jobKey:undefined}));setStatus(v=>({...v,seconds:0,count:c.touches}));
  try{if(!toyId||!photo)throw Error();saveTouchDraft(toyId,photo.id,c,scope);try{discardTouchRecording();}catch{}setError(null);}
  catch{setError('Your minute is complete and still here. Free up storage, then tap Send to retry saving.');}
 },[toyId,photo?.id,scope]);
 const incomplete=useCallback(()=>{setComposer(v=>({...v,phase:'preview'}));setStatus(v=>({...v,seconds:0}));setError('This recording could not be completed. Your saved progress is still available.');},[]);
 function send(){try{
  if(!clip||!toyId||!photo)throw Error('Your plushie or photo is unavailable.');
  const draft=touchDraft(),partial=touchRecording();
  if((draft&&(draft.toyId!==toyId||draft.photoId!==photo.id))||(partial&&(partial.toyId!==toyId||partial.photoId!==photo.id)))throw Error('Your plushie or photo changed. Please try again.');
  saveTouchDraft(toyId,photo.id,clip,scope,composer.jobKey);const key=queuePlushieTouch(toyId,photo.id,clip,scope,composer.jobKey);
  try{discardTouchRecording();}catch{}defaultPage();
  // The toast host clears notices on route changes. Publish after the local
  // exit, scoped to the original durable job, not after a network round-trip.
  setTimeout(()=>{const current=touchSnapshot();if(current.scope!==scope)return;const job=current.jobs.find(j=>j.payload.key===key);
   if(job?.state==='queued')showBurrowToast('Sending your Touch Note…');else if(job?.state==='committed')showBurrowToast('Touch Note sent.');
  },300);
 }catch(e){setError((e as Error).message==='touch_quota_used'?'Your sending allowance has been used. Your recording is saved.':(e as Error).message);}}
 function discardRecording(){try{if(composer.jobKey)discardBlockedTouchJob(composer.jobKey,scope);discardTouchDraft();discardTouchRecording();setDiscard(false);defaultPage();}catch{setError('Could not discard your recording. Please try again.');}}
 function startRecording(){try{acknowledgeTouchGuide();setComposer(v=>({...v,phase:'recording'}));setError(null);}catch{setError('Could not save on this phone. Please try again.');}}
 function beginPlayback(){if(!message||!valid)return;try{
  markTouchPlayed(message.id);setActiveMessage(message);setPlayState('playing');setError(null);setHapticDialog(false);
 }catch{setError('Could not save playback on this phone. Please try again.');}}
 function play(){
  const request=++playbackRequest.current;
  void touchCapabilities().then(current=>{
   if(request!==playbackRequest.current||liveScope.current!==scope)return;
   setCaps(current);setQuality(touchInitialQuality(current,reduced));
   if(touchVisualOnly(current)||!getInteractionPreferences().haptics||current?.systemHaptics==='disabled'||!hapticConfirmed.current){setHapticDialog(true);return;}
   beginPlayback();
  });
 }
 function joinPlus(){
  if(!guide&&!quotaDialog){router.push('/(main)/(modals)/subscription-paywall');return;}
  setEntryDismissed(true);const request=++playbackRequest.current;
  setTimeout(()=>{if(request===playbackRequest.current&&liveScope.current===scope)router.push('/(main)/(modals)/subscription-paywall');},320);
 }
 const header=recording?(status.started?`${status.seconds}s remaining`:'The timer starts on your first tap'):
  !inbox&&phase==='preview'?`You gave ${count} touches in total!`:null;
 const blocked=state.jobs.find(j=>j.state==='blocked');
 if(history&&valid)return <View style={[s.history,{paddingTop:insets.top}]}>
  <View style={s.historyBack}><BurrowBackButton light onPress={exit} style={{backgroundColor:'#725045'}}/></View>
  <ScrollView contentContainerStyle={{padding:28,paddingTop:state.meta?.hasPlus?20:58,paddingBottom:insets.bottom+130,alignItems:'center',gap:20}}>
   <TouchNoteIcon size={100}/><Text style={s.historyTitle}>Touch Note History</Text>
   {rows.map(m=>{const art=burrowArtForItem(m.toy??data?.catalog.find(i=>i.stable_id===m.toy_id),'couple_dolls');return <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Replay ${m.touches??'saved'} touches`} onPress={()=>{setSelected(m.id);setHistory(false);setPlayState('idle');setActiveMessage(null);setError(null);void prepareTouchMessage(m.id).catch(()=>setError('Could not prepare this touch note. Tap to retry.'));}} style={s.historyRow}>
    {art?<Image source={art.source} contentFit="contain" style={{width:55,height:62}}/>:<View style={{width:55}}/>}
    <Text style={s.historyCount}>{m.touches??touchMessage(m.id)?.clip.touches??'—'} Touches</Text><Text style={s.date}>{new Date(m.created_at).toLocaleDateString('en-GB',{year:'2-digit',month:'numeric',day:'numeric'}).split('/').reverse().join('.')}</Text>
   </Pressable>;})}
   {!rows.length&&<Text style={t.copy}>No Touch Notes yet.</Text>}
   <Text style={[t.copy,{marginTop:8}]}>{state.meta?.hasPlus?'Only the latest 10 Touch Notes between you will be saved.':'Only your latest received Touch Note will be saved.\nJoin Plus to save up to 10.'}</Text>
   <Text style={s.retention}>When Plus ends, only each person’s latest received note is kept. Deleted notes cannot be restored by upgrading.</Text>
   {(error||state.error)&&<Text accessibilityRole="alert" style={s.error} onPress={()=>void refreshPlushieTouch()}>{error??state.error}</Text>}
  </ScrollView>
  {!state.meta?.hasPlus&&<View style={[s.bottom,{bottom:insets.bottom+24}]}><Action label="Join Plus" onPress={joinPlus}/></View>}
 </View>;
 return <View style={[s.root,{paddingTop:insets.top}]}>
  <View style={s.header}>{header?<Text accessibilityRole="header" style={s.instruction}>{header}</Text>:<>
   <BurrowBackButton light onPress={exit}/><Text numberOfLines={1} style={s.title}>{inbox&&!ownReplay?`${name}’s Plushie`:'Your Plushie'}</Text>
   {inbox&&!playing?<Pressable accessibilityRole="button" accessibilityLabel="Touch Note History" onPress={()=>setHistory(true)} style={s.icon}><Feather name="clock" size={26} color="#FFF9EF"/></Pressable>:<View style={s.icon}/>}
  </>}{header&&!locked&&phase!=='preview'&&<Pressable accessibilityRole="button" accessibilityLabel="Back from touch" onPress={exit} style={s.smallBack}><Feather name="chevron-left" size={23} color="#FFF9EF"/></Pressable>}</View>
  <View style={{flex:1}}><PlushieRoomBackground wallpaper={slots.wallpaper} width={width} height={bodyHeight} floorY={bodyHeight*.56} bottomInset={insets.bottom}/>
   {!valid?<View style={s.center}><Text style={s.sceneCopy}>Your connection changed. Return to the room to continue.</Text></View>:inbox?<>
    {playing&&message?<><PlushieTouchPlayback key={`${message.id}:${replay}`} message={message} size={size} width={width} height={bodyHeight} initialQuality={quality} paused={playState!=='playing'}
      onQuality={q=>setQuality(q==='full'?'full':'standard')} onPause={reason=>{setPlayState('paused');if(reason)setError(reason);}} onFinish={()=>setPlayState('finished')}/>
     <View style={[s.bottom,{bottom:insets.bottom+24}]}><Action label={playState==='playing'?'Stop':playState==='paused'?'Continue':'Replay'} onPress={()=>{
      setError(null);if(playState==='playing')setPlayState('paused');else if(playState==='paused'){if(!touchVisualOnly(caps)&&!getInteractionPreferences().haptics){setHapticDialog(true);return;}setPlayState('playing');}
      else {setReplay(n=>n+1);setPlayState('playing');}
     }}/></View></>:
     message?<><View style={{position:'absolute',top:toyTop,left:(width-size)/2}}><PlushieTouchToy asset={burrowArtForItem(message.toy,'couple_dolls')!} photo={message.photo??undefined} size={size} quality="light" scope={`preview:${message.id}`}/></View>
      <View style={{position:'absolute',top:bodyHeight*.14,alignSelf:'center',backgroundColor:'#FFC343',padding:12,borderRadius:12}}><Text style={s.unread}>{message.recipient_id===data?.profile.id&&!message.read_at&&!state.seen.includes(message.id)?'You have an unread Touch Note':'Touch Note'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={ownReplay?'Replay your Touch Note':`Feel ${name}’s touch`} onPress={play} style={[s.bottom,{bottom:insets.bottom+45,gap:20}]}><TouchNoteIcon size={112}/><Text style={s.feel}>{ownReplay?'Tap to replay your Touch Note':`Tap to feel ${name}’s touch on you`}</Text></Pressable></>:
      <View style={s.center}>{!state.meta?<ActivityIndicator color="#FFF9EF"/>:<><Text style={s.sceneCopy}>{expired?'This Touch Note is no longer available.':rows.length?'Preparing your Touch Note…':'No Touch Notes yet.'}</Text><Action label={expired?'Open History':'Retry'} onPress={()=>{if(expired)setHistory(true);else {setError(null);void refreshPlushieTouch().then(()=>{if(id)return prepareTouchMessage(id);}).catch(()=>setError('Please try again.'));}}}/></>}</View>}
   </>:<>
    {recording?<PlushieTouchRecording key={`${scope}:${attempt}`} asset={toy!} photo={photo!} size={size} width={width} height={bodyHeight} bottom={insets.bottom+24}
      scope={`record:${scope}:${toyId}`} initial={initial} onCheckpoint={checkpoint} onStatus={setStatus} onComplete={complete} onInterrupted={incomplete}/>:
     <><View pointerEvents="none" style={{position:'absolute',top:bodyHeight*.035,alignSelf:'center'}}>{phase==='preview'&&<TouchHeartMeter progress={completeProgress} count={count} size={Math.min(width*.39,bodyHeight*.23)}/>}</View>
      <View style={{position:'absolute',top:toyTop,left:(width-size)/2}}>{toy&&<PlushieTouchToy asset={toy} photo={photo} size={size} quality="light" scope={`preview:${scope}`}/>}</View>
      <View style={[s.bottom,{bottom:insets.bottom+24,gap:20}]}>
       {phase==='preview'?<><Action label="Send Touch Note" disabled={!clip||(!quota&&!composer.jobKey)||!quotaReady} onPress={send}/><Action cream label="Close and Leave" onPress={()=>setDiscard(true)}/></>:
       <Text style={s.sceneCopy}>{pending?'Sending your saved Touch Note…':!photo?'Add a photo to your plushie first.':!state.meta?'Checking your allowance…':!quotaReady?'Touch Note is not ready. Please try again shortly.':''}</Text>}
      </View></>}
    {blocked&&phase!=='preview'&&!status.started&&<View style={[s.bottom,{bottom:insets.bottom+100}]}><Action cream label="Recover unsent Touch Note" onPress={()=>{try{recoverTouchJob(blocked.payload.key);setComposer(restoreTouchComposer());setAttempt(v=>v+1);}catch{setError('Could not restore your recording. Please try again.');}}}/></View>}
   </>}
   {(error||state.error)&&valid&&<Text accessibilityRole="alert" style={[s.error,{position:'absolute',bottom:insets.bottom+165,left:24,right:24}]} onPress={()=>void refreshPlushieTouch()}>{error??state.error}</Text>}
  </View>
  <TouchNoteDialog visible={focused&&!entryDismissed&&(guide||quotaDialog)} onClose={defaultPage}>
   <Text style={t.chip}>Touch Note</Text><TouchNoteIcon size={80}/><Text style={t.heading}>Let your partner feel your touch</Text>
   <Text style={t.copy}>Not just playing by yourself. Every rub, pull, squeeze, and bonk on your plushie will be packed into a Touch Note, matching the rhythm and intensity of your touch. Send a little love they can feel in the palm of their hand.</Text>
   <Action dark label={quotaDialog?state.meta?.hasPlus?'OK':'Join Plus':'Start'} disabled={!quotaDialog&&!quotaReady} onPress={quotaDialog?state.meta?.hasPlus?defaultPage:joinPlus:startRecording}/>
   <Text style={t.hint}>{quotaDialog?state.meta?.hasPlus?'You’ve used today’s send. Your next send is available tomorrow.':'You’ve used this month’s Free send. Join Plus for one send per day. If you already sent today, your next send is available tomorrow.':state.meta?.hasPlus?'You have 1 send available today.':'You have 1 send available this month.'}</Text>
  </TouchNoteDialog>
  <TouchNoteDialog visible={focused&&discard} onClose={()=>setDiscard(false)}><TouchNoteIcon size={80}/><Text style={t.heading}>Your recording won’t be saved</Text><Text style={t.copy}>Are you sure you want to close and leave?</Text><Action dark label="Yes" onPress={discardRecording}/></TouchNoteDialog>
  <TouchNoteDialog visible={focused&&hapticDialog} onClose={()=>setHapticDialog(false)}><TouchNoteIcon size={80}/><Text style={t.heading}>{touchVisualOnly(caps)?'Vibration is unavailable':'Feel their touch'}</Text>
   <Text style={t.copy}>{touchVisualOnly(caps)?'You can watch the animation on this device without vibration. Open this Touch Note on a phone with haptics to feel their touch.':hapticHelp||caps?.systemHaptics==='disabled'?'Turn on vibration in your phone’s Sound / Haptics settings, disable power-saving restrictions, then test again. Some system switches cannot be checked by this app.':'Touch Notes use your phone’s vibration. Test it before starting so you can feel the rhythm.'}</Text>
   {touchVisualOnly(caps)?<Action label="Play animation" onPress={()=>{if(playState==='paused'){setHapticDialog(false);setPlayState('playing');}else beginPlayback();}}/>:<><Action dark label={!getInteractionPreferences().haptics?'Enable app vibration and test':'Test Vibration'} onPress={()=>{try{if(!getInteractionPreferences().haptics)setInteractionPreference('haptics',true);void testTouchVibration().then(ok=>{setHapticTested(ok);if(!ok)setHapticHelp(true);});}catch{setError('Could not enable vibration. Please try again.');}}}/>
    <Action label="I felt it · Start Playback" disabled={!hapticTested} onPress={()=>{try{confirmTouchVibration(data?.profile.id);hapticConfirmed.current=true;if(playState==='paused'){setHapticDialog(false);setPlayState('playing');}else beginPlayback();}catch{setError('Could not save vibration confirmation. Please try again.');}}}/>
    <Pressable accessibilityRole="button" onPress={()=>setHapticHelp(true)}><Text style={s.help}>I didn’t feel it</Text></Pressable></>}
  </TouchNoteDialog>
 </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#502B1E'},header:{height:68,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:22,fontWeight:'800',color:'#FFF9EF',flex:1,textAlign:'center'},instruction:{color:'#FFF9EF',fontSize:16,fontWeight:'800',textAlign:'center',flex:1,lineHeight:22,paddingHorizontal:18},smallBack:{position:'absolute',left:5,padding:8},icon:{width:44,height:44,alignItems:'center',justifyContent:'center'},
 bottom:{position:'absolute',left:28,right:28,alignItems:'center'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:20,padding:28},sceneCopy:{backgroundColor:'#FFF9EE',borderRadius:12,padding:10,color:'#49321F',fontSize:16,textAlign:'center'},unread:{fontSize:17,fontWeight:'800',color:'#57331D'},feel:{fontSize:17,fontWeight:'800',color:'#FFF9EF',textAlign:'center'},error:{color:'#7D251B',fontSize:14,textAlign:'center',padding:12,backgroundColor:'#FFF9EF',borderRadius:12},help:{color:'#57331D',textDecorationLine:'underline',fontSize:15},
 history:{flex:1,backgroundColor:'#FFF4DF'},historyBack:{padding:16},historyTitle:{fontSize:22,fontWeight:'800',color:'#49321F',marginBottom:8},historyRow:{width:'100%',minHeight:82,borderRadius:16,borderWidth:2,borderColor:'#886442',backgroundColor:'#FFF',padding:12,flexDirection:'row',alignItems:'center',gap:12},historyCount:{fontSize:19,fontWeight:'800',color:'#49321F',flex:1},date:{fontSize:17,fontWeight:'800',color:'#FFF9EF',backgroundColor:'#66421D',borderRadius:9,padding:7},retention:{fontSize:12,lineHeight:18,color:'#745541',textAlign:'center'}});
