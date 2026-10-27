// Isolated Release/Hermes fixture: REAL widgets, no production auth or network.
import React,{useEffect,useState} from 'react';
import {AppRegistry,View,Text,Pressable,ScrollView} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Files from 'expo-file-system/legacy';
import {useFonts,Inter_400Regular,Inter_600SemiBold,Inter_700Bold,Inter_800ExtraBold} from '@expo-google-fonts/inter';
import {AdventureProgressScreen} from '../apps/mobile/src/components/burrow/adventure-progress-screen';
import {ChooseBunnyPage} from '../apps/mobile/src/components/onboarding/choose-bunny-page';
import {OutfitBunny} from '../apps/mobile/src/components/burrow/outfit-bunny';
import {OutfitThumbnail} from '../apps/mobile/src/components/burrow/outfit-thumbnail';
import {OUTFIT_LAYERS} from '../apps/mobile/src/lib/burrow-outfit-assets';
import {observeSessionIdentity} from '../apps/mobile/src/lib/session-lifecycle';
import {observeBunnyIdentity,adoptBunnyOnHome} from '../apps/mobile/src/lib/bunny-identity';
const Stack=createNativeStackNavigator(),owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222';
const initial=Date.now(),frames=[],stages=[],names=['choose','solo-free','duo-free','solo-plus','duo-plus','outfits-cold-stress','home-warm','cards','summary'];
const keys=Object.keys(OUTFIT_LAYERS),outfit=key=>({stable_id:'qa:'+key,asset:{outfitKey:key},title:key,category:'outfits'});
let currentPhase=0,last=0;
function sample(t){if(last)frames.push({phase:currentPhase,ms:t-last});last=t;requestAnimationFrame(sample);}
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
function Probe(){
 const [fonts]=useFonts({Inter_400Regular,Inter_600SemiBold,Inter_700Bold,Inter_800ExtraBold});
 const [phase,setPhase]=useState(0),[choice,setChoice]=useState('biscuit'),[tick,setTick]=useState(Date.now()),[key,setKey]=useState('default'),[clicked,setClicked]=useState(false);
 useEffect(()=>{
  observeSessionIdentity(owner);observeBunnyIdentity({userId:owner,variant:null,revision:0,finalized:false,partnerId:null,partnerVariant:null,pairVersion:null});
  void SplashScreen.hideAsync();requestAnimationFrame(sample);
  const clock=setInterval(()=>setTick(Date.now()),1000);
  return()=>clearInterval(clock);
 },[]);
 useEffect(()=>{
  currentPhase=phase;stages.push({phase:name(),at:Date.now()});
  if(phase===1)observeBunnyIdentity({userId:owner,variant:'biscuit',revision:1,finalized:true,partnerId:partner,partnerVariant:'pinky',pairVersion:'pair'});
  const timer=setTimeout(()=>setPhase(p=>Math.min(8,p+1)),phase===5?16000:phase===6?20000:phase===8?100000:8000);
  if(phase===5){observeBunnyIdentity({userId:owner,variant:'pinky',revision:2,finalized:true,partnerId:partner,partnerVariant:'biscuit',pairVersion:'pair'});
   void adoptBunnyOnHome(async()=>{},()=>true);}
  if(phase===6)setKey('default');
  let i=0;const clothes=phase===5?setInterval(()=>{setKey(keys[i++%keys.length]);},850):undefined;
  return()=>{clearTimeout(timer);if(clothes)clearInterval(clothes);};
 },[phase]);
 function name(){return names[phase];}
 useEffect(()=>{
  const report={environment:'real native widgets / minified Hermes / local business fixtures',hermes:!!global.HermesInternal,physicalDevice:false,productionBusinessApi:'stubbed',hostNativeSdkNetwork:'not asserted',stages,
   frames:names.map((name,index)=>{const v=frames.filter(f=>f.phase===index).map(f=>f.ms).sort((a,b)=>a-b);return{name,count:v.length,
    p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1),over50:v.filter(x=>x>50).length,meanFps:v.length?1000/(v.reduce((a,b)=>a+b,0)/v.length):0};})};
  void Files.writeAsStringAsync(Files.documentDirectory+'dual-bunny-native.json',JSON.stringify(report));
 },[phase]);
 if(!fonts)return <View/>;
 let content;
 if(phase===0)content=<View style={{flex:1,backgroundColor:'#FCF4E8'}}><ChooseBunnyPage value={choice} onChange={setChoice}/></View>;
 else if(phase<=4){
  const plus=phase>=3,couple=phase===2||phase===4,base=(plus?3:6)*3600000;
  const started=initial-base/3,joinedAt=initial+8000*(plus?3:1),end=couple?joinedAt+(started+base-joinedAt)/1.5:started+base;
  const team={id:plus?'plus':'free',version:couple?2:1,ruleVersion:5,leaderId:owner,followerId:couple?partner:null,partnerId:partner,pairVersion:'pair',plus,startedAt:new Date(started).toISOString(),progressAt:new Date(couple?joinedAt:started).toISOString(),progressFraction:couple?(joinedAt-started)/base:0,endsAt:new Date(end).toISOString(),nudged:false,leaderVariant:'biscuit',followerVariant:'pinky'};
  const data={profile:{id:owner},partner:{id:partner,display_name:'Sam'},pairVersion:'pair',hasPlus:plus,specialQuests:[],activeAdventure:{id:team.id,status:'in_progress',started_at:team.startedAt,ends_at:team.endsAt},adventureTeam:{userId:owner,partnerId:partner,pairVersion:'pair',adventureId:team.id,team,nudgeAvailable:true}};
  content=<AdventureProgressScreen data={data} now={tick} onHome={()=>setPhase(5)}/>;
 }else if(phase===5||phase===6)content=<View style={{flex:1,backgroundColor:'#FCF4E8',alignItems:'center',paddingTop:110}}>
  <Text style={{fontSize:20}}>Pinky · {key}</Text><OutfitBunny outfit={outfit(key)} variant="pinky" width={300} height={400}/>
  <ScrollView horizontal style={{maxHeight:130}}>{keys.map(k=><OutfitThumbnail key={k} outfit={outfit(k)} size={100}/>)}</ScrollView>
 </View>;
 else if(phase===7)content=<View style={{flex:1,paddingTop:120,backgroundColor:'#482819',alignItems:'center'}}>
  {['Game Room','Surprise Room','Music','Plushie Collection'].map(label=><Pressable key={label} onPress={()=>setClicked(true)} style={{backgroundColor:'#f9f2e5',width:300,height:80,margin:12,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:22}}>{label}</Text></Pressable>)}
  <Text style={{color:'white'}}>Touch received: {String(clicked)}</Text>
 </View>;
 else content=<View style={{flex:1,paddingTop:120,backgroundColor:'#FCF4E8'}}><Text style={{fontSize:24,textAlign:'center'}}>QA complete · Hermes {String(!!global.HermesInternal)}</Text>
  {names.map((name,index)=>{const v=frames.filter(f=>f.phase===index).map(f=>f.ms),avg=v.reduce((a,b)=>a+b,0)/v.length;return <Text key={name} style={{fontSize:17,padding:10}}>{name}: {(1000/avg).toFixed(1)} fps · &gt;50ms {v.filter(x=>x>50).length}</Text>;})}
 </View>;
 return <View style={{flex:1}}>{content}<Pressable accessibilityLabel="Next QA phase" onPress={()=>setPhase(p=>(p+1)%9)} style={{position:'absolute',bottom:20,right:12,padding:8,backgroundColor:'#fff',borderRadius:8}}><Text>QA {name()} →</Text></Pressable></View>;
}
function App(){return <SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}><Stack.Screen name="probe" component={Probe}/></Stack.Navigator></NavigationContainer></SafeAreaProvider>;}
AppRegistry.registerComponent('main',()=>App);
