import {useEffect} from 'react';
import { BackHandler, Image, Platform, Linking, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {hideSplashOnce} from '@/lib/splash';
import {haptics} from '@/lib/haptics';
export const UPDATE_STORE_URL=Platform.OS==='android'
 ?'https://play.google.com/store/apps/details?id=com.burrow.app'
 :'https://apps.apple.com/app/id6763723281';
/** Root renders this INSTEAD of Stack: no Home or business popup can mount. */
export function ForceUpdateGate({message}:{message:string|null}){
 const insets=useSafeAreaInsets();
 useEffect(()=>{const back=BackHandler.addEventListener('hardwareBackPress',()=>true);return()=>back.remove();},[]);
 return <View accessibilityViewIsModal onLayout={hideSplashOnce} style={[styles.root,{paddingTop:insets.top,paddingBottom:Math.max(insets.bottom,24)}]}>
  <View style={styles.body}>
   <Image source={require('../../../assets/burrow-webp/force_update.webp')} resizeMode="contain" style={styles.art}/>
   <Text style={styles.title}>Your App Needs An Update</Text>
   <Text style={styles.message}>{message?.trim()||'To continue using this app, update it in the app store to get the latest features, content and bug fixes.'}</Text>
  </View>
  <Pressable accessibilityRole="button" accessibilityLabel="Update Now" onPress={()=>{
   void haptics.pageOpen();void Linking.openURL(UPDATE_STORE_URL).catch(()=>{});
  }} style={({pressed})=>[styles.button,{opacity:pressed?.85:1}]}><Text style={styles.buttonText}>Update Now</Text></Pressable>
 </View>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#fdf4e9',paddingHorizontal:20},
 body:{flex:1,alignItems:'center',justifyContent:'center',paddingVertical:24},
 art:{width:150,height:150,marginBottom:24},
 title:{color:'#49270f',fontSize:25,fontFamily:'Inter_900Black',textAlign:'center',marginBottom:24},
 message:{color:'#23180e',fontSize:19,lineHeight:27,fontFamily:'Inter_400Regular',textAlign:'center',paddingHorizontal:12,maxWidth:520},
 button:{backgroundColor:'#4c341c',borderRadius:10,paddingVertical:18,alignItems:'center'},
 buttonText:{color:'#fff',fontSize:20,fontFamily:'Inter_700Bold'},
});
