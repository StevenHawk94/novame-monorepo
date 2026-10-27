// Offline native Release/Hermes QA. Real BurrowShop/preview/card/image/gesture
// widgets; only business transport/storage are isolated by the build helper.
import React,{Profiler,useEffect,useState} from 'react';
import {AppRegistry,View,Text,Pressable} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Files from 'expo-file-system/legacy';
import {useFonts,Inter_400Regular,Inter_600SemiBold,Inter_700Bold,Inter_800ExtraBold} from '@expo-google-fonts/inter';
import manifest from '../catalog/burrow-shop-products.json';
import {BurrowShop} from '../apps/mobile/src/components/burrow/burrow-shop';
import {observeSessionIdentity} from '../apps/mobile/src/lib/session-lifecycle';
import {observeBunnyIdentity,adoptBunnyOnHome} from '../apps/mobile/src/lib/bunny-identity';
const owner='11111111-1111-4111-8111-111111111111';
const catalog=manifest.products.filter(p=>p.status==='active').map(p=>({...p,stable_id:p.id,item_type:p.type,
 price:p.seed.price,plus_only:p.seed.plusOnly,tradable:p.seed.tradable}));
const data={profile:{id:owner,timezone_name:'America/Los_Angeles'},partner:null,pairVersion:null,hasPlus:true,
 catalog,inventory:catalog.map(p=>({owner_id:owner,item_id:p.stable_id})),loadouts:[],roomPhotos:[],wallet:{balance:100000}};
const Stack=createNativeStackNavigator(),frames=[],renders=[];let live=false,last=0,phase='outfits-cold',started=0;
global.__decorateCommits=[];
function sample(t){if(live){if(last)frames.push({phase,ms:t-last});last=t;requestAnimationFrame(sample);}}
function summary(name){const a=frames.filter(f=>f.phase===name).map(f=>f.ms).sort((a,b)=>a-b);
 return{name,count:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1),over50:a.filter(x=>x>50).length,
 meanFps:a.length?1000/(a.reduce((s,x)=>s+x,0)/a.length):0};}
function Decorate({navigation}){
 global.__decorateBack=()=>navigation.goBack();
 const [fonts]=useFonts({Inter_400Regular,Inter_600SemiBold,Inter_700Bold,Inter_800ExtraBold}),[ready,setReady]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{
  observeSessionIdentity(owner);observeBunnyIdentity({userId:owner,variant:'pinky',revision:1,finalized:true,partnerId:null,partnerVariant:null,pairVersion:null});
  void adoptBunnyOnHome(async()=>{},()=>true).then(()=>setReady(true));void SplashScreen.hideAsync();
  return()=>{live=false;};
 },[]);
 useEffect(()=>{if(fonts&&ready){live=true;last=0;started=performance.now();requestAnimationFrame(sample);}return()=>{live=false;};},[fonts,ready]);
 if(!fonts||!ready)return <View/>;
 const save=async()=>{live=false;const report={at:new Date().toISOString(),hermes:!!global.HermesInternal,
  environment:'actual BurrowShop + HomeArtScene + static composite / minified native Hermes / offline business fixture',
  productionBusinessApi:'stubbed',physicalDevice:false,measurement:'JS RAF, not independent UI compositor or tap-to-photon',
  elapsed:performance.now()-started,frames:['outfits-cold','outfits-warm','furniture','return'].map(summary),renders,
  commits:global.__decorateCommits};
  await Files.writeAsStringAsync(Files.documentDirectory+'decorate-native.json',JSON.stringify(report));setSaved(true);};
 return <View style={{flex:1}}><Profiler id="real-decorate" onRender={(id,type,duration)=>renders.push({phase,type,duration,at:performance.now()})}>
  <BurrowShop data={data} section="decorate" initialCategory="outfits" away={false}/></Profiler>
  <View style={{position:'absolute',left:8,right:8,bottom:5,flexDirection:'row',justifyContent:'space-between'}}>
   {['outfits-warm','furniture','return'].map(p=><Pressable key={p} accessibilityLabel={'QA '+p} onPress={()=>{phase=p;last=0;}} style={{backgroundColor:'white',padding:5}}><Text>{p}</Text></Pressable>)}
   <Pressable accessibilityLabel="QA save report" onPress={save} style={{backgroundColor:'white',padding:5}}><Text>{saved?'Saved':'Save QA'}</Text></Pressable>
  </View></View>;
}
function Landing({navigation}){return <View style={{flex:1,backgroundColor:'#FFF9EF',alignItems:'center',justifyContent:'center'}}>
 <Pressable accessibilityLabel="Open real Decorate" onPress={()=>navigation.navigate('decorate')}><Text style={{fontSize:24}}>Open real Decorate</Text></Pressable></View>;}
function App(){return <GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}>
 <Stack.Screen name="landing" component={Landing}/><Stack.Screen name="decorate" component={Decorate}/>
 </Stack.Navigator></NavigationContainer></SafeAreaProvider></GestureHandlerRootView>;}
AppRegistry.registerComponent('main',()=>App);
