import React,{useEffect,useState} from 'react';
import {AppRegistry,View,Text,Pressable,Image} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import SigningInScreen from '../apps/mobile/app/(auth)/signing-in';
import {HomeEntryGate} from '../apps/mobile/src/components/main/home-entry-gate';
import {BurrowEnvironmentGate} from '../apps/mobile/src/components/burrow/burrow-environment-gate';
import {beginHomeEntry,setHomeEntryExperience} from '../apps/mobile/src/lib/home-entry-readiness';
import {setSplashQARoute} from './native-splash-entry-state';
function App(){
 const [phase,setPhase]=useState('splash'),[elapsed,setElapsed]=useState(0),[taps,setTaps]=useState(0);
 useEffect(()=>{
  const start=Date.now();setHomeEntryExperience('burrow');beginHomeEntry({target:'home'});
  setSplashQARoute(()=>{setElapsed(Date.now()-start);setPhase('home');});
  void SplashScreen.hideAsync();return()=>setSplashQARoute(undefined);
 },[]);
 if(phase==='splash')return <SigningInScreen/>;
 return <HomeEntryGate><BurrowEnvironmentGate enabled><View style={{flex:1,backgroundColor:'#572b1a',alignItems:'center',justifyContent:'center',gap:24}}>
  <Text style={{color:'#FFF2DF',fontSize:24}}>Home · Offline QA</Text>
  <Image source={require('../apps/mobile/assets/burrow-webp/burrow-page/room.webp')} style={{width:210,height:210}} resizeMode="contain"/>
  <Text style={{color:'#FFF2DF'}}>Splash released in {elapsed}ms · network still pending</Text>
  <Pressable accessibilityLabel="Check Home interaction" onPress={()=>setTaps(n=>n+1)} style={{padding:20,backgroundColor:'#FFF2DF',borderRadius:16}}><Text>Home taps: {taps}</Text></Pressable>
 </View></BurrowEnvironmentGate></HomeEntryGate>;
}
AppRegistry.registerComponent('main',()=>App);
