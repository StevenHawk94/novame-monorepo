import { useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleLogo } from './account-provider-logo';
import { withSoftPress } from '@/lib/haptics';

/** Presentation only: provider linking, OTP, purchase and close guards stay with the caller. */
export function ConnectAccountView({ onClose, onProvider, busy, children, connectedAs }: {
  onClose: () => void; onProvider: (provider:'apple'|'google') => void;
  busy: boolean; children: ReactNode; connectedAs?: string|null;
}) {
  const insets=useSafeAreaInsets(),{height}=useWindowDimensions();
  const [emailOpen,setEmailOpen]=useState(false);
  const openLegal=(path:string)=>{void Linking.openURL(`https://www.burrow-app.com/${path}`).catch(()=>{});};
  return <View style={styles.root}><KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS==='ios'?'padding':'height'}>
    <ScrollView contentContainerStyle={[styles.inner,{paddingTop:insets.top+10,paddingBottom:Math.max(insets.bottom,24)}]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close account connection" onPress={onClose} style={styles.close} hitSlop={10}>
        <MaterialIcons name="close" size={32} color="#FFF9EF"/>
      </Pressable>
      <View style={[styles.content,{paddingTop:emailOpen?30:Math.max(42,Math.min(100,height*.09))}]}>
        <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.7}>Connect Your Account</Text>
        <Text style={styles.description}>{connectedAs?`You're connected as ${connectedAs}.\nYour memories are safe.`:
          "We recommend connecting your account so you can keep your data safe."}</Text>
        {connectedAs?<MaterialIcons name="check-circle" size={54} color="#7BB661" style={styles.connected}/>:
          <><View style={[styles.providers,{marginTop:emailOpen?28:52}]}>
            {Platform.OS==='ios'&&<Pressable accessibilityRole="button" accessibilityLabel="Sign in with Apple" disabled={busy}
              onPress={()=>onProvider('apple')} style={[styles.provider,busy&&styles.disabled]}>
              <MaterialCommunityIcons name="apple" size={26} color="#111111"/><Text style={styles.providerText}>Sign in with Apple</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" disabled={busy}
              onPress={()=>onProvider('google')} style={[styles.provider,busy&&styles.disabled]}>
              <GoogleLogo size={23}/><Text style={styles.providerText}>Continue with Google</Text>
            </Pressable>
            {emailOpen?<View style={styles.emailForm}>{children}</View>:<Pressable accessibilityRole="button" disabled={busy}
              onPress={()=>setEmailOpen(true)} style={[styles.email,busy&&styles.disabled]}>
              <Text style={styles.emailText}>Connect with Email</Text>
            </Pressable>}
            {busy&&!emailOpen&&<ActivityIndicator accessibilityLabel="Connecting account" color="#4A321C"/>}
          </View>
          <Pressable accessibilityRole="button" disabled={busy} onPress={()=>setEmailOpen(true)} style={styles.login} hitSlop={8}>
            <Text style={styles.loginText}>Already have an account? Log in</Text>
          </Pressable></>}
      </View>
      <View style={styles.footer}><Text style={styles.legal}>By continuing, you agree to Burrow’s{ '\n' }
        <Text accessibilityRole="link" onPress={event=>withSoftPress(()=>openLegal('terms'),event)} style={styles.link}>Terms &amp; Conditions</Text>
        {' and acknowledge the '}
        <Text accessibilityRole="link" onPress={event=>withSoftPress(()=>openLegal('privacy'),event)} style={styles.link}>Privacy Policy</Text>.
      </Text></View>
    </ScrollView>
  </KeyboardAvoidingView></View>;
}
const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#FFF5E9'},keyboardAvoider:{flex:1},
  inner:{flexGrow:1,paddingHorizontal:28},close:{width:44,height:44,borderRadius:22,backgroundColor:'#4A321C',alignItems:'center',justifyContent:'center',marginLeft:-12},
  content:{alignSelf:'center',width:'100%',maxWidth:420},
  title:{fontFamily:'LilitaOne_400Regular',fontSize:32,lineHeight:42,color:'#4A321C',textAlign:'center'},
  description:{fontFamily:'Inter_400Regular',fontSize:16,lineHeight:24,color:'#161311',textAlign:'center',marginTop:26},
  providers:{gap:14},provider:{backgroundColor:'#FFFFFF',borderRadius:10,minHeight:54,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,paddingHorizontal:12,paddingVertical:14},
  providerText:{fontFamily:'Inter_700Bold',fontSize:16,color:'#111111',flexShrink:1},
  email:{backgroundColor:'#4A321C',borderRadius:10,minHeight:54,justifyContent:'center',alignItems:'center',padding:14},
  emailText:{fontFamily:'Inter_700Bold',fontSize:16,color:'#FFFFFF'},emailForm:{width:'100%'},disabled:{opacity:.55},
  login:{marginTop:38,paddingVertical:8},loginText:{fontFamily:'Inter_700Bold',fontSize:12,color:'#111111',textAlign:'center'},
  footer:{flex:1,justifyContent:'flex-end',paddingTop:64,paddingBottom:32},
  legal:{fontFamily:'Inter_400Regular',fontSize:11,lineHeight:17,color:'#111111',textAlign:'center'},link:{fontFamily:'Inter_700Bold',textDecorationLine:'underline'},
  connected:{alignSelf:'center',marginTop:30},
});
