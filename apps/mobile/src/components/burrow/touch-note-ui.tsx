import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {Image} from './burrow-image';
import {AppModal} from '../layout/app-modal';
export function TouchNoteIcon({size=76}:{size?:number}){return <View style={{width:size,height:size*.68,overflow:'hidden'}}><Image source={require('../../../assets/burrow-webp/touch-note.webp')} contentFit="contain" style={{position:'absolute',top:-size*.16,width:size,height:size}}/></View>;}
export function TouchNoteButton({label,onPress,disabled=false,cream=false,dark=false,style}:{label:string;onPress:()=>void;disabled?:boolean;cream?:boolean;dark?:boolean;style?:StyleProp<ViewStyle>}){
 return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,cream&&{backgroundColor:'#FFF4E6'},dark&&{backgroundColor:'#502B1E',shadowOpacity:0},disabled&&{opacity:.55},style]}><Text style={[s.buttonText,dark&&{color:'#FFF9EF'}]}>{label}</Text></Pressable>;
}
export function TouchNoteDialog({visible,onClose,children}:{visible:boolean;onClose:()=>void;children:React.ReactNode}){
 return <AppModal transparent visible={visible} animationType="fade" onRequestClose={onClose}><View style={s.scrim}>
  <Pressable accessibilityLabel="Dismiss touch note dialog" onPress={onClose} style={StyleSheet.absoluteFillObject}/>
  <View accessibilityViewIsModal style={s.card}><ScrollView bounces={false} contentContainerStyle={s.cardContent}>{children}</ScrollView></View>
 </View></AppModal>;
}
export const touchNoteStyles=StyleSheet.create({heading:{fontSize:18,lineHeight:25,fontWeight:'800',color:'#100B08',textAlign:'center'},copy:{fontSize:16,lineHeight:23,color:'#49321F',textAlign:'center'},hint:{fontSize:13,lineHeight:20,color:'#21160F',textAlign:'center'},chip:{backgroundColor:'#FFC343',paddingVertical:8,paddingHorizontal:27,borderRadius:9,color:'#57331D',fontSize:17,fontWeight:'800'}});
const s=StyleSheet.create({button:{minHeight:56,paddingVertical:16,paddingHorizontal:18,borderRadius:20,backgroundColor:'#FFC343',alignItems:'center',justifyContent:'center',width:'100%',shadowColor:'#B16C36',shadowOpacity:1,shadowRadius:0,shadowOffset:{width:0,height:4}},buttonText:{fontSize:19,fontWeight:'800',color:'#57331D',textAlign:'center'},scrim:{flex:1,backgroundColor:'#0009',paddingHorizontal:30,alignItems:'center',justifyContent:'center'},card:{maxHeight:'90%',width:'100%',borderRadius:28,backgroundColor:'#FFFAEF'},cardContent:{alignItems:'center',padding:20,gap:18}});
