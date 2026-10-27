import {useState} from 'react';
import {StyleSheet,TextInput,View,type TextInputProps} from 'react-native';
import Animated,{runOnJS,useAnimatedProps,useAnimatedReaction,useAnimatedStyle,type SharedValue} from 'react-native-reanimated';
const Counter=Animated.createAnimatedComponent(TextInput);
/** Per-frame native text/bar; React receives only 10% accessibility milestones. */
export function CareProgress({progress,label,color}:{progress:SharedValue<number>;label:string;color:string}){
  const [announced,setAnnounced]=useState(0);
  const text=useAnimatedProps(()=>({text:`${label} ${Math.round(progress.value*100)}%`} as TextInputProps));
  const fill=useAnimatedStyle(()=>({transform:[{scaleX:Math.max(0,Math.min(1,progress.value))}]}));
  useAnimatedReaction(()=>Math.floor(progress.value*10)*10,(next,previous)=>{if(next!==previous)runOnJS(setAnnounced)(next);},[]);
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{min:0,max:100,now:announced}} style={s.root}>
    <Counter animatedProps={text} defaultValue={`${label} 0%`} editable={false} accessible={false} pointerEvents="none" caretHidden contextMenuHidden underlineColorAndroid="transparent" style={s.text}/>
    <View style={s.track}><Animated.View style={[s.fill,{backgroundColor:color},fill]}/></View>
  </View>;
}
const s=StyleSheet.create({root:{width:'100%',gap:24,alignItems:'center'},text:{padding:0,margin:0,color:'#42271B',fontSize:20,fontWeight:'800',textAlign:'center',width:'100%'},
  track:{height:14,width:'84%',maxWidth:340,borderRadius:10,overflow:'hidden',backgroundColor:'#E7E1D9'},fill:{width:'100%',height:'100%',borderRadius:10,transformOrigin:'left center'}});
