import { BurrowBackButton } from './burrow-back-button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert, Pressable } from '@/components/ui/feedback-pressable';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { usePreventRemove } from '@react-navigation/native';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { useSurpriseAudioResources } from './surprise-audio-resources';
import { randomUUID } from 'expo-crypto';
import { useBurrow, refreshBurrow } from '@/lib/burrow-store';
import { isInsufficientCoins, showInsufficientCoins } from '@/lib/insufficient-coins';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { readSurpriseDraft, saveSurpriseDraft, clearSurpriseDraft, keepSurpriseFile, releaseSurpriseFile,
  openSurprise, surpriseTime, type SurpriseDraft, type Surprise } from '@/lib/surprise-api';
import { useSurpriseInbox, refreshSurpriseInbox, markSurpriseOpened } from '@/lib/surprise-inbox';
import { enqueueSurprise, retrySurpriseSend, useSurpriseOutbox, surpriseSendFailure, canEditRejectedSurprise, reviseRejectedSurprise } from '@/lib/surprise-send-queue';
import { prepareSurprise, preparedSurprise, inspectSurpriseAudio, acquirePreparedSurpriseAudio } from '@/lib/surprise-preparation';
import { prepareSurprisePreview, releaseSurprisePreview, useSurprisePreview } from '@/lib/surprise-preview';
import { pinSurpriseMedia } from '@/lib/surprise-media-cache';
import { acquireBurrowAudioFocus } from './burrow-music';
import { SurprisePortrait } from './surprise-art';
import { RecordingOrb, SurpriseGiftbox, SurpriseCard, SurpriseAction, SURPRISE_CREAM, SURPRISE_INK } from './surprise-composer-ui';
import { SurpriseCamera } from './surprise-camera';
import { SurprisePlaybackOverlay, SurprisePlaybackSurface, SURPRISE_PLAYBACK_SCRIM } from './surprise-playback-overlay';
import { SurpriseHistory } from './surprise-history';
import { prepareSurpriseHistoryEntry } from '@/lib/room-history-entry';
import { showBurrowToast } from '@/lib/burrow-toast';
import { afterUiSettles } from '@/lib/ui-idle';
import { ROOM_TITLE_STYLE } from '@/lib/room-header-typography';
import { SurpriseFramePicker } from './surprise-frame-picker';
import { burrowProducts } from '@/lib/burrow-products';
import { CoinLabel } from './coin-ui';
import { usePageBackGesture } from '@/lib/use-page-back-gesture';
import { requirePartner } from '@/lib/partner-pairing';
import { ScreenOverlay } from '@/components/ui/screen-overlay';

const headerActions=StyleSheet.create({action:{width:44,height:44,alignItems:'center',justifyContent:'center'}});

type Step='choose'|'camera'|'photo-review'|'record'|'record-review'|'preview'|'sent'|'replay'|'play'|'history';
async function stopRecorderSafely(recorder:{stop:()=>Promise<void>}) {
  // Expo can release its shared object before a navigation cleanup runs. Even
  // invoking stop() may throw synchronously, not just reject its promise.
  try { await recorder.stop(); return true; } catch { return false; /* Already stopped/released. */ }
}
async function restorePlaybackMode() {
  try { await setAudioModeAsync({allowsRecording:false,shouldPlayInBackground:false,playsInSilentMode:true}); }
  catch { /* Cleanup must not prevent navigation or audio-focus release. */ }
}
function Button({title,onPress,disabled=false,light=false}:{title:string;onPress:()=>void;disabled?:boolean;light?:boolean}){
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[s.button,light&&s.lightButton,{opacity:disabled?.45:pressed?.8:1}]}><CoinLabel iconSize={21} style={[s.buttonText,light&&{color:'#4A2917'}]}>{title}</CoinLabel></Pressable>;
}
function Waveform({level=0,progress=0}:{level?:number;progress?:number}){
  return <View style={s.wave}>{Array.from({length:38},(_,i)=><View key={i} style={{flex:1,minWidth:1,maxWidth:4,borderRadius:3,height:5+(Math.sin(i*2.37)**2)*35*(level||1),backgroundColor:level||i/38<=progress?'#C85D3C':'#E0C4A9'}}/>)}</View>;
}
export function SurpriseRoomScreen(){
  const {data}=useBurrow(false,'surprise');
  const params=useLocalSearchParams<{receive?:string}>();
  if(!data||!data.catalogComplete)return <View style={[s.root,s.center,params.receive==='1'&&{backgroundColor:SURPRISE_PLAYBACK_SCRIM}]}><ActivityIndicator color="#FFF0DA"/><Text style={s.copy}>Preparing your room…</Text><Pressable onPress={()=>void refreshBurrow()}><Text style={s.link}>Retry</Text></Pressable></View>;
  return <Room key={`${data.profile.id}:${data.partner?.id}:${data.pairVersion}`} data={data}/>;
}
function Room({data}:{data:MajorUpdateBootstrap}){
  const insets=useSafeAreaInsets();const params=useLocalSearchParams<{id?:string;receive?:string;history?:string}>();
  const homeOverlay=params.receive==='1';
  const scope=`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion??''}`;
  const outbox=useSurpriseOutbox();
  const initial= params.id ? preparedSurprise(scope,params.id) : undefined;
  const freshDraft=():SurpriseDraft=>({userId:data.profile.id,partnerId:data.partner?.id??'',pairVersion:data.pairVersion??'',key:randomUUID(),frame:'santa'});
  const [draft,setDraft]=useState<SurpriseDraft>(()=>{
    const saved=readSurpriseDraft(data.profile.id,data.partner?.id??'',data.pairVersion??'');
    const queued=outbox.find(j=>j.draft.key===saved?.key);
    if(saved?.sentId||queued?.state==='sent')return freshDraft();
    return queued?{...queued.draft}:saved??freshDraft();
  });
  const [step,setStep]=useState<Step>(()=>params.history==='1'?'history':initial&&homeOverlay?'play':draft.sentId||outbox.some(j=>j.draft.key===draft.key)?'sent':draft.audioUri?'preview':draft.photoUri?'photo-review':'choose');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [received,setReceived]=useState<Surprise|null>(initial?.item??null);
  const [openingId,setOpeningId]=useState<string|null>(null);
  const [media,setMedia]=useState<{photoUrl:string;audioUrl:string;portraitUri?:string}|null>(initial?.media??null);
  const [playbackSession,setPlaybackSession]=useState(0);
  const [audioLease,setAudioLease]=useState(()=>initial?acquirePreparedSurpriseAudio(scope,initial.item.id):undefined);
  const [source,setSource]=useState<string|null>(initial?.media.audioUrl??null);const [wantPlay,setWantPlay]=useState(!!initial&&homeOverlay);
  const [historyOrigin,setHistoryOrigin]=useState(params.history==='1');
  const [sentConfirmation,setSentConfirmation]=useState(false);
  const finishRef=useRef<()=>void>(()=>{});
  const playbackNeeded=['record-review','preview','replay','play'].includes(step);
  const {player,audio,recorder,recording,resources}=useSurpriseAudioResources(step==='record',playbackNeeded?source:null,playbackNeeded?audioLease?.player:undefined,()=>finishRef.current());
  useEffect(()=>()=>audioLease?.release(),[audioLease]);
  const playerRef=useRef(player);playerRef.current=player;
  const recordingStarted=useRef(0);const recordLock=useRef(false);const sendLock=useRef(false);
  const submitted=useRef('');
  const playbackRequest=useRef(0),playbackStarting=useRef(false);
  const playLaunch=useRef(false),openingRef=useRef('');
  const alive=useRef(true);const focused=useRef(true);const epoch=useRef(sessionEpoch());const operation=useRef(0);
  const [focusVersion,setFocusVersion]=useState(0);
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const exitRef=useRef<()=>void>(()=>{}),backStep=useRef(step);backStep.current=step;
  const discardPrompt=useRef(false);
  const recordingForeground=useRef<((active:boolean)=>void)|null>(null);
  const audioCleanup=useRef(Promise.resolve());
  const releaseAudioFocus=useRef<(()=>void)|null>(null);
  const list=useSurpriseInbox();const duration=received?.duration_ms??draft.durationMs??0;
  const photo=received?media?.photoUrl:draft.photoUri;const frame=received?.frame??draft.frame;
  const portrait=useSurprisePreview(frame,photo,media?.portraitUri,step==='play');
  const name=data.partner?.display_name?.trim()||'your person';
  const offers=burrowProducts(data.catalog??[],'surprise');
  const offer=offers[draft.frame];
  const price=draft.locked?(draft.expectedPrice??300):(offer?.price??300);
  const isCurrent=()=>alive.current&&focused.current&&epoch.current===sessionEpoch();
  const historyOpening=useRef(false);
  useEffect(()=>{if(data.partner)return afterUiSettles(()=>{void prepareSurpriseHistoryEntry(scope).catch(()=>{});});},[scope]);
  async function openHistory(){
    if(historyOpening.current)return;historyOpening.current=true;
    try{
      const pending=outbox.some(job=>job.draft.userId===data.profile.id&&job.draft.partnerId===data.partner?.id&&job.state!=='sent');
      const exists=pending||list.length>0||!!data.partner&&await prepareSurpriseHistoryEntry(scope);
      if(!isCurrent())return;
      if(exists){pause();router.push({pathname:'/(main)/surprise-room',params:{history:'1'}});}
      else showBurrowToast('No history yet');
    }catch{if(isCurrent())showBurrowToast('Could not check history. Please try again.');}
    finally{historyOpening.current=false;}
  }
  // Inner steps (including history/replay) have their own Back semantics. A
  // native pop there would skip the previous step and exit the whole room.
  usePageBackGesture(params.receive!=='1' && ['choose','sent','history'].includes(step)
    && !busy && !recording.isRecording && !recordLock.current && !sendLock.current);
  const persist=(next:SurpriseDraft)=>{saveSurpriseDraft(next);setDraft(next);};
  const pause=()=>{playbackRequest.current++;playbackStarting.current=false;playLaunch.current=false;setWantPlay(false);try{playerRef.current?.pause();}catch{}};
  usePreventRemove(sendLock.current||step==='record'&&(recording.isRecording||recordLock.current),()=>exitRef.current());
  useFocusEffect(useCallback(()=>{
    focused.current=true;setFocusVersion(n=>n+1);
    const back=BackHandler?.addEventListener('hardwareBackPress',()=>{if(['choose','sent'].includes(backStep.current))return false;exitRef.current();return true;});
    return()=>{
      focused.current=false;operation.current++;
      back?.remove();discardPrompt.current=false;
      openingRef.current='';setBusy(false);setOpeningId(null);
      pause();
      recordingForeground.current?.(false);
      const needsStop=!!recordingStarted.current||recordLock.current;
      const release=releaseAudioFocus.current;releaseAudioFocus.current=null;
      recordingStarted.current=0;
      try{playerRef.current?.pause();}catch{ /* Player may already be released too. */ }
      // Never query native status during teardown: use JS-owned recording intent.
      // Restore audio mode before allowing Home's ambient soundtrack to resume.
      audioCleanup.current=(async()=>{
        if(needsStop)await stopRecorderSafely(recorder);
      })();
      release?.();
    };
  },[recorder]));
  // Browsing frames/history is silent and must not stop Home's soundtrack or
  // touch the system audio session. Private recording/playback still owns focus.
  const needsAudioFocus=step==='record'||!!source||!!audioLease;
  useEffect(()=>{
    if(!needsAudioFocus||!focused.current)return;
    const relinquish=acquireBurrowAudioFocus();let released=false;
    const release=()=>{
      if(released)return;released=true;
      void audioCleanup.current.then(restorePlaybackMode).finally(relinquish);
    };
    releaseAudioFocus.current=release;
    return()=>{
      if(releaseAudioFocus.current===release)releaseAudioFocus.current=null;
      release();
    };
  },[needsAudioFocus,focusVersion]);
  useEffect(()=>{alive.current=true;
    const identity=subscribeSessionIdentity(()=>{operation.current++;recordingForeground.current?.(false);pause();router.back();});
    const app=AppState.addEventListener('change',state=>{
      setForeground(state==='active');
      if(state==='active'){recordingForeground.current?.(true);return;}
      if(state==='background'){if(recordLock.current)operation.current++;recordingForeground.current?.(false);}
      pause();if(recordingStarted.current)finishRef.current();
    });
    return()=>{alive.current=false;operation.current++;recordingForeground.current?.(false);identity();app.remove();};
  },[]);
  useEffect(()=>{void refreshSurpriseInbox(scope).catch(()=>{});},[scope]);
  const requested=useRef(initial?.item.id??'');
  useEffect(()=>{
    if(!params.id||requested.current===params.id)return;
    const item=initial?.item??list.find(item=>item.id===params.id);
    if(item){requested.current=item.id;void loadReceived(item,params.receive==='1');}
  },[params.id,params.receive,list]);
  useEffect(()=>{
    if(!wantPlay||!player||!audio.isLoaded||playbackStarting.current||AppState.currentState!=='active'||!focused.current)return;
    playbackStarting.current=true;playLaunch.current=false;const request=playbackRequest.current;
    // seek the CURRENT native player, not the previous source's player. Expo
    // leaves completed clips at EOF; play() alone will not replay them.
    void (async()=>{try{
      await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true,shouldPlayInBackground:false,interruptionMode:'doNotMix'});
      // Warm Receive players already start at zero. Only a replay at EOF (or
      // a partial play) needs a native seek and its asynchronous round trip.
      if(audio.currentTime>0||audio.didJustFinish)await player.seekTo(0);
      if(request!==playbackRequest.current||!isCurrent()||AppState.currentState!=='active')return;
      player.play();setWantPlay(false);
    }catch{if(request===playbackRequest.current){setWantPlay(false);setError('Audio could not start. Please try again.');}}
    finally{if(request===playbackRequest.current)playbackStarting.current=false;}})();
  },[wantPlay,audio.isLoaded,player]);
  useEffect(()=>received&&media?pinSurpriseMedia(data.profile.id,data.pairVersion??'',received.id):undefined,[received?.id,media]);
  useEffect(()=>{
    if(audio.didJustFinish&&!wantPlay&&!playbackStarting.current){setWantPlay(false);if(step==='play')setStep(received?'replay':'preview');}
    if(audio.playbackState==='error'){pause();if(step==='play')setStep(received?'replay':'preview');setError('Audio could not be played. Tap play to retry.');}
  },[audio.didJustFinish,audio.playbackState]);
  useEffect(()=>{if(!wantPlay)return;const timer=setTimeout(()=>{pause();setError('Audio is taking too long. Please try again.');},15000);return()=>clearTimeout(timer);},[wantPlay]);
  useEffect(()=>{if(recording.isRecording&&recording.durationMillis>=60000)finishRef.current();},[recording.durationMillis,recording.isRecording]);
  function waitForRecordingForeground(){
    if(AppState.currentState==='active')return Promise.resolve(true);
    if(AppState.currentState!=='inactive')return Promise.resolve(false);
    // iOS may resolve the permission prompt while still inactive. Preserve this
    // tap until the prompt closes, but never resume after backgrounding/exiting.
    return new Promise<boolean>(resolve=>{
      const finish=(active:boolean)=>{clearTimeout(timer);if(recordingForeground.current===finish)recordingForeground.current=null;resolve(active);};
      const timer=setTimeout(()=>finish(false),5000);
      recordingForeground.current=finish;
    });
  }
  async function record(){
    if(recordLock.current||recordingStarted.current||draft.locked)return;recordLock.current=true;setError('');pause();
    const request=operation.current;
    const canRecord=()=>isCurrent()&&operation.current===request&&AppState.currentState==='active';
    try{
      if(Platform.OS==='web'){Alert.alert('Use the mobile app','Record your private surprise in the Burrow iOS or Android app.');return;}
      const permission=await AudioModule.requestRecordingPermissionsAsync();if(!isCurrent()||operation.current!==request)return;
      if(!permission.granted){Alert.alert('Microphone access needed','Allow microphone access in Settings to record your surprise.',[{text:'Cancel',style:'cancel'},{text:'Settings',onPress:()=>void Linking.openSettings()}]);return;}
      if(!await waitForRecordingForeground()||!canRecord())return;
      await audioCleanup.current;if(!canRecord())return;
      await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true,shouldPlayInBackground:false,interruptionMode:'doNotMix'});
      if(!canRecord())return;
      await recorder.prepareToRecordAsync();
      if(!canRecord()){await stopRecorderSafely(recorder);return;}
      recordingStarted.current=Date.now();recorder.record({forDuration:60});
    }catch{recordingStarted.current=0;await stopRecorderSafely(recorder);if(canRecord())setError('Recording could not start. Please try again.');}
    finally{recordLock.current=false;if(!recordingStarted.current)void restorePlaybackMode();}
  }
  async function finishRecording(){
    if(!recordingStarted.current||recordLock.current)return;recordLock.current=true;setBusy(true);
    const started=recordingStarted.current;recordingStarted.current=0;
    const request=operation.current;
    const current=()=>isCurrent()&&operation.current===request;
    try{
      // Native reads belong inside the guarded operation, never before try/finally.
      const status=recorder.getStatus();
      if(status.isRecording)await recorder.stop();
      if(!current())return;
      if(!recorder.uri){setError('Record at least one second before sending.');return;}
      // Native file duration is authoritative, not a stale recorder status or
      // JS wall clock carried across interruptions / a second recording.
      const uri=await keepSurpriseFile(recorder.uri,'audio');if(!current()){void releaseSurpriseFile(uri);return;}
      let ms:number;try{ms=await inspectSurpriseAudio(uri);}catch(error){void releaseSurpriseFile(uri);throw error;}
      if(!current()){void releaseSurpriseFile(uri);return;}
      if(ms<1000||ms>60500){void releaseSurpriseFile(uri);setError('Record between one second and one minute.');return;}
      persist({...draft,audioUri:uri,durationMs:Math.min(60000,ms)});void releaseSurpriseFile(draft.audioUri);setSource(uri);setStep('record-review');
    }catch{
      const stopped=await stopRecorderSafely(recorder);
      // A transient stop failure must leave Stop retryable, not trap a live mic.
      if(current()){if(!stopped)recordingStarted.current=started;setError('Recording could not be saved. Please record again.');}
    }
    finally{await restorePlaybackMode();recordLock.current=false;if(isCurrent())setBusy(false);}
  }
  finishRef.current=()=>void finishRecording();
  async function loadReceived(item:Surprise,play=false){
    if(openingRef.current===item.id)return;openingRef.current=item.id;
    pause();const request=++operation.current;setBusy(true);setOpeningId(item.id);setError('');
    const intent=playbackRequest.current;
    try{const next=preparedSurprise(scope,item.id)??await prepareSurprise(scope,item);if(!isCurrent()||operation.current!==request||playbackRequest.current!==intent||AppState.currentState!=='active')return;
      setAudioLease(acquirePreparedSurpriseAudio(scope,item.id));setReceived(item);setMedia(next.media);setSource(next.media.audioUrl);setStep(play?'play':'replay');if(play){playLaunch.current=true;setPlaybackSession(n=>n+1);setWantPlay(true);}}
    catch{if(isCurrent()&&operation.current===request)setError('Could not load this surprise. Tap Retry below.');}
    finally{if(operation.current===request&&openingRef.current===item.id)openingRef.current='';if(isCurrent()&&operation.current===request){setBusy(false);setOpeningId(null);}}
  }
  const opened=useRef(new Set<string>());
  useEffect(()=>{if(!received||!audio.playing||received.recipient_id!==data.profile.id||opened.current.has(received.id))return;
    const id=received.id;opened.current.add(id);void openSurprise(id).then(()=>{markSurpriseOpened(id);}).catch(()=>{opened.current.delete(id);});
  },[audio.playing,received?.id]);
  async function play(full:boolean){
    if(busy||playLaunch.current||playbackStarting.current)return;setError('');pause();playLaunch.current=true;let handedOff=false;
    const intent=playbackRequest.current;
    try{
    if(received){if(!media){await loadReceived(received,full);handedOff=true;return;}if(full){setStep('play');setPlaybackSession(n=>n+1);}setWantPlay(true);handedOff=true;return;}
    if(!draft.audioUri)return;
    if(full)await prepareSurprisePreview(draft.frame,draft.photoUri);
    if(intent!==playbackRequest.current||!isCurrent()||AppState.currentState!=='active')return;
    setAudioLease(undefined);setSource(draft.audioUri);
    if(full){setStep('play');setPlaybackSession(n=>n+1);}setWantPlay(true);handedOff=true;
    }catch{if(isCurrent())setError('Audio could not start. Please try again.');}
    finally{if(!handedOff)playLaunch.current=false;}
  }
  async function send(){
    if(sendLock.current||busy||submitted.current===draft.key)return;
    if(requirePartner(data))return;
    if(!offer){setError('This frame is unavailable. Please choose another frame.');void refreshBurrow({silent:true});return;}
    if(!data.pairVersion){Alert.alert('Connection updating','Your connection is updating. Please try again in a moment. Your draft stays here.');return;}
    if(offer?.plus_only&&!data.hasPlus){router.push('/(main)/(modals)/subscription-paywall');return;}
    if(!draft.locked&&data.wallet.balance<price){showInsufficientCoins();return;}
    sendLock.current=true;
    if(!isCurrent()){sendLock.current=false;return;}
    setError('');pause();
    const next={...draft,locked:true,expectedPrice:price,deliveryVersion:1 as const};
    try{enqueueSurprise(next);submitted.current=draft.key;try{persist(next);}catch{setDraft(next);}setStep('sent');setSentConfirmation(true);}
    catch(failure){if(isCurrent()){
      const code=(failure as {body?:{error?:string}}).body?.error;
      if(isInsufficientCoins(failure)){
        // Release the foreground lock before presenting another route. Focus
        // cleanup must not leave the saved draft behind a permanent spinner.
        sendLock.current=false;setBusy(false);showInsufficientCoins();
      }else if(code==='draft_expired'){persist({...next,key:randomUUID(),locked:false});setError('Your upload expired. Your saved photo and recording are ready to send again.');}
      else if(code==='price_changed'||code==='price_confirmation_required'){
        persist({...next,key:randomUUID(),locked:false,expectedPrice:undefined});void refreshBurrow({silent:true});
        setError('The price has changed. Review the updated price before sending again.');
      }else if(code==='plus_required'){router.push('/(main)/(modals)/subscription-paywall');}
      else setError((failure as Error).message==='outbox_full'?'Several surprises are waiting to send. Review Sent history before adding another.':'Could not save this surprise for sending. Your photo and recording are still here. Please retry.');
    }}finally{sendLock.current=false;if(isCurrent())setBusy(false);}
  }
  const job=outbox.find(row=>row.draft.key===draft.key);
  const notifiedReceipt=useRef(draft.sentId??'');
  useEffect(()=>{
    if(job?.state!=='sent'||!job.sentId||notifiedReceipt.current===job.sentId)return;
    notifiedReceipt.current=job.sentId;
    // A background receipt reconciles history/wallet, never reopens the success
    // card after Done or interrupts another task the sender has started.
  },[job?.state,job?.sentId]);
  useEffect(()=>{
    // A definitive send rejection can be revised; an unknown receipt MUST
    // retain its immutable key and files so a retry cannot charge twice.
    if(!job||!canEditRejectedSurprise(job)||!isCurrent())return;
    const next=reviseRejectedSurprise(job.draft.key);if(!next)return;
    pause();setSentConfirmation(false);setDraft(next);setStep('preview');setBusy(false);sendLock.current=false;
    if(job.error==='insufficient_balance')showInsufficientCoins();
    else{
      setError(surpriseSendFailure(job));
      if(['price_changed','price_confirmation_required','not_for_sale','plus_required'].includes(job.error??''))void refreshBurrow({silent:true});
      if(job.error==='plus_required')router.push('/(main)/(modals)/subscription-paywall');
    }
  },[job?.state,job?.error,focusVersion]);
  function editRejected(key:string){
    try{const next=reviseRejectedSurprise(key);if(!next)return;pause();setReceived(null);setMedia(null);setAudioLease(undefined);setDraft(next);setError('');setStep('preview');}
    catch{setError('Could not update the saved draft. Please retry.');}
  }
  function confirmDiscard(photoOnly=false){
    if(discardPrompt.current)return;discardPrompt.current=true;const request=operation.current;
    Alert.alert('Discard this surprise?',photoOnly?'Your photo will not be saved.':'Your photo and voice recording will not be saved.',[
      {text:'Keep editing',style:'cancel',onPress:()=>{discardPrompt.current=false;}},
      {text:'Discard',style:'destructive',onPress:()=>{
        discardPrompt.current=false;if(!isCurrent()||operation.current!==request)return;
        // Invalidate permission/preparation/save callbacks before leaving the
        // recorder. UI returns to selection immediately; native cleanup is
        // awaited only by audio-focus release or a later recording attempt.
        operation.current++;recordingForeground.current?.(false);
        const needsStop=!!recordingStarted.current||recording.isRecording||recordLock.current;
        recordingStarted.current=0;recordLock.current=false;
        if(needsStop)audioCleanup.current=(async()=>{await stopRecorderSafely(recorder);})();
        void newDraft();
      }},
    ],{cancelable:true,onDismiss:()=>{discardPrompt.current=false;}});
  }
  function exit(){if(discardPrompt.current)return;
    if(!homeOverlay&&!received&&!draft.locked&&['photo-review','record','record-review'].includes(step)){
      confirmDiscard(step==='photo-review');return;
    }
    if(sendLock.current||recording.isRecording||recordLock.current){Alert.alert('Please finish first',recording.isRecording?'Tap Stop to keep your recording before leaving.':'Your surprise is being saved.');return;}pause();operation.current++;openingRef.current='';setOpeningId(null);setBusy(false);
    if(homeOverlay&&!historyOrigin){router.back();return;}
    if(step==='play'&&received&&historyOrigin){setReceived(null);setMedia(null);setAudioLease(undefined);setSource(null);setStep('history');return;}
    if(step==='play'){setStep(received?'replay':'preview');return;}if(received){setReceived(null);setMedia(null);setAudioLease(undefined);setSource(draft.audioUri??null);requested.current=params.id??'';setStep(historyOrigin?'history':'choose');return;}
    if(step==='history'){if(params.history==='1'){router.back();return;}setHistoryOrigin(false);setStep('choose');return;}
    if(draft.locked&&step!=='sent'){router.back();return;}
    if(step==='preview'){setStep('record-review');return;}
    if(step==='camera'&&(draft.photoUri||draft.audioUri)){confirmDiscard();return;}
    if(step==='camera')setStep('choose');else router.back();}
  exitRef.current=exit;
  async function newDraft(keepHistory=false){if(!alive.current||epoch.current!==sessionEpoch())return;pause();operation.current++;clearSurpriseDraft();void releaseSurprisePreview(draft.frame,draft.photoUri);if(!draft.locked){void releaseSurpriseFile(draft.photoUri);void releaseSurpriseFile(draft.audioUri);}
    const next=freshDraft();persist(next);setReceived(null);setMedia(null);setAudioLease(undefined);setSource(null);setBusy(false);setError('');setStep(keepHistory?'history':'choose');}
  const playing=audio.playing;
  const togglePlayback=()=>{if(!isCurrent()||AppState.currentState!=='active')return;if(playing)pause();else if(player&&source&&audio.isLoaded&&audio.currentTime<audio.duration){try{player.play();}catch{setError('Audio could not start. Please try again.');}}else void play(step==='play');};
  const audioBar=<View style={s.audioBar}><Pressable accessibilityRole="button" accessibilityLabel={playing?'Pause message':'Play message'} disabled={busy||(!received&&!draft.audioUri)||!!received&&!media} onPress={togglePlayback} style={s.play}><Feather name={playing?'pause':'play'} size={24} color="#4A2917"/></Pressable><Waveform progress={audio.duration?audio.currentTime/audio.duration:0}/><Text style={[s.copy,s.ink]}>{surpriseTime((audio.playing?audio.currentTime*1000:duration))}</Text></View>;
  const playbackPanel=received?<View pointerEvents="box-none" style={[flow.playbackClock,{bottom:insets.bottom+20}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={playing?'Pause surprise':'Resume surprise'} onPress={togglePlayback}>
      <RecordingOrb running={playing} size={60}/>
    </Pressable><Text style={flow.playbackTime}>{surpriseTime(Math.max(0,duration-audio.currentTime*1000))}</Text>
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>:<Pressable accessibilityRole="button" accessibilityLabel="Stop preview" onPress={exit} style={flow.stopPreview}>
    <Text style={flow.playbackTime}>Tap anywhere to stop</Text>
  </Pressable>;
  const deliveredCard=<SurpriseCard dim={false} title="Surprise delivered" copy="Say thanks with a hug, or send one back" onClose={exit}>
    <View style={s.center}><SurpriseGiftbox size={64}/></View>
    {!!error&&<Text accessibilityRole="alert" style={[s.error,s.ink]}>{error}</Text>}
    <SurpriseAction title="Replay" disabled={busy||!media} onPress={()=>void play(true)}/>
    <SurpriseAction dark title="Send back" onPress={()=>{pause();if(homeOverlay)router.replace('/(main)/surprise-room');else void newDraft();}}/>
  </SurpriseCard>;
  // The native route is a transparent modal above the real retained Home.
  // Never paint the composer (or its saved draft photo) during media loading.
  if(homeOverlay)return <>{resources}<SurprisePlaybackSurface frame={frame} uri={received?media?.photoUrl:undefined}
    portraitUri={media?.portraitUri} session={playbackSession}
    playing={step==='play'&&playing} showRain={step==='play'&&!!received&&!!media?.photoUrl} hideClose={step!=='play'} onClose={exit}>
    {!received||!media?<View style={{flex:1,justifyContent:'center',padding:32}}><View style={[s.audioBar,{flexDirection:'column',gap:20}]}>
      {busy||!received?<ActivityIndicator color="#4A2917"/>:null}
      <Text style={[s.copy,s.ink]}>{error||'This surprise is not ready on this device yet. Return to Home; we’ll let you know when it is ready.'}</Text>
      {!busy&&received&&<Button title="Retry loading surprise" onPress={()=>void loadReceived(received,true)}/>}
      <Pressable accessibilityRole="button" onPress={exit}><Text style={[s.link,s.ink]}>Back to Home</Text></Pressable>
    </View></View>:step==='play'?playbackPanel:deliveredCard}
  </SurprisePlaybackSurface></>;
  if(step==='camera')return <>{resources}<SurpriseCamera frame={draft.frame} onBack={exit} onDone={async uri=>{const request=operation.current;const photoUri=await keepSurpriseFile(uri,'photo');if(!isCurrent()||operation.current!==request){void releaseSurpriseFile(photoUri);return;}persist({...draft,photoUri});void releaseSurprisePreview(draft.frame,draft.photoUri);void releaseSurpriseFile(draft.photoUri);setStep('photo-review');void prepareSurprisePreview(draft.frame,photoUri).catch(()=>{});}}/></>;
  const visibleStep=sentConfirmation?'preview':step==='play'?(received?'replay':'preview'):step;
  const composing=['photo-review','record','record-review','preview'].includes(visibleStep);
  const titles:Record<Step,string>={choose:'Surprise Room',camera:'Take a photo','photo-review':'',record:'','record-review':'',preview:'',sent:'Surprise Room',replay:'Surprise Room',play:'Surprise',history:'Surprise History'};
  return <View style={[s.root,composing&&{backgroundColor:SURPRISE_CREAM}]}>
    {resources}
    <View style={{flex:1}} importantForAccessibility={step==='play'||sentConfirmation?'no-hide-descendants':'auto'}>
    <View style={[s.header,{paddingTop:insets.top+12}]}>
      <BurrowBackButton light={!composing} accessibilityLabel="Back" onPress={exit} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} style={[s.title,ROOM_TITLE_STYLE,{flex:1}]}>{titles[visibleStep]}</Text>
      {visibleStep==='choose'||visibleStep==='sent'?<Pressable accessibilityRole="button" accessibilityLabel="Surprise history" style={headerActions.action} hitSlop={4} onPress={()=>void openHistory()}><Feather name="clock" size={26} color="#FFF0DA"/></Pressable>:<View style={headerActions.action}/>}
    </View>
    {visibleStep==='history'?<SurpriseHistory key={scope} scope={scope} userId={data.profile.id} name={name} initial={list} openingId={openingId} error={error} onEditRejected={editRejected} onSelect={item=>void loadReceived(item,true)}/>:
    visibleStep==='choose'?<SurpriseFramePicker userId={data.profile.id} frame={draft.frame} photoUri={draft.photoUri} locked={draft.locked} offers={offers} hasPlus={data.hasPlus}
      continueTitle={draft.sentId?'View sent surprise':draft.locked?'Continue sending':draft.photoUri?'Continue your surprise':'Use This Frame'}
      onSelect={frame=>{if(draft.locked||frame===draft.frame)return;persist({...draft,frame,photoUri:undefined});void releaseSurprisePreview(draft.frame,draft.photoUri);void releaseSurpriseFile(draft.photoUri);}}
      onContinue={()=>{if(!draft.sentId&&offer?.plus_only&&!data.hasPlus){router.push('/(main)/(modals)/subscription-paywall');return;}setStep(draft.sentId?'sent':draft.photoUri?(draft.audioUri?'preview':'photo-review'):'camera');}}/>:
    <ScrollView contentContainerStyle={[s.content,composing&&flow.content,{paddingBottom:insets.bottom+28}]} showsVerticalScrollIndicator={false}>
      {visibleStep==='photo-review'&&<>
        <View style={flow.intro}><Text style={flow.reviewCopy}>{name} will be showered with your cute faces the moment they open the app.</Text></View>
        <View style={flow.hero}><SurprisePortrait frame={draft.frame} uri={draft.photoUri} size={245}/></View>
        <View style={flow.actions}><SurpriseAction dark title="Retake photo" onPress={()=>setStep('camera')}/><SurpriseAction title="Continue" onPress={()=>setStep(draft.audioUri?'record-review':'record')}/></View>
      </>}
      {(visibleStep==='record'||visibleStep==='record-review')&&<>
        <View style={flow.intro}><Text style={flow.title}>Record a message</Text><Text style={flow.copy}>Say something sweet or funny to your babe, or sing a silly song!</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={visibleStep==='record-review'?'Play recording':recording.isRecording?'Stop recording':'Start recording'} disabled={busy||!!draft.locked} onPress={()=>{if(visibleStep==='record-review')togglePlayback();else void(recording.isRecording?finishRecording():record());}} style={flow.hero}>
          <RecordingOrb running={foreground&&(recording.isRecording||playing)} time={surpriseTime(visibleStep==='record-review'?(playing?audio.currentTime*1000:duration):Math.min(60000,recording.durationMillis))}/>
        </Pressable>
        <View style={flow.actions}>{visibleStep==='record-review'?<>
          <SurpriseAction title="Record again" onPress={()=>{pause();setStep('record');}}/>
          <SurpriseAction dark title="Continue" onPress={()=>{pause();setStep('preview');}}/>
        </>:<>
          <Text style={flow.caption}>{recording.isRecording?'Tap to stop recording':'1 min available'}</Text>
          <SurpriseAction title={recording.isRecording?'Recording':'Start'} disabled={busy||!!draft.locked} onPress={()=>void(recording.isRecording?finishRecording():record())}/>
          {!!draft.audioUri&&!recording.isRecording&&<Pressable onPress={()=>setStep('record-review')}><Text style={flow.caption}>Keep previous recording</Text></Pressable>}
        </>}</View>
      </>}
      {visibleStep==='preview'&&<>
        <View style={flow.intro}><Text style={flow.title}>Preview Your Surprise</Text><Text style={flow.copy}>Tap to see the surprise</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Preview Surprise" disabled={busy} onPress={()=>void play(true)} style={flow.hero}><SurpriseGiftbox size={185} wobble={foreground&&focused.current&&step==='preview'}/></Pressable>
        <View style={flow.actions}><SurpriseAction dark title="Send the surprise" disabled={busy} onPress={()=>void send()}/>
          <CoinLabel iconSize={26} style={flow.caption}>{`{coin} ${price} will be needed`}</CoinLabel>
        </View>
      </>}
      {visibleStep==='sent'&&<View style={s.success}><Text style={s.sentTitle}>{draft.sentId||job?.state==='sent'?'Surprise sent!':job?.state==='failed'?'Your surprise is saved':'Your surprise is on its way'}</Text>
        <Text accessibilityRole={job?.state==='failed'?'alert':undefined} style={s.copy}>{job?.state==='failed'?surpriseSendFailure(job):draft.sentId||job?.state==='sent'?`${name} will see it when their surprise is ready.`:'You can keep exploring. We’ll finish sending in the background.'}</Text>
        {job?.state==='failed'&&<Button title="Retry send" onPress={()=>retrySurpriseSend(draft.key)}/>}
        {job&&canEditRejectedSurprise(job)&&<Button title="Edit surprise" onPress={()=>editRejected(draft.key)}/>}
        <View style={{height:70}}/><Button title="Back to room" onPress={()=>router.back()}/><Pressable accessibilityRole="button" onPress={()=>void newDraft()}><Text style={s.link}>Make another surprise</Text></Pressable></View>}
      {visibleStep==='replay'&&received&&<>
        <View style={s.center}><SurprisePortrait frame={frame} uri={photo} size={260}/></View><Text style={s.sentTitle}>A little love {received.sender_id===data.profile.id?`for ${name}`:`from ${name}`}</Text><Text style={s.copy}>Made just for you.</Text>
        {busy?<ActivityIndicator color="#FFF0DA"/>:media?audioBar:<Button title="Retry loading surprise" onPress={()=>void loadReceived(received)}/>}
        <Button title="Replay" disabled={!media||busy} onPress={()=>void play(true)}/><Pressable onPress={exit}><Text style={s.link}>Back to room</Text></Pressable>
      </>}
      {!!error&&<Text accessibilityRole="alert" style={[s.error,composing&&{color:'#A8442C'}]}>{error}</Text>}
    </ScrollView>}
    </View>
    {step==='play'&&!!photo&&<SurprisePlaybackOverlay visible frame={frame} uri={photo}
    portraitUri={portrait} session={playbackSession}
      playing={playing} onClose={exit}>{playbackPanel}</SurprisePlaybackOverlay>}
    {sentConfirmation&&<ScreenOverlay visible transparent onRequestClose={()=>{setSentConfirmation(false);void newDraft();}}>
      <SurpriseCard title="Surprise Sent!" copy={`${name} will see it when their surprise is ready.`}>
        <View style={s.center}><SurprisePortrait frame={draft.frame} uri={draft.photoUri} size={130}/></View>
        <SurpriseAction dark title="Done" onPress={()=>{setSentConfirmation(false);void newDraft();}}/>
      </SurpriseCard>
    </ScreenOverlay>}
  </View>;
}
const serif=Platform.OS==='ios'?'Georgia':'serif';
const flow=StyleSheet.create({content:{paddingHorizontal:26,gap:18},intro:{paddingTop:32,gap:26},title:{fontSize:30,lineHeight:37,fontWeight:'800',textAlign:'center',color:SURPRISE_INK},copy:{fontSize:18,lineHeight:27,textAlign:'center',color:SURPRISE_INK},reviewCopy:{fontSize:18,lineHeight:26,fontWeight:'700',textAlign:'center',color:'#261A12'},hero:{flex:1,minHeight:240,alignItems:'center',justifyContent:'center',paddingVertical:26},actions:{gap:18,paddingTop:12},caption:{fontSize:17,lineHeight:24,textAlign:'center',color:SURPRISE_INK},playbackClock:{position:'absolute',left:0,right:0,alignItems:'center',gap:6},playbackTime:{color:'#FFF',fontSize:18,fontWeight:'700',textAlign:'center'},stopPreview:{...StyleSheet.absoluteFillObject,justifyContent:'flex-end',paddingBottom:38}});
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#492817'},center:{alignItems:'center',justifyContent:'center'},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:20,gap:12},title:{fontFamily:serif,fontWeight:'700',fontSize:23,color:'#FFF5E5',textAlign:'center'},content:{padding:20,gap:16,flexGrow:1,maxWidth:520,width:'100%',alignSelf:'center'},ink:{color:'#573C2B'},copy:{fontSize:15,lineHeight:22,color:'#FFF0DA',textAlign:'center'},small:{fontSize:12,lineHeight:18,color:'#E9CFB1',textAlign:'center'},sectionTitle:{fontFamily:serif,fontSize:23,fontWeight:'700',color:'#FFF0DA',textAlign:'center'},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:10},frame:{width:'31%',alignItems:'center',borderWidth:1.5,borderColor:'transparent',borderRadius:17,paddingBottom:8,backgroundColor:'#F6EAD8'},selected:{borderColor:'#FDC56D'},check:{position:'absolute',right:5,top:5,backgroundColor:'#4A2917',borderRadius:12,padding:4},button:{backgroundColor:'#FFF0DA',minHeight:56,borderRadius:30,alignItems:'center',justifyContent:'center',paddingHorizontal:20},lightButton:{backgroundColor:'#F9EAD6'},buttonText:{fontFamily:serif,fontWeight:'700',fontSize:18,color:'#4A2917',textAlign:'center'},link:{fontSize:15,color:'#FFD0A4',textAlign:'center',padding:10},audioBar:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'#F3E6D3',borderRadius:24,padding:14},play:{padding:6},wave:{flex:1,minHeight:45,minWidth:112,alignSelf:'stretch',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:2},record:{width:82,height:82,borderRadius:41,backgroundColor:'#FFF0DA',alignItems:'center',justifyContent:'center',alignSelf:'center',marginTop:10},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-around'},preview:{height:175,borderRadius:22,overflow:'hidden'},success:{flex:1,alignItems:'stretch',justifyContent:'center',gap:24},sentTitle:{fontFamily:serif,fontSize:30,fontWeight:'700',textAlign:'center',color:'#FFF0DA'},history:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderRadius:20,backgroundColor:'#F4E7D4'},historyTitle:{fontWeight:'700',color:'#54331F',fontSize:15},error:{color:'#FFAD99',textAlign:'center',fontSize:14,lineHeight:21},playPanel:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#FFF8EC',borderTopLeftRadius:32,borderTopRightRadius:32,padding:22,gap:10},progress:{height:4,borderRadius:2,backgroundColor:'#E7D2BC',overflow:'hidden'},progressFill:{height:4,backgroundColor:'#C96040'}});
