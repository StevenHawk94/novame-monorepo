import { memo, useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { Image } from './burrow-image';

export const SURPRISE_CREAM='#FAF3E5',SURPRISE_INK='#4A2917';
const RECORDING=require('../../../assets/animations/recording.lottie');
export function SurpriseAction({title,onPress,dark=false,disabled=false}:{title:string;onPress:()=>void;dark?:boolean;disabled?:boolean}){
 return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
  style={({pressed})=>[s.button,dark&&s.dark,{opacity:disabled?.45:1,transform:[{translateY:pressed?3:0}]}]}>
  <Text style={[s.buttonText,dark&&{color:'#FFF9F0'}]}>{title}</Text>
 </Pressable>;
}
export const RecordingOrb=memo(function RecordingOrb({running=false,time,size=210}:{running?:boolean;time?:string;size?:number}){
 const ref=useRef<LottieView>(null);
 useEffect(()=>{if(running)ref.current?.play();else{ref.current?.reset();ref.current?.pause();}},[running]);
 return <View style={{width:size,height:size,alignItems:'center',justifyContent:'center'}} pointerEvents="none">
  <LottieView ref={ref} source={RECORDING} autoPlay={running} loop={running} onAnimationLoaded={()=>{if(running)ref.current?.play();else ref.current?.pause();}}
   resizeMode="contain" style={StyleSheet.absoluteFill}/>
  {time!==undefined&&<Text style={{fontSize:size*.13,fontWeight:'600',color:'#FFF'}}>{time}</Text>}
 </View>;
});
export function SurpriseGiftbox({size=170,wobble=false}:{size?:number;wobble?:boolean}){
 const rotation=useRef(new Animated.Value(0)).current;
 useEffect(()=>{
  if(!wobble){rotation.setValue(0);return;}
  const motion=Animated.loop(Animated.sequence([
   Animated.timing(rotation,{toValue:1,duration:450,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false}),
   Animated.timing(rotation,{toValue:-1,duration:900,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false}),
   Animated.timing(rotation,{toValue:0,duration:450,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false}),
   Animated.timing(rotation,{toValue:0,duration:700,useNativeDriver:true,isInteraction:false}),
  ]));motion.start();return()=>motion.stop();
 },[wobble,rotation]);
 return <Animated.View pointerEvents="none" style={{width:size,height:size,transform:[{rotate:rotation.interpolate({inputRange:[-1,1],outputRange:['-7deg','7deg']})}]}}>
  <Image source={require('../../../assets/burrow-webp/surprise-room/giftbox.webp')} contentFit="contain" style={StyleSheet.absoluteFill}/>
 </Animated.View>;
}
export function SurpriseCard({title,copy,children,onClose,dim=true}:{title:string;copy?:string;children:ReactNode;onClose?:()=>void;dim?:boolean}){
 return <View style={[s.scrim,!dim&&{backgroundColor:'transparent'}]}><View style={s.card} accessibilityViewIsModal>
  {onClose&&<Pressable accessibilityRole="button" accessibilityLabel="Close surprise" onPress={onClose} style={s.close}><Text style={s.cross}>×</Text></Pressable>}
  <Text accessibilityRole="header" style={s.title}>{title}</Text>
  {!!copy&&<Text style={s.copy}>{copy}</Text>}{children}
 </View></View>;
}
const s=StyleSheet.create({button:{backgroundColor:'#FFC747',borderRadius:20,minHeight:62,justifyContent:'center',alignItems:'center',padding:14},dark:{backgroundColor:'#4A2917'},buttonText:{color:'#4A2917',fontSize:21,fontWeight:'700',textAlign:'center'},
 scrim:{flex:1,backgroundColor:'rgba(0,0,0,.6)',justifyContent:'center',padding:24},card:{backgroundColor:'#FFF8ED',borderRadius:28,padding:26,paddingTop:34,gap:22,width:'100%',maxWidth:430,alignSelf:'center'},
 title:{fontSize:28,lineHeight:34,fontWeight:'800',color:'#26150C',textAlign:'center'},copy:{fontSize:16,lineHeight:24,color:'#38281B',textAlign:'center'},close:{position:'absolute',top:10,right:10,width:40,height:40,borderRadius:20,backgroundColor:'#4A2917',alignItems:'center',justifyContent:'center',zIndex:2},cross:{fontSize:36,lineHeight:39,color:'#FFF'}});
