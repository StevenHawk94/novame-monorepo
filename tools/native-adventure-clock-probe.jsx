// Release/Hermes presentation regression. Real widget + local authoritative
// fixtures; pairing/joins and reward isolation are separately tested in SQL.
import React,{useEffect,useRef,useState} from 'react';
import {AppRegistry,View,Text,Pressable} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import * as Files from 'expo-file-system/legacy';
import {useFonts,Inter_400Regular,Inter_600SemiBold,Inter_700Bold,Inter_800ExtraBold} from '@expo-google-fonts/inter';
import {AdventureProgressScreen} from '../apps/mobile/src/components/burrow/adventure-progress-screen';
import {observeSessionIdentity} from '../apps/mobile/src/lib/session-lifecycle';
import {observeBunnyIdentity} from '../apps/mobile/src/lib/bunny-identity';
const owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222';
const Stack=createNativeStackNavigator();
function Probe(){
 const [fonts]=useFonts({Inter_400Regular,Inter_600SemiBold,Inter_700Bold,Inter_800ExtraBold});
 const [run,setRun]=useState({start:Date.now(),plus:false,join:null}),[now,setNow]=useState(Date.now());
 const phase=useRef('free-solo'),frames=useRef([]),events=useRef([]);
 useEffect(()=>{
  observeSessionIdentity(owner);
  observeBunnyIdentity({userId:owner,variant:'biscuit',revision:1,finalized:true,partnerId:partner,partnerVariant:'pinky',pairVersion:'pair'});
  void SplashScreen.hideAsync();let last=0,frame;
  const sample=t=>{if(last)frames.current.push({phase:phase.current,ms:t-last});last=t;frame=requestAnimationFrame(sample);};frame=requestAnimationFrame(sample);
  const timer=setInterval(()=>setNow(Date.now()),1000);
  const report=setInterval(()=>{
   const phases=[...new Set(frames.current.map(f=>f.phase))].map(name=>{
    const v=frames.current.filter(f=>f.phase===name).map(f=>f.ms).sort((a,b)=>a-b);
    return{name,count:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1),over50:v.filter(x=>x>50).length,
     meanFps:1000/(v.reduce((a,b)=>a+b,0)/v.length)};
   });
   void Files.writeAsStringAsync(Files.documentDirectory+'adventure-clock-native.json',JSON.stringify({hermes:!!global.HermesInternal,
    environment:'iOS simulator / minified JS / local API fixtures / real AdventureProgressScreen',events:events.current,phases}));
  },2000);
  return()=>{clearInterval(timer);clearInterval(report);cancelAnimationFrame(frame);};
 },[]);
 if(!fonts)return <View/>;
 const duration=(run.plus?3:6)*3600000,iso=n=>new Date(n).toISOString();
 const fraction=run.join?(run.join-run.start)/duration:0;
 const end=run.join?run.join+(duration-(run.join-run.start))/1.5:run.start+duration;
 const team={id:run.plus?'plus':'free',version:run.join?2:1,ruleVersion:5,leaderId:owner,followerId:run.join?partner:null,
  partnerId:partner,pairVersion:'pair',plus:run.plus,startedAt:iso(run.start),progressAt:iso(run.join??run.start),progressFraction:fraction,
  endsAt:iso(end),nudged:false,leaderVariant:'biscuit',followerVariant:'pinky'};
 const data={profile:{id:owner},partner:{id:partner,display_name:'Sam'},pairVersion:'pair',hasPlus:run.plus,specialQuests:[],
  activeAdventure:{id:team.id,status:'in_progress',started_at:iso(run.start-3000),ends_at:team.endsAt},
  adventureTeam:{userId:owner,partnerId:partner,pairVersion:'pair',adventureId:team.id,team,nudgeAvailable:!run.join}};
 function next(){
  const nextRun=run.join?{start:Date.now(),plus:!run.plus,join:null}:{...run,join:Date.now()};
  phase.current=(nextRun.plus?'plus':'free')+(nextRun.join?'-duo':'-solo');events.current.push({phase:phase.current,at:Date.now()});
  setNow(Date.now());setRun(nextRun);
 }
 return <View style={{flex:1}}>
  <AdventureProgressScreen data={data} now={now-3000} onHome={next}/>
  <Pressable accessibilityLabel="Next clock QA phase" onPress={next} style={{position:'absolute',right:10,top:60,padding:8,backgroundColor:'white',borderRadius:10}}>
   <Text>{run.plus?'Plus':'Free'} {run.join?'duo':'solo'} →</Text>
  </Pressable>
 </View>;
}
function App(){return <SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}><Stack.Screen name="probe" component={Probe}/></Stack.Navigator></NavigationContainer></SafeAreaProvider>;}
AppRegistry.registerComponent('main',()=>App);
