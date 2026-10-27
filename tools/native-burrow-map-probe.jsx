// Real map, supplied assets and identity selectors; local-only navigation.
import React,{useEffect,useState} from 'react';
import {AppRegistry,View,Text,Pressable} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {BurrowMap} from '../apps/mobile/src/components/burrow/burrow-map';
import {BurrowMapScrollView} from '../apps/mobile/src/components/burrow/burrow-map-scroll-view';
import {burrowPageScrollBehavior} from '../apps/mobile/src/lib/burrow-surface';
import {observeSessionIdentity} from '../apps/mobile/src/lib/session-lifecycle';
import {queueBunnySelection,observeBunnyIdentity} from '../apps/mobile/src/lib/bunny-identity';
const Stack=createNativeStackNavigator(),owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222';
export function useBurrowEnvironment(){return{season:'autumn',period:'day',banner:'autumn-day'};}
function Map({navigation}){const[variant,setVariant]=useState('pinky');
 function select(v){queueBunnySelection(v);observeBunnyIdentity({userId:owner,variant:v,revision:Date.now(),finalized:false,partnerId:partner,partnerVariant:v==='pinky'?'biscuit':'pinky',pairVersion:'qa-pair'});setVariant(v);}
 useEffect(()=>{observeSessionIdentity(owner);select('pinky');void SplashScreen.hideAsync();},[]);
 return <View style={{flex:1,backgroundColor:'#572b1a'}}><BurrowMapScrollView style={{flex:1}} {...burrowPageScrollBehavior('burrow')} contentContainerStyle={{paddingBottom:34}}>
  <BurrowMap partnerId={partner} pairVersion="qa-pair" onRoom={room=>navigation.navigate('detail',{room})} badges={{friends_room:1,game_room:2}}/>
 </BurrowMapScrollView><Pressable accessibilityLabel="Swap QA bunny" onPress={()=>select(variant==='pinky'?'biscuit':'pinky')} style={{position:'absolute',right:8,top:64,padding:8,backgroundColor:'#fff9ef',borderRadius:8}}><Text>{variant} → swap</Text></Pressable></View>;
}
function Detail({navigation,route}){return <View style={{flex:1,backgroundColor:'#572b1a',justifyContent:'center',alignItems:'center'}}><Text style={{color:'white'}}>{route.params.room}</Text><Pressable onPress={()=>navigation.goBack()}><Text style={{color:'white',padding:30}}>Return to map</Text></Pressable></View>;}
function App(){return <SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}><Stack.Screen name="map" component={Map}/><Stack.Screen name="detail" component={Detail}/></Stack.Navigator></NavigationContainer></SafeAreaProvider>;}
AppRegistry.registerComponent('main',()=>App);
