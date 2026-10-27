import {useEffect,useRef,useState} from 'react';
import {Pressable,Text} from 'react-native';
import {router} from 'expo-router';
import {useIsFocused} from '@react-navigation/native';
import {usePlushieTouches,touchGuideSeen,acknowledgeTouchGuide,touchDraft,touchRecording,refreshPlushieTouch} from '@/lib/plushie-touch-store';
import {TouchNoteButton,TouchNoteDialog,TouchNoteIcon,touchNoteStyles as t} from './touch-note-ui';

/** Entry dialogs belong to the existing Plushie, not the recording route. */
export function TouchNoteEntry({scope,pairVersion}:{scope:string;pairVersion?:string}){
 const state=usePlushieTouches(),focused=useIsFocused();
 const [intent,setIntent]=useState<'check'|'guide'|'quota'|null>(null),[error,setError]=useState('');
 const current=useRef(scope),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);current.current=scope;
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{setIntent(null);setError('');clearTimeout(timer.current);},[scope,focused]);
 const meta=state.scope===scope?state.meta:null;
 const ready=meta?.version===2&&meta.sameDomain,available=ready&&!!meta.remaining;
 const open=()=>{setIntent(null);router.push({pathname:'/(main)/plushie-touch',params:{mode:'record',pairVersion}});};
 useEffect(()=>{
  if(intent==='guide'&&ready&&!available){setIntent('quota');return;}
  if(intent!=='check'||!meta||!focused)return;
  if(!ready){setError('Touch Note is not ready. Please try again shortly.');return;}
  if(!available)setIntent('quota');else if(!touchGuideSeen())setIntent('guide');else open();
 },[intent,meta,focused,ready,available]);
 function press(){
  setError('');
  if(touchDraft()||touchRecording()){open();return;}
  if(available&&touchGuideSeen()){open();return;}
  setIntent(meta&&ready?(available?'guide':'quota'):'check');
  void refreshPlushieTouch().catch(()=>setError('Could not check your allowance. Please try again.'));
 }
 function start(){try{acknowledgeTouchGuide();open();}catch{setError('Could not save on this device. Please try again.');}}
 function plus(){
  setIntent(null);const expected=scope;
  timer.current=setTimeout(()=>{if(current.current===expected)router.push('/(main)/(modals)/subscription-paywall');},300);
 }
 return <>
  <Pressable accessibilityRole="button" accessibilityLabel="Touch Note" onPress={press} style={{position:'absolute',right:12,top:14,zIndex:2,padding:8,alignItems:'center'}}><TouchNoteIcon size={65}/><Text style={{fontSize:14,fontWeight:'800',color:'#49321F'}}>Touch Note</Text></Pressable>
  <TouchNoteDialog visible={focused&&!!intent} onClose={()=>setIntent(null)}>
   <Text style={t.chip}>Touch Note</Text><TouchNoteIcon size={80}/><Text style={t.heading}>Let your partner feel your touch</Text>
   <Text style={t.copy}>Not just playing by yourself. Every rub, pull, squeeze, and bonk on your plushie will be packed into a Touch Note, matching the rhythm and intensity of your touch. Send a little love they can feel in the palm of their hand.</Text>
   {intent==='check'?<><Text style={t.hint}>{error||'Checking your allowance…'}</Text>{error&&<TouchNoteButton label="Retry" onPress={press}/>}</>:
    <><TouchNoteButton dark label={intent==='guide'?'Start':meta?.hasPlus?'OK':'Join Plus'} onPress={intent==='guide'?start:meta?.hasPlus?()=>setIntent(null):plus}/>
    <Text style={t.hint}>{intent==='guide'?(meta?.hasPlus?'You have 1 send available today.':'You have 1 send available this month.'):meta?.hasPlus?'You’ve used today’s send. Your next send is available tomorrow.':'You’ve used this month’s Free send. Join Plus for one send per day. If you already sent today, your next send is available tomorrow.'}</Text>{!!error&&<Text accessibilityRole="alert" style={t.hint}>{error}</Text>}</>}
  </TouchNoteDialog>
 </>;
}
