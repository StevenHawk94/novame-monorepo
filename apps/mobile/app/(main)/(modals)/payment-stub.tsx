import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {router} from 'expo-router';
/** Old deep links cannot revive a retired cash-payment flow. */
export default function RetiredPayment(){return <View style={{flex:1,backgroundColor:'#FFF8EC',alignItems:'center',justifyContent:'center',padding:24,gap:24}}>
  <Text style={{fontSize:20,textAlign:'center'}}>This payment option is no longer available.</Text>
  <Pressable accessibilityRole="button" onPress={()=>router.canGoBack()?router.back():router.replace('/(main)/(tabs)')} style={{padding:20}}><Text>Back to Burrow</Text></Pressable>
</View>;}
