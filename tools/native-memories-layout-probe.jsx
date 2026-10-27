import React,{useEffect} from 'react';
import {AppRegistry,Pressable,Text,View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import {Feather} from '@expo/vector-icons';
import {useFonts} from 'expo-font';
import {CoupleJournalScreen} from '../apps/mobile/src/components/burrow/couple-journal-screen';
import {cacheCoupleJournal,configureJournal} from '../apps/mobile/src/lib/couple-journal';
import {nav,data,fixture} from './native-memories-layout-state';
configureJournal(data);cacheCoupleJournal(`${data.profile.id}:layout-qa`,fixture);
const Stack=createNativeStackNavigator();
function Home({navigation}){return <View style={{flex:1,backgroundColor:'#5A301D',alignItems:'center',justifyContent:'center'}}><Pressable accessibilityLabel="Open Memories QA" style={{padding:24,backgroundColor:'#FFE7C2',borderRadius:20}} onPress={()=>navigation.navigate('Journal')}><Text>Open Memories QA</Text></Pressable></View>;}
function App(){const[ready]=useFonts(Feather.font);useEffect(()=>{if(ready)void SplashScreen.hideAsync();},[ready]);if(!ready)return null;
return <SafeAreaProvider><NavigationContainer ref={ref=>nav.current=ref}><Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="Home" component={Home}/><Stack.Screen name="Journal" component={CoupleJournalScreen}/></Stack.Navigator></NavigationContainer></SafeAreaProvider>;}
AppRegistry.registerComponent('main',()=>App);
