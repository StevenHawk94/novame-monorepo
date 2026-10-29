import React,{useEffect,useState} from 'react';
import {AppRegistry,View,Text,Pressable,ScrollView} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {AdventureEntry} from '../apps/mobile/src/components/burrow/adventure-entry';
import {AdventureJournalScreen} from '../apps/mobile/src/components/burrow/adventure-journal-screen';
import {AdventureReady} from '../apps/mobile/src/components/burrow/adventure-record-completion';
import {observeSessionIdentity} from '../apps/mobile/src/lib/session-lifecycle';
import {queueBunnySelection} from '../apps/mobile/src/lib/bunny-identity';
import {ADVENTURE_LOG_BACKGROUND as bg} from '../apps/mobile/src/lib/burrow-surface';
const Stack=createNativeStackNavigator();
function Entry({navigation}){return <ScrollView style={{flex:1,backgroundColor:bg}} contentContainerStyle={{flexGrow:1,paddingBottom:34}}>
 <AdventureEntry onWrite={()=>navigation.navigate('write')} onTap={()=>navigation.navigate('ready')}/>
</ScrollView>;}
function Ready({navigation}){const[variant,setVariant]=useState('pinky');return <View style={{flex:1,backgroundColor:bg,padding:20,paddingTop:64,paddingBottom:48}}>
 <Pressable accessibilityLabel="Toggle QA bunny" onPress={()=>{const next=variant==='pinky'?'biscuit':'pinky';queueBunnySelection(next);setVariant(next);}}><Text style={{color:'white'}}>{variant} — switch QA bunny</Text></Pressable>
 <ScrollView contentContainerStyle={{flexGrow:1}}><AdventureReady onStart={()=>navigation.replace('done')} allowNavigation/></ScrollView>
</View>;}
function Done({navigation}){return <View style={{flex:1,backgroundColor:bg,justifyContent:'center',alignItems:'center'}}>
 <Pressable onPress={()=>navigation.navigate('entry')}><Text style={{color:'white'}}>Start accepted — return to entry</Text></Pressable>
</View>;}
function App(){useEffect(()=>{observeSessionIdentity('11111111-1111-4111-8111-111111111111');queueBunnySelection('pinky');void SplashScreen.hideAsync();},[]);
 return <SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}>
  <Stack.Screen name="entry" component={Entry}/><Stack.Screen name="write" component={AdventureJournalScreen}/><Stack.Screen name="ready" component={Ready}/><Stack.Screen name="done" component={Done}/>
 </Stack.Navigator></NavigationContainer></SafeAreaProvider>;}
AppRegistry.registerComponent('main',()=>App);
