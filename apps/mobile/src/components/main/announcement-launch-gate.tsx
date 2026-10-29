import {useEffect,useRef,useState} from 'react';
import { AppState, BackHandler, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {Image} from 'expo-image';
import {useSegments} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppViewport} from '@/lib/app-viewport';
import {useHomeEntry} from '@/lib/use-home-entry';
import {isHomeEntryRoute} from '@/lib/home-entry-readiness';
import {sessionUserId,subscribeSessionIdentity} from '@/lib/session-lifecycle';
import {clearPreparedAnnouncement,markAnnouncementRead,type Announcement} from '@/lib/announcements-api';
import {hideSplashOnce} from '@/lib/splash';
import {BurrowLaunchScreen} from './burrow-launch-screen';

/** Root already owns the overlay reservation before Home mounts. Keep Home
 * preparing underneath, but never reveal it or grant another popup a slot. */
export function AnnouncementLaunchGate({announcement,userId,onClose}:{announcement:Announcement;userId:string;onClose:()=>void}){
 const segments=useSegments(),entry=useHomeEntry(),insets=useSafeAreaInsets(),size=useAppViewport();
 const [error,setError]=useState(false),[opening,setOpening]=useState(false);
 const closed=useRef(false),alive=useRef(true),atHome=isHomeEntryRoute(segments);
 const ready=atHome&&!entry.pending;
 const finish=(read:boolean)=>{
  if(closed.current)return;closed.current=true;
  if(read&&sessionUserId()===userId){clearPreparedAnnouncement(userId,announcement.id);void markAnnouncementRead(userId,announcement.id);}
  onClose();
 };
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>subscribeSessionIdentity(()=>{if(sessionUserId()!==userId)finish(false);}),[userId]);
 useEffect(()=>{
  // A launch deep-link/auth route is not Home. Do not hijack it or consume the announcement.
  if(segments.length>1&&!atHome)finish(false);
 },[segments.join('/'),atHome]);
 useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',()=>{if(ready)finish(true);return true;});return()=>listener.remove();},[ready]);
 async function action(){
  if(opening||closed.current||AppState.currentState!=='active')return;
  const url=announcement.action_url?.trim();if(!url){finish(true);return;}
  setOpening(true);setError(false);
  try{if(!/^https:\/\//i.test(url))throw Error('invalid_link');await Linking.openURL(url);if(alive.current&&sessionUserId()===userId)finish(true);}
  catch{if(alive.current){setOpening(false);setError(true);}}
 }
 const art=Math.min(size.width-64,Math.max(160,size.height*.385));
 return <View style={styles.cover} accessibilityViewIsModal onLayout={hideSplashOnce}>
  {!ready?<BurrowLaunchScreen/>:<View style={[styles.page,{paddingTop:insets.top+16,paddingBottom:Math.max(insets.bottom,20)}]}>
   <Pressable accessibilityRole="button" accessibilityLabel="Close announcement" onPress={()=>finish(true)} style={styles.close}><Text style={styles.cross}>×</Text></Pressable>
   <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <Text style={styles.title}>{announcement.title}</Text>
    <View style={[styles.frame,{width:art,height:art}]}><Image source={{uri:announcement.image_url!}} style={styles.image} contentFit="contain" transition={0}/></View>
    <Text style={styles.description}>{announcement.content}</Text>
   </ScrollView>
   {error?<Text accessibilityRole="alert" style={styles.error}>Couldn’t open this link. Please try again.</Text>:null}
   <Pressable accessibilityRole="button" accessibilityLabel={announcement.button_text?.trim()||'Continue'} disabled={opening} onPress={()=>void action()} style={styles.button}>
    <Text style={styles.buttonText}>{announcement.button_text?.trim()||'Continue'}</Text>
   </Pressable>
  </View>}
 </View>;
}
const styles=StyleSheet.create({
 cover:{...StyleSheet.absoluteFillObject,zIndex:10000,elevation:10000,backgroundColor:'#542914'},
 page:{flex:1,paddingHorizontal:20,backgroundColor:'#542914'},
 close:{alignSelf:'flex-end',width:40,height:40,borderRadius:20,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},
 cross:{color:'#542914',fontSize:38,lineHeight:40,fontFamily:'Inter_500Medium'},
 content:{flexGrow:1,alignItems:'center',justifyContent:'center',paddingVertical:28,gap:28},
 title:{color:'#fff',fontFamily:'Inter_800ExtraBold',fontSize:26,textAlign:'center'},
 frame:{padding:10,borderRadius:16,backgroundColor:'#fff',overflow:'hidden'},image:{width:'100%',height:'100%',borderRadius:8},
 description:{color:'#fff',fontFamily:'Inter_400Regular',fontSize:20,lineHeight:28,textAlign:'center',paddingHorizontal:12},
 error:{color:'#fff',fontSize:14,textAlign:'center',marginBottom:12},
 button:{backgroundColor:'#ffc447',borderRadius:10,paddingVertical:18,alignItems:'center',marginTop:16},
 buttonText:{fontFamily:'Inter_700Bold',fontSize:20,color:'#49270f'},
});
