// Offline native regression surface. Bundled with the installed production
// Hermes host; no real account, API request, wallet or purchase is used.
import React,{useEffect,useState} from 'react';
import {AppRegistry,View,Text,Pressable} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {PlushieFaceMask} from '../apps/mobile/src/components/burrow/plushie-face-mask';
import masks from '../apps/mobile/src/lib/generated/plushie-face-masks.json';
const Stack=createNativeStackNavigator();
const entries=Object.entries(masks),names=['Game Room','Surprise Room','Music','Adventure','Collection','Home'];
function Probe(){
 const [phase,setPhase]=useState(0),[cycle,setCycle]=useState(0),[pressed,setPressed]=useState('none');
 useEffect(()=>{void SplashScreen.hideAsync();},[]);
 return <View style={{flex:1,backgroundColor:'#482819',paddingTop:60,paddingHorizontal:20}}>
  <Text style={{fontSize:24,color:'white',marginBottom:14}}>Isolation QA — {phase===1?'faces':'cards'} / {cycle}</Text>
  <Pressable accessibilityLabel="Next regression phase" onPress={()=>{setPhase(p=>{if(p===1)setCycle(c=>c+1);return p===1?0:1;});}} style={{padding:15,backgroundColor:'white',marginBottom:14}}><Text>NEXT · mount/unmount faces</Text></Pressable>
  <Text style={{color:'white',marginBottom:10}}>Pressed: {pressed}. Masks: all 33 variants.</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap'}}>
   {phase===1?entries.map(([name,mask])=><View key={name} style={{width:62,height:70,margin:2}}>
    <View style={{width:58,height:48}}><PlushieFaceMask asset={{name,width:mask.canvas[0],height:mask.canvas[1],photoBounds:mask.bounds,source:0}} placeholder/></View>
    <Text numberOfLines={1} style={{color:'white',fontSize:9}}>{name}</Text>
   </View>):names.map((name,i)=><Pressable key={'ordinary:'+cycle+':'+name} accessibilityLabel={'Open '+name} onPress={()=>setPressed(name)}
    style={{width:145,height:112,backgroundColor:i%2?'#f9f2e5':'#ffd166',margin:7,alignItems:'center',justifyContent:'center'}}>
     <Text style={{fontSize:17,color:'#482819'}}>{name}</Text><Text>Card {i+1} visible</Text>
   </Pressable>)}
  </View>
 </View>;
}
function App(){return <NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}><Stack.Screen name="probe" component={Probe}/></Stack.Navigator></NavigationContainer>;}
AppRegistry.registerComponent('main',()=>App);
