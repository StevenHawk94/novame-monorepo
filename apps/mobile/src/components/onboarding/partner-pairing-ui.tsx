import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import {Image} from 'expo-image';
import {MaterialIcons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {UserAvatar} from '@/components/ui/user-avatar';
import {ONBOARDING_CREAM as cream,ONBOARDING_INK as ink,ONBOARDING_SOIL as soil,onboardingMetrics} from '@/lib/burrow-onboarding-design';

export type PairingPerson={userId?:string;name:string;avatarUrl?:string;isDefaultAvatar?:boolean};
export function PairingInviteCard({inviteCode,copied,copyCode,shareCode,openCode,loading=false,error,retry}:{
  inviteCode:string|null;copied:boolean;copyCode:()=>void;shareCode:()=>void;openCode:()=>void;loading?:boolean;error?:string|null;retry?:()=>void;
}){
  return <View style={s.inviteCard}>
    <Text style={s.label}>Your invite code</Text>
    <View style={s.codeRow}><Text adjustsFontSizeToFit numberOfLines={1} style={s.code}>{inviteCode||'···-···'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Copy invite code" onPress={copyCode} disabled={!inviteCode} style={s.copy}><MaterialIcons name={copied?'check':'content-copy'} size={26} color={ink}/></Pressable></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Share Invite" disabled={!inviteCode} onPress={shareCode} style={({pressed})=>[s.share,(!inviteCode||pressed)&&{opacity:.6}]}><Text style={s.buttonText}>Share Invite</Text></Pressable>
    {loading&&!inviteCode&&<Text accessibilityLiveRegion="polite" style={s.hint}>Preparing your invite…</Text>}
    {error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {error&&retry&&<Pressable accessibilityRole="button" accessibilityLabel="Retry invite" onPress={retry} style={s.retry}><Text style={s.label}>Retry</Text></Pressable>}
    <View style={s.divider}/><Text style={s.label}>Have their code?</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Enter partner’s code" onPress={openCode} style={s.enterCode}><Text style={s.enterText}>Enter partner’s code</Text><MaterialIcons name="chevron-right" size={30} color={ink}/></Pressable>
  </View>;
}

export function PairingCodeSheet({visible,code,onChange,onClose,onPair,pairing,error,embedded=false}:{
  visible:boolean;code:string;onChange:(value:string)=>void;onClose:()=>void;onPair:()=>void;pairing:boolean;error?:string|null;embedded?:boolean;
}){
  const insets=useSafeAreaInsets();
  const content=<KeyboardAvoidingView style={s.codeOverlay} behavior={Platform.OS==='ios'?'padding':'height'}>
    <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss code entry" onPress={onClose}/>
    <View style={s.codeSheet} accessibilityViewIsModal>
      <ScrollView removeClippedSubviews={false} bounces={false} keyboardShouldPersistTaps="handled" style={{flexGrow:0,flexShrink:1}} contentContainerStyle={[s.codeContent,{paddingBottom:Math.max(38,insets.bottom+24)}]}>
        <Text style={s.codeTitle}>Enter Their Code</Text>
        <View style={s.boxes}>{Array.from({length:6},(_,i)=><View key={i} style={{flexDirection:'row',alignItems:'center',flex:i===2?1.3:1}}>
          <View style={[s.box,code.length===i&&{borderColor:'#9163C5'}]}>{!code[i]&&code.length===i&&visible?<View style={s.cursor}/>:<Text style={s.char}>{code[i]||''}</Text>}</View>{i===2&&<Text style={s.dash}>-</Text>}
        </View>)}{visible&&<TextInput accessibilityLabel="Partner’s six-character Burrow code" autoFocus value={code} onChangeText={onChange} autoCapitalize="characters" autoCorrect={false} maxLength={8} returnKeyType="done" onSubmitEditing={onPair} editable={!pairing} style={[StyleSheet.absoluteFill,{opacity:.02}]}/>}</View>
        {error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Pair Now" accessibilityState={{disabled:code.length!==6||pairing}} onPress={onPair} disabled={code.length!==6||pairing} style={[s.pairButton,(code.length!==6||pairing)&&{opacity:.45}]}>{pairing?<ActivityIndicator color="#FFF"/>:<Text style={s.buttonText}>Pair Now</Text>}</Pressable>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Close code entry" onPress={onClose} style={s.codeClose}><MaterialIcons name="close" size={28} color="#32215D"/></Pressable>
    </View>
  </KeyboardAvoidingView>;
  if(embedded)return visible?content:null;
  return <Modal visible={visible} transparent statusBarTranslucent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>{content}</Modal>;
}

export function PairingConnectedPage({partner,self,selfPhotoUri,onContinue,busy=false,error}:{
  partner:PairingPerson;self?:PairingPerson;selfPhotoUri?:string;onContinue:()=>void;busy?:boolean;error?:string|null;
}){
  const {width,height}=useWindowDimensions(),insets=useSafeAreaInsets(),m=onboardingMetrics(width,height,insets.top,insets.bottom),portrait=width*.23;
  const photo=selfPhotoUri?{uri:selfPhotoUri}:null;
  return <View style={s.connectedRoot}>
    <ScrollView removeClippedSubviews={false} bounces={false} showsVerticalScrollIndicator={false} style={{flex:1}} contentContainerStyle={{minHeight:height-m.footer,paddingHorizontal:m.padding,paddingTop:insets.top,justifyContent:'center'}}>
      <Text style={[s.title,{fontSize:Math.min(34,width*72/900),color:cream}]}>You’re Connected!</Text>
      <Text style={[s.description,{color:cream,fontSize:m.body,marginTop:12}]}>You and {partner.name} now share a little world.</Text>
      <View style={[s.avatarRow,{marginVertical:width*.075}]}>
        <View style={s.person}><View style={s.portrait}>{photo?<Image source={photo} contentFit="cover" style={{width:portrait-6,height:portrait-6}}/>:<UserAvatar name={self?.name} otherUserId={partner.userId} userId={self?.userId} avatarUrl={self?.avatarUrl} isDefaultAvatar={self?.isDefaultAvatar} size={portrait-6}/>}</View><Text style={s.personName}>You</Text></View>
        <MaterialIcons name="favorite" size={width*.09} color="#FF8A92"/>
        <View style={s.person}><View style={s.portrait}><UserAvatar name={partner.name} otherUserId={self?.userId} userId={partner.userId} avatarUrl={partner.avatarUrl} isDefaultAvatar={partner.isDefaultAvatar} size={portrait-6}/></View><Text style={s.personName}>{partner.name}</Text></View>
      </View>
      <Text style={[s.description,{color:'#DDCABB',fontSize:Math.max(15,width*36/900)}]}>Decorate, play, and make memories together.</Text>
    </ScrollView>
    <View style={{minHeight:m.footer,paddingHorizontal:m.padding,paddingTop:10,paddingBottom:Math.max(18,insets.bottom+12),justifyContent:'flex-end'}}>
      {error&&<Text accessibilityRole="alert" style={[s.hint,{color:cream,marginBottom:10}]}>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Continue" disabled={busy} onPress={onContinue} style={({pressed})=>[s.continue,{minHeight:m.buttonHeight},(pressed||busy)&&{opacity:.65}]}><Text style={[s.continueText,{fontSize:Math.min(23,width*44/900)}]}>{busy?'Updating your burrow…':'Continue'}</Text></Pressable>
    </View>
  </View>;
}
const s=StyleSheet.create({
  inviteCard:{padding:22,borderRadius:24,backgroundColor:'#F7E9D6'},label:{fontSize:16,color:ink,fontFamily:'Inter_700Bold'},
  codeRow:{flexDirection:'row',alignItems:'center',marginTop:8,marginBottom:12,gap:12,padding:12,paddingLeft:16,minHeight:62,borderWidth:1,borderColor:'#D3C6B6',borderRadius:10,backgroundColor:cream},code:{flex:1,fontSize:25,color:ink,fontFamily:'Inter_800ExtraBold',letterSpacing:1},copy:{padding:4},share:{minHeight:50,borderRadius:11,backgroundColor:'#CB7852',alignItems:'center',justifyContent:'center'},buttonText:{color:cream,fontFamily:'Inter_700Bold',fontSize:19,textAlign:'center'},
  divider:{borderTopWidth:1,borderStyle:'dashed',borderColor:'#D5C7B5',marginVertical:20},enterCode:{flexDirection:'row',alignItems:'center',padding:14,minHeight:56,borderWidth:1,borderColor:'#D3C6B6',borderRadius:10,backgroundColor:cream,marginTop:8},enterText:{flex:1,fontSize:16,color:'#A79A8B',fontFamily:'Inter_400Regular'},hint:{fontSize:14,color:'#9B806A',textAlign:'center',marginTop:10},error:{fontSize:14,color:'#A13B24',lineHeight:21,marginTop:12},retry:{padding:12,alignItems:'center'},
  codeOverlay:{flex:1,backgroundColor:'rgba(0,0,0,.55)',justifyContent:'flex-end'},codeSheet:{maxHeight:'100%',backgroundColor:'#FFF',borderTopLeftRadius:24,borderTopRightRadius:24,overflow:'hidden'},codeContent:{paddingHorizontal:16,paddingTop:64,paddingBottom:60},codeClose:{position:'absolute',right:16,top:16},codeTitle:{color:'#111',fontFamily:'Inter_800ExtraBold',fontSize:24,textAlign:'center'},boxes:{flexDirection:'row',gap:8,marginTop:30},box:{flex:1,height:48,borderWidth:1,borderColor:'#BCB7C8',borderRadius:12,alignItems:'center',justifyContent:'center'},cursor:{width:2,height:27,backgroundColor:'#32215D'},char:{color:'#32215D',fontFamily:'Inter_800ExtraBold',fontSize:24},dash:{fontSize:24,color:'#32215D',paddingLeft:8},pairButton:{minHeight:50,marginTop:28,borderRadius:99,backgroundColor:'#4E341B',alignItems:'center',justifyContent:'center'},
  connectedRoot:{flex:1,backgroundColor:soil},title:{fontFamily:'Inter_800ExtraBold',color:ink,textAlign:'center'},description:{fontFamily:'Inter_400Regular',textAlign:'center',lineHeight:26},avatarRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:15},person:{alignItems:'center'},portrait:{borderWidth:3,borderColor:cream,borderRadius:999,overflow:'hidden'},personName:{marginTop:9,fontFamily:'Inter_600SemiBold',color:cream,fontSize:17},continue:{borderRadius:99,backgroundColor:'#FFF5E1',alignItems:'center',justifyContent:'center',paddingVertical:13,paddingHorizontal:12},continueText:{fontFamily:'Inter_700Bold',color:ink,textAlign:'center'},
});
