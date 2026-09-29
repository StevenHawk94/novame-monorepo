import {useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,AppState,Image,StyleSheet,Text,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
type Person={display_name:string|null;avatar_url:string|null};
function Avatar({person,fallback}:{person:Person|null;fallback:string}){
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[person?.avatar_url]);
  return <View style={s.person}>{person?.avatar_url&&!failed?<Image source={{uri:person.avatar_url}} style={s.avatar} onError={()=>setFailed(true)} accessibilityLabel={person.display_name??fallback}/>:<Text style={s.fallback}>🐰</Text>}<Text style={s.name}>{person?.display_name??fallback}</Text></View>;
}
/** Presentation only: sent becomes true only after the server acknowledges. */
export function AffectionDelivery({sender,recipient,sent}:{sender:Person;recipient:Person|null;sent:boolean}){
  const focused=useIsFocused();const [foreground,setForeground]=useState(AppState.currentState==='active');
  const [reduced,setReduced]=useState(true);const position=useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    let live=true,changed=false;
    const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{changed=true;setReduced(value);});
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(live&&!changed)setReduced(value);}).catch(()=>{});
    const app=AppState.addEventListener('change',state=>setForeground(state==='active'));
    return()=>{live=false;sub.remove();app.remove();};
  },[]);
  useEffect(()=>{
    position.stopAnimation();position.setValue(sent?1:0);
    if(!sent||!focused||!foreground||reduced)return;
    position.setValue(0);const animation=Animated.timing(position,{toValue:1,duration:1000,useNativeDriver:true});animation.start();
    return()=>animation.stop();
  },[sent,focused,foreground,reduced,position]);
  return <View style={s.panel}>
    <View style={s.row}><Avatar person={sender} fallback="You"/><View style={s.trail} accessible accessibilityLabel={sent?'Love sent to your person':'Across the distance'}>
      <Text style={s.dots}>· · · · · · →</Text><Animated.Text style={[s.heart,{transform:[{translateX:position.interpolate({inputRange:[0,1],outputRange:[-30,30]})}]}]}>💗</Animated.Text>
    </View><Avatar person={recipient} fallback="Your person"/></View>
    <Text accessibilityLiveRegion="polite" style={s.name}>{sent?'Your love has been sent.':'Across the distance'}</Text>
  </View>;
}
const s=StyleSheet.create({panel:{gap:12},row:{flexDirection:'row',alignItems:'center',gap:8},person:{width:96,alignItems:'center',gap:8},avatar:{height:76,width:76,borderRadius:38,borderWidth:3,borderColor:'#FFF4E1'},fallback:{fontSize:48},name:{color:'#FFF4E1',fontSize:15,fontWeight:'700',textAlign:'center'},trail:{flex:1,minWidth:65,alignItems:'center',justifyContent:'center'},dots:{fontSize:23,color:'#FFF4E1'},heart:{position:'absolute',fontSize:28}});
