// Actual Collection renderer with stale test inventory; no production data.
import React,{useEffect} from 'react';
import {AppRegistry} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import {CollectionRoomScreen} from '../apps/mobile/src/components/burrow/collection-room-screen';
import manifest from '../catalog/burrow-shop-products.json';
const products=[manifest.products.find(p=>p.id==='burrow_art_cabinets_05'),manifest.products.find(p=>p.status==='active'&&p.category==='cabinets')];
const data={profile:{id:'retired-art-qa'},partner:null,catalog:products.map(p=>({stable_id:p.id,item_type:p.type,category:p.category,title:p.title,status:'active',
 metadata:{...p.metadata,artOrdinal:1},tags:p.tags,asset:p.asset})),inventory:products.map(p=>({owner_id:'retired-art-qa',item_id:p.id})),
 gifts:[],friends:[],discoveries:[],adventureCollection:{enabled:false}};
const Stack=createNativeStackNavigator();
function Collection(){return <CollectionRoomScreen data={data} onRefresh={()=>{}} onClaimGift={()=>{}}/>;}
function App(){useEffect(()=>{void SplashScreen.hideAsync();},[]);return <SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{headerShown:false,animation:'none'}}><Stack.Screen name="collection" component={Collection}/></Stack.Navigator></NavigationContainer></SafeAreaProvider>;}
AppRegistry.registerComponent('main',()=>App);
