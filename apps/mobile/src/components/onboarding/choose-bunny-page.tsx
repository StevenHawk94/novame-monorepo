import {useEffect} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Image} from 'expo-image';
import {useAppViewport} from '@/lib/app-viewport';
import {BUNNY_ICONS,type BunnyVariant} from '@/lib/bunny-variant-assets';
import {useBunnyIdentity} from '@/lib/bunny-identity';
export function ChooseBunnyPage({value,onChange}:{value:BunnyVariant;onChange:(value:BunnyVariant)=>void}){
 const {width,height}=useAppViewport(),identity=useBunnyIdentity();
 const available:BunnyVariant[]=identity?.finalized&&identity.variant?[identity.variant]
  :identity?.partnerId&&identity.partnerVariant?[identity.partnerVariant==='pinky'?'biscuit':'pinky']:['biscuit','pinky'];
 const forced=available.length===1?available[0]:null;
 useEffect(()=>{if(forced&&value!==forced)onChange(forced);},[forced,value,onChange]);
 return <View style={{flex:1,paddingHorizontal:width*.07,paddingTop:Math.min(height*.14,130)}}>
  <Text style={[s.title,{fontSize:Math.min(38,width*.074)}]}>Choose Your Bunny</Text>
  <Text style={[s.description,{fontSize:Math.min(21,width*.039),marginTop:28}]}>If you both pick the same one, whoever enters the invite code keeps it.</Text>
  <View style={[s.choices,{marginTop:Math.min(56,height*.065)}]}>
   {available.map(variant=><Pressable key={variant} accessibilityRole="radio" accessibilityState={{selected:value===variant}}
    accessibilityLabel={variant==='biscuit'?'Biscuit':'Pinky'} onPress={()=>onChange(variant)}
    style={[s.card,{height:Math.min(width*.37,180)},value===variant&&s.selected]}>
    <Image source={BUNNY_ICONS[variant]} contentFit="contain" style={{width:'80%',height:'70%'}}/>
    <Text style={s.name}>{variant==='biscuit'?'Biscuit':'Pinky'}</Text>
   </Pressable>)}
  </View>
 </View>;
}
const s=StyleSheet.create({title:{fontFamily:'Inter_800ExtraBold',color:'#49270F',textAlign:'center'},description:{textAlign:'center',color:'#111',lineHeight:28},
 choices:{flexDirection:'row',justifyContent:'center',gap:22},card:{flex:1,maxWidth:210,alignItems:'center',justifyContent:'center',backgroundColor:'#fff',borderWidth:2,borderColor:'transparent',borderRadius:24},
 selected:{borderColor:'#572B1A'},name:{fontFamily:'Inter_700Bold',fontSize:17,color:'#111',marginTop:6}});
