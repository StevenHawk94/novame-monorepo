import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RecordingPresets, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState,
  type AudioPlayer, type AudioRecorder, type AudioStatus, type RecorderState } from 'expo-audio';

const idleAudio = { isLoaded:false, playing:false, currentTime:0, duration:0, didJustFinish:false, playbackState:'idle' } as AudioStatus;
const idleRecording = { isRecording:false, durationMillis:0 } as RecorderState;
type PlayerSnapshot = { player:AudioPlayer; audio:AudioStatus; token:string };

/** Resource hosts are separate React lifetimes, not conditional hooks. Merely
 * choosing a frame never creates an AVAudioRecorder/player or starts polling. */
export function useSurpriseAudioResources(recordingNeeded:boolean, source:string|null, leasedPlayer:AudioPlayer|undefined, onFinish:()=>void) {
  const nativeRecorder=useRef<AudioRecorder|null>(null);
  const recorderStopping=useRef<Promise<void>>(Promise.resolve());
  const finish=useRef(onFinish);finish.current=onFinish;
  const [recording,setRecording]=useState(idleRecording);
  const [snapshot,setSnapshot]=useState<PlayerSnapshot|null>(null);
  const attachRecorder=useCallback((value:AudioRecorder|null,stopping?:Promise<void>)=>{
    nativeRecorder.current=value;if(stopping)recorderStopping.current=stopping;
  },[]);
  const recorder=useMemo(()=>({
    prepareToRecordAsync:()=>{
      if(!nativeRecorder.current)return Promise.reject(Error('recorder_not_ready'));
      return nativeRecorder.current.prepareToRecordAsync();
    },
    record:(options?:Parameters<AudioRecorder['record']>[0])=>{
      if(!nativeRecorder.current)throw Error('recorder_not_ready');
      nativeRecorder.current.record(options);
    },
    stop:async()=>{if(nativeRecorder.current)await nativeRecorder.current.stop();else await recorderStopping.current;},
    getStatus:()=>nativeRecorder.current?.getStatus()??idleRecording,
    get uri(){return nativeRecorder.current?.uri??null;},
  }),[]);
  const hasPlayer=!!leasedPlayer||!!source;
  const playerToken=leasedPlayer?'lease:'+leasedPlayer.id:source??'';
  const resources=<>
    {recordingNeeded&&<RecordingResource attach={attachRecorder} publish={setRecording} finish={finish}/>}
    {leasedPlayer?<PlayerStatusResource key={playerToken} token={playerToken} player={leasedPlayer} publish={setSnapshot}/>
      :source?<OwnedPlayerResource key={source} source={source} publish={setSnapshot}/>:null}
  </>;
  const current=snapshot?.token===playerToken?snapshot:null;
  return {recorder,recording:recordingNeeded?recording:idleRecording,
    player:hasPlayer?current?.player??null:null,audio:hasPlayer?current?.audio??idleAudio:idleAudio,resources};
}

function RecordingResource({attach,publish,finish}:{attach:(recorder:AudioRecorder|null,stopping?:Promise<void>)=>void;publish:(state:RecorderState)=>void;finish:{current:()=>void}}){
  const recorder=useAudioRecorder({...RecordingPresets.HIGH_QUALITY,numberOfChannels:1,bitRate:64000,isMeteringEnabled:true},status=>{if(status.isFinished)finish.current();});
  const state=useAudioRecorderState(recorder,100);
  useLayoutEffect(()=>{attach(recorder);return()=>{
    // Stop before Expo releases the shared object. Parent teardown can await
    // this exact stop even after the host has detached; no native status read.
    let stopping:Promise<void>;
    try{stopping=recorder.stop();}catch{stopping=Promise.resolve();}
    void stopping.catch(()=>{});attach(null,stopping);publish(idleRecording);
  };},[attach,recorder,publish]);
  useLayoutEffect(()=>publish(state),[state,publish]);
  return null;
}
function OwnedPlayerResource({source,publish}:{source:string;publish:(snapshot:PlayerSnapshot|null)=>void}){
  const player=useAudioPlayer(source,{updateInterval:100,keepAudioSessionActive:false});
  return <PlayerStatusResource token={source} player={player} publish={publish}/>;
}
function PlayerStatusResource({player,publish,token}:{player:AudioPlayer;token:string;publish:(snapshot:PlayerSnapshot|null)=>void}){
  const audio=useAudioPlayerStatus(player);
  useLayoutEffect(()=>{publish({player,audio,token});},[player,audio,publish,token]);
  useLayoutEffect(()=>()=>{try{player.pause();}catch{/* Parent may already have released a prepared lease. */}publish(null);},[player,publish]);
  return null;
}
