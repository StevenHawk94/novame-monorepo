import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppRegistry,AppState,View,Text,Pressable} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer,useNavigation} from '@react-navigation/native';
import {runOnJS,runOnUI,useFrameCallback,useSharedValue} from 'react-native-reanimated';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import * as Splash from 'expo-splash-screen';
import * as Files from 'expo-file-system/legacy';
import {PlushieTouchPlayback} from '../apps/mobile/src/components/burrow/plushie-touch-playback';
import {PlushieTouchRecording} from '../apps/mobile/src/components/burrow/plushie-touch-recording';
import {BURROW_ART} from '../apps/mobile/src/lib/burrow-art-assets';
import {PlushieTouchScreen} from '../apps/mobile/src/components/burrow/plushie-touch-screen';
import {LocalizedToy} from '../apps/mobile/src/components/burrow/localized-toy';
import RoomInteraction from '../apps/mobile/app/(main)/room-interaction';
import {setPlushieTouchScope,touchRecording,touchDraft,touchSnapshot} from '../apps/mobile/src/lib/plushie-touch-store';
import {data,setQAMode,setQAExit,setQANavigate,resetTouchQA,seedTouchQA,seedPlusQA} from './native-plushie-touch-state';
import {storage} from './native-plushie-touch-storage';
import {kPlushieTouchRecording,kPlushieTouchDraft,kPlushieTouch,kPlushieTouchGuide} from '../apps/mobile/src/shared/storage/keys';
const Stack=createNativeStackNavigator();
const qualities=['full','standard'],phases=qualities.flatMap(quality=>[{quality,dense:false},{quality,dense:true}]);
const asset=BURROW_ART.couple_dolls[0],photo={id:'qa-face',ownerId:'qa-owner',kind:'doll',updatedAt:'2026-10-25'};
function message(dense){
 const events=[];for(let i=0;i<(dense?999:120);i++){
  const t=Math.floor(i*60000/(dense?999:120));
  if(dense)events.push([t,i%2?4:5,0,0,0]);
  else{events.push([t,0,0,500,400]);for(let n=1;n<9;n++)events.push([t+n*34,1,0,500+n*30,400+n*8]);events.push([t+340,2,0,740,464]);}
 }
 return{id:'qa-'+dense,clip:{version:1,durationMs:60000,touches:dense?999:120,events},photo,
  toy:{stable_id:'qa-toy',name:asset.name,metadata:{assetName:asset.name},category:'couple_dolls',item_type:'decor',status:'active'}};
}
function Probe(){
 const navigation=useNavigation();
 const [index,setIndex]=useState(-1),[record,setRecord]=useState(false),[result,setResult]=useState(''),[done,setDone]=useState(false),[screen,setScreen]=useState(false),[ordinary,setOrdinary]=useState(false),[ordinaryTouches,setOrdinaryTouches]=useState(0);
 const records=useRef([]),began=useRef(0),current=useRef(-1),phase=phases[index];current.current=index;
 const samples=useCallback(sample=>{if(current.current>=0)records.current.push({...sample,phase:current.current});},[]);
 const save=useCallback(()=>{
  const report=phases.map((p,i)=>{const ms=records.current.filter(s=>s.phase===i).flatMap(s=>s.ms).sort((a,b)=>a-b);return{...p,frames:ms.length,
   p50:ms[Math.floor(ms.length*.5)]??0,p95:ms[Math.floor(ms.length*.95)]??0,p99:ms[Math.floor(ms.length*.99)]??0,max:ms.at(-1)??0,over50:ms.filter(n=>n>50).length,
   meanFps:ms.length?1000/(ms.reduce((a,b)=>a+b,0)/ms.length):0};});
  const recording=touchRecording(),draft=touchDraft();
  void Files.writeAsStringAsync(Files.documentDirectory+'plushie-touch-native.json',JSON.stringify({hermes:!!global.HermesInternal,environment:'iOS 26.2 simulator / minified Release JS / real toy renderers / bundled non-private face fixture / business API prohibited',startedAt:began.current,done,phases:report,
   recording:recording&&{elapsed:recording.checkpoint.elapsedMs,touches:recording.checkpoint.touches,events:recording.checkpoint.events.length},draft:draft&&{touches:draft.clip.touches,events:draft.clip.events.length},jobs:touchSnapshot().jobs.map(j=>({state:j.state,touches:j.payload.clip.touches}))}));
 },[done]);
 useEffect(()=>{void Splash.hideAsync();setPlushieTouchScope({user:data.profile.id,partner:data.partner.id,pair:data.pairVersion});setQAExit(()=>setScreen(false));const timer=setInterval(save,1000);return()=>clearInterval(timer);},[save]);
 useEffect(()=>{const timeline=[];let writing=Promise.resolve();const append=kind=>{
  const r=touchRecording(),d=touchDraft();timeline.push({at:Date.now(),kind,app:AppState.currentState,elapsed:r?.checkpoint.elapsedMs??null,touches:r?.checkpoint.touches??d?.clip.touches??null,complete:!!d});
  const text=JSON.stringify(timeline.slice(-500));writing=writing.then(()=>Files.writeAsStringAsync(Files.documentDirectory+'plushie-touch-lifecycle.json',text));
 };const change=storage.addOnValueChangedListener(k=>{if([kPlushieTouchRecording.name,kPlushieTouchDraft.name].includes(k))append(k===kPlushieTouchDraft.name?'draft':'checkpoint');});
 const app=AppState.addEventListener('change',s=>append(s));append('boot');return()=>{change.remove();app.remove();};},[]);
 const finish=useCallback(()=>{setIndex(i=>{if(i+1>=phases.length){setDone(true);return -1;}return i+1;});},[]);
 if(screen)return <PlushieTouchScreen/>;
 if(ordinary)return <View style={{flex:1,paddingTop:130,alignItems:'center',backgroundColor:'#FCF4E8'}}><Text>Ordinary plushie actions: {ordinaryTouches}</Text>
  <LocalizedToy asset={asset} photo={photo} size={330} artStyle={{position:'absolute',left:0,top:0,width:330,height:330}} onInteract={()=>setOrdinaryTouches(n=>n+1)} showActions interactionScope="ordinary-qa"/>
  <Pressable accessibilityLabel="Exit ordinary toy QA" onPress={()=>setOrdinary(false)} style={{padding:18,backgroundColor:'#FFBE3B',margin:24}}><Text>Back to cards</Text></Pressable></View>;
 return <View style={{flex:1,backgroundColor:'#512B1D',paddingTop:65,alignItems:'center',justifyContent:'center'}}>
 <Text style={{color:'white',fontSize:22,fontWeight:'bold',margin:14}}>Touch replay · {phase?`${phase.quality} ${phase.dense?'dense':'normal'}`:done?'Complete':'QA'}</Text>
 {phase?<PlushieTouchPlayback key={index} message={message(phase.dense)} size={360} initialQuality={phase.quality} adaptive={false} onSample={samples} onFinish={finish}/>:
 record?<PlushieTouchRecording key="record" asset={asset} photo={photo} size={330} scope="qa-record" onComplete={c=>{setResult(`Saved ${c.touches} touches · ${c.durationMs}ms · ${c.events.length} events`);setRecord(false);}} onInterrupted={()=>{setResult('Interrupted safely');setRecord(false);}}/>:
 <><Text style={{color:'white',margin:15}}>{result||'Four full 60-second comparisons'}</Text>
  <Pressable accessibilityLabel="Start two tier benchmark" style={{padding:20,backgroundColor:'#FFF9EF',margin:12,borderRadius:20}} onPress={()=>{records.current=[];began.current=Date.now();setDone(false);setIndex(0);}}><Text>Start benchmark</Text></Pressable>
  <Pressable accessibilityLabel="Record touch QA" style={{padding:20,backgroundColor:'#FFF9EF',margin:12,borderRadius:20}} onPress={()=>setRecord(true)}><Text>Record 60 seconds</Text></Pressable></>}
 {!record&&!phase&&<><Pressable accessibilityLabel="Open recording page QA" onPress={()=>{setQAMode('record');navigation.navigate('touch');}} style={{padding:18,backgroundColor:'white',margin:8,borderRadius:16}}><Text>Recording page</Text></Pressable>
 <Pressable accessibilityLabel="Open inbox page QA" onPress={()=>{setQAMode('inbox');navigation.navigate('touch');}} style={{padding:18,backgroundColor:'white',margin:8,borderRadius:16}}><Text>Inbox page</Text></Pressable></>}
 {!record&&!phase&&<Pressable accessibilityLabel="Open ordinary toy QA" onPress={()=>setOrdinary(true)} style={{padding:18,backgroundColor:'white',margin:8,borderRadius:16}}><Text>Ordinary toy</Text></Pressable>}
 {!record&&!phase&&<Pressable accessibilityLabel="Reset Touch Note QA" onPress={()=>{[kPlushieTouchRecording,kPlushieTouchDraft,kPlushieTouch,kPlushieTouchGuide].forEach(k=>storage.remove(k.name));resetTouchQA();setPlushieTouchScope(null);setPlushieTouchScope({user:data.profile.id,partner:data.partner.id,pair:data.pairVersion});setResult('Reset');}} style={{padding:14,backgroundColor:'white',margin:8,borderRadius:16}}><Text>Reset QA</Text></Pressable>}
 {!record&&!phase&&<Pressable accessibilityLabel="Seed inbox QA" onPress={()=>{seedTouchQA();setQAMode('inbox');navigation.navigate('touch');}} style={{padding:14,backgroundColor:'white',margin:8,borderRadius:16}}><Text>Seed inbox</Text></Pressable>}
 {!record&&!phase&&<Pressable accessibilityLabel="Own default page QA" onPress={()=>{setQAMode('own');navigation.navigate('default');}} style={{padding:14,backgroundColor:'white',margin:8,borderRadius:16}}><Text>Own default page</Text></Pressable>}
 {!record&&!phase&&<Pressable accessibilityLabel="Plus history QA" onPress={()=>{seedPlusQA();setQAMode('history');navigation.navigate('touch');}} style={{padding:12,backgroundColor:'white',margin:8,borderRadius:16}}><Text>Plus history</Text></Pressable>}
 {(record||phase)&&<Pressable accessibilityLabel="Exit touch QA" onPress={()=>{setIndex(-1);setRecord(false);setResult('Exited safely');}} style={{padding:16,backgroundColor:'white',margin:16,borderRadius:18}}><Text>Exit</Text></Pressable>}
 </View>;
}
function TouchPage(){
 const navigation=useNavigation(),intervals=useRef([]),enabled=useSharedValue(AppState.currentState==='active'),last=useSharedValue(-1),buffer=useSharedValue([]),recording=useSharedValue(false);
 const samples=useCallback(ms=>{intervals.current.push(...ms);const sorted=[...intervals.current].sort((a,b)=>a-b),n=sorted.length;
  void Files.writeAsStringAsync(Files.documentDirectory+'plushie-touch-recording-performance.json',JSON.stringify({frames:n,p50:sorted[Math.floor(n*.5)],p95:sorted[Math.floor(n*.95)],p99:sorted[Math.floor(n*.99)],max:sorted.at(-1),over50:sorted.filter(v=>v>50).length,meanFps:1000*n/sorted.reduce((a,b)=>a+b,0),scope:'real Touch screen UI-frame callback during active recording only; excludes cold open before first touch and first frame after foreground; simulator, not compositor/GPU trace'}));
 },[]);
 useFrameCallback(f=>{'worklet';if(!enabled.value||!recording.value)return;if(last.value<0){last.value=f.timestamp;return;}const ms=f.timestamp-last.value;last.value=f.timestamp;
  buffer.value=[...buffer.value,ms];if(buffer.value.length>=60){runOnJS(samples)(buffer.value);buffer.value=[];}
 });
 useEffect(()=>{setQAExit(()=>navigation.goBack());setQANavigate((route,replace)=>replace?navigation.replace(route):navigation.navigate(route));const app=AppState.addEventListener('change',s=>{runOnUI(()=>{'worklet';last.value=-1;enabled.value=s==='active';})();});
  const observe=()=>{const r=touchRecording()?.checkpoint,active=!!r?.started&&r.elapsedMs<60000;runOnUI(()=>{'worklet';if(active!==recording.value){last.value=-1;if(!active&&buffer.value.length){runOnJS(samples)(buffer.value);buffer.value=[];}}recording.value=active;})();};
  const sub=storage.addOnValueChangedListener(k=>{if([kPlushieTouchRecording.name,kPlushieTouchDraft.name].includes(k))observe();});observe();return()=>{app.remove();sub.remove();};},[navigation]);
 return <PlushieTouchScreen/>;
}
function DefaultPage(){const nav=useNavigation();useEffect(()=>{setQAExit(()=>nav.goBack());setQANavigate((route,replace)=>replace?nav.replace(route):nav.navigate(route));},[nav]);return <RoomInteraction/>;}
function App(){return <GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}><Stack.Screen name="probe" component={Probe}/><Stack.Screen name="touch" component={TouchPage}/><Stack.Screen name="default" component={DefaultPage}/></Stack.Navigator></NavigationContainer></SafeAreaProvider></GestureHandlerRootView>;}
AppRegistry.registerComponent('main',()=>App);
