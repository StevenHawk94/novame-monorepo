import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { badgeLabel } from '@/lib/burrow-attention';
export function UpdateBadge({count,dot=false,size=23,style,exact=false}:{count:number;dot?:boolean;size?:number;style?:StyleProp<ViewStyle>;exact?:boolean}){
  const label=exact&&count>0?String(Math.floor(count)):badgeLabel(count);if(!label)return null;
  const diameter=dot?12:size;
  return <View pointerEvents="none" accessible accessibilityLabel={`${count} updates`} style={[s.badge,{minWidth:diameter,height:diameter,borderRadius:diameter/2,paddingHorizontal:dot?0:4},style]}>
    {!dot&&<Text maxFontSizeMultiplier={1} style={[s.text,{fontSize:Math.round(size*.62),lineHeight:size}]}>{label}</Text>}
  </View>;
}
const s=StyleSheet.create({badge:{position:'absolute',right:-6,top:-6,backgroundColor:'#F35D67',alignItems:'center',justifyContent:'center',zIndex:5},text:{color:'white',fontWeight:'800',textAlign:'center'}});
