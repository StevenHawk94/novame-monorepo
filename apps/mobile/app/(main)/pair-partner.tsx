import {useEffect,useRef,useState} from 'react';
import { Animated, AppState, Keyboard, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {router} from 'expo-router';
import {useIsFocused} from '@react-navigation/native';
import {MaterialIcons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {PairingCodeSheet,PairingInviteCard,type PairingPerson} from '@/components/onboarding/partner-pairing-ui';
import {addFriend,fetchFriends,getCachedFriends} from '@/lib/friends-api';
import {burrowClock,refreshBurrowAfterCurrent,useBurrowSnapshot} from '@/lib/burrow-store';
import {rememberPartnerConnection} from '@/lib/partner-pairing';
import {sessionEpoch,sessionUserId} from '@/lib/session-lifecycle';
import {withDeadline} from '@/lib/async-lifecycle';
import {haptics} from '@/lib/haptics';
import {registerOverlay} from '@/lib/overlay-presence';
import {PartnerConnectedScreen} from '@/components/onboarding/partner-connected-screen';

export default function PairPartnerModal(){
  const {data}=useBurrowSnapshot(),insets=useSafeAreaInsets(),focused=useIsFocused();
  const owner=useRef(sessionUserId()??data?.profile.id),epoch=useRef(sessionEpoch());
  const profile=useRef(data?.profile);if(data&&data.profile.id===owner.current)profile.current=data.profile;
  const live=useRef(true),leaving=useRef(false),locked=useRef(false),active=useRef(focused);active.current=focused;
  const [inviteCode,setInviteCode]=useState<string|null>(()=>getCachedFriends().inviteCode),[loading,setLoading]=useState(()=>!getCachedFriends().inviteCode),[inviteError,setInviteError]=useState<string|null>(null),[copied,setCopied]=useState(false);
  const [codeOpen,setCodeOpen]=useState(false),[code,setCode]=useState(''),[pairing,setPairing]=useState(false),[error,setError]=useState<string|null>(null);
  const [connectionComplete,setConnectionComplete]=useState(false);
  const inviteOperation=useRef(0),copiedTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const codeMotion=useRef(new Animated.Value(0)).current;
  const valid=()=>live.current&&!leaving.current&&active.current&&epoch.current===sessionEpoch()&&!!owner.current&&owner.current===sessionUserId();
  useEffect(()=>{live.current=true;return()=>{live.current=false;inviteOperation.current++;clearTimeout(copiedTimer.current);codeMotion.stopAnimation();};},[]);
  useEffect(()=>registerOverlay({}),[]);
  function close(){
    if(leaving.current)return;leaving.current=true;Keyboard.dismiss();
    if(router.canGoBack())router.back();else router.replace('/(main)/(tabs)');
  }
  function connected(partner:PairingPerson){
    if(!valid()||!profile.current)return;
    const self={userId:owner.current!,name:profile.current.display_name?.trim()||'You',avatarUrl:profile.current.avatar_url??undefined,isDefaultAvatar:profile.current.is_default_avatar!==false};
    if(!rememberPartnerConnection(self,partner))return;
    leaving.current=true;Keyboard.dismiss();void haptics.success().catch(()=>{});
    // Keep the same native route: no dismiss/reopen of the underlying room.
    setConnectionComplete(true);
  }
  async function prepareInvite(){
    if(!valid())return;
    const cached=getCachedFriends().inviteCode;
    if(cached){setInviteCode(cached);setLoading(false);setInviteError(null);return;}
    const operation=++inviteOperation.current;setLoading(true);setInviteError(null);
    try{
      const status=await withDeadline(fetchFriends(),12_000);
      if(!valid()||operation!==inviteOperation.current)return;
      if(!status.inviteCode)throw Error('invite_unavailable');
      setInviteCode(status.inviteCode);
    }catch{if(valid()&&operation===inviteOperation.current)setInviteError('Couldn’t load your invite code. Check your connection and retry.');}
    finally{if(valid()&&operation===inviteOperation.current)setLoading(false);}
  }
  useEffect(()=>{
    if(!focused)return;
    void prepareInvite();
    // Fresh bootstrap, not an old friends cache, confirms incoming pairing.
    const check=()=>{if(valid()&&AppState.currentState==='active'&&!locked.current)void refreshBurrowAfterCurrent({silent:true}).catch(()=>{});};
    check();const timer=setInterval(check,5_000),app=AppState.addEventListener('change',state=>{if(state==='active')check();});
    return()=>{inviteOperation.current++;clearInterval(timer);app.remove();};
  },[focused]);
  useEffect(()=>{
    if(!pairing&&data&&data.profile.id===owner.current&&data.partner)connected({userId:data.partner.id,name:data.partner.display_name?.trim()||'Partner',avatarUrl:data.partner.avatar_url??undefined,isDefaultAvatar:data.partner.is_default_avatar!==false});
  },[focused,pairing,data?.profile.id,data?.partner?.id]);
  useEffect(()=>{
    if(!codeOpen)return;
    codeMotion.setValue(0);
    const animation=Animated.timing(codeMotion,{toValue:1,duration:220,useNativeDriver:true});animation.start();return()=>animation.stop();
  },[codeOpen]);
  const closeCode=()=>{Keyboard.dismiss();Animated.timing(codeMotion,{toValue:0,duration:160,useNativeDriver:true}).start(({finished})=>{if(finished&&valid())setCodeOpen(false);});};
  async function copyCode(){
    if(!inviteCode||!valid())return;
    try{await Clipboard.setStringAsync(inviteCode);if(!valid())return;setCopied(true);clearTimeout(copiedTimer.current);copiedTimer.current=setTimeout(()=>{if(valid())setCopied(false);},2_000);}
    catch{if(valid())setInviteError('Couldn’t copy the code. Please try again.');}
  }
  async function shareCode(){
    if(!inviteCode||!valid())return;
    try{await Share.share({message:`Join my Burrow. Enter my code ${inviteCode} and we’ll be connected right away.`});}
    catch{if(valid())setInviteError('Couldn’t share your invite. Try again, or copy your code.');}
  }
  async function pair(){
    const normalized=code.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    if(!valid()||locked.current||normalized.length!==6)return;
    locked.current=true;setPairing(true);setError(null);Keyboard.dismiss();
    const requestEpoch=epoch.current;
    try{
      const result=await addFriend(normalized,{relationship:'Partner',deferRefresh:true});
      if(requestEpoch!==sessionEpoch()||owner.current!==sessionUserId())return;
      if(!result.ok){if(valid())setError(result.error==='network'?'Couldn’t connect. Check your connection and try again.':'Double-check your partner’s Burrow code and try again.');return;}
      // A late confirmed mutation still refreshes the account even if X was
      // tapped, but it never navigates an already-closed screen.
      void refreshBurrowAfterCurrent({silent:true,after:burrowClock()}).catch(()=>{});
      if(!valid())return;
      if(result.partner)connected({userId:result.partner.userId,name:result.partner.displayName||result.pairedName||'Partner',avatarUrl:result.partner.avatarUrl,isDefaultAvatar:result.partner.isDefaultAvatar});
      else setError('Your connection is saved. Please close this window and reopen to refresh your burrow.');
    }catch{if(valid())setError('Couldn’t connect. Check your connection and try again.');}
    finally{locked.current=false;if(valid())setPairing(false);}
  }
  if(connectionComplete)return <PartnerConnectedScreen/>;
  return <View style={[s.scrim,{paddingTop:insets.top+20,paddingBottom:insets.bottom+20}]}>
    <Pressable style={StyleSheet.absoluteFill} accessibilityElementsHidden={codeOpen} importantForAccessibility={codeOpen?'no-hide-descendants':'auto'} accessibilityRole="button" accessibilityLabel="Dismiss partner invitation" onPress={close}/>
    <View style={s.card} accessibilityViewIsModal accessibilityElementsHidden={codeOpen} importantForAccessibility={codeOpen?'no-hide-descendants':'auto'} pointerEvents={codeOpen?'none':'auto'}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{flexGrow:0,flexShrink:1}} contentContainerStyle={s.content}>
        <Text accessibilityRole="header" style={s.title}>Invite your partner</Text><Text style={s.subtitle}>Your little world starts with two.</Text>
        <PairingInviteCard inviteCode={inviteCode} copied={copied} copyCode={()=>void copyCode()} shareCode={()=>void shareCode()} openCode={()=>{setError(null);setCodeOpen(true);}} loading={loading} error={inviteError} retry={()=>void prepareInvite()}/>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Close partner invitation" onPress={close} style={s.close}><MaterialIcons name="close" size={27} color="#FFF9EF"/></Pressable>
    </View>
    {codeOpen&&<Animated.View style={[StyleSheet.absoluteFill,{opacity:codeMotion,transform:[{translateY:codeMotion.interpolate({inputRange:[0,1],outputRange:[40,0]})}]}]}><PairingCodeSheet embedded visible code={code} onChange={value=>setCode(value.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,6))} onClose={closeCode} onPair={()=>void pair()} pairing={pairing} error={error}/></Animated.View>}
  </View>;
}
const s=StyleSheet.create({scrim:{flex:1,backgroundColor:'rgba(0,0,0,.6)',paddingHorizontal:20,alignItems:'center',justifyContent:'center'},card:{width:'100%',maxWidth:440,maxHeight:'100%',borderRadius:24,backgroundColor:'#FFFBEF',overflow:'hidden'},content:{paddingHorizontal:16,paddingTop:70,paddingBottom:44,gap:14},title:{fontSize:29,fontFamily:'Inter_800ExtraBold',color:'#49270F',textAlign:'center'},subtitle:{fontSize:17,lineHeight:25,fontFamily:'Inter_400Regular',color:'#49270F',textAlign:'center',marginBottom:20},close:{position:'absolute',right:12,top:12,width:34,height:34,borderRadius:17,backgroundColor:'#572B1A',alignItems:'center',justifyContent:'center'}});
