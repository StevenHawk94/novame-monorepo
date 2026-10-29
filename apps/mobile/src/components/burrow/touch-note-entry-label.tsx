import {StyleSheet,Text,View} from 'react-native';

const outlineOffsets=[[-1.6,0],[1.6,0],[0,-1.6],[0,1.6],[-1.15,-1.15],[1.15,-1.15],[-1.15,1.15],[1.15,1.15]];

/** Hard white outline, not a blurred shadow; decorative copies never become
 * separate accessibility labels or touch targets. Padding keeps edges intact. */
export function TouchNoteEntryLabel(){
 return <View pointerEvents="none" style={s.label}>
  {outlineOffsets.map(([x,y],index)=><Text key={index} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
   style={[s.text,s.outline,{transform:[{translateX:x},{translateY:y}]}]}>Touch Note</Text>)}
  <Text style={s.text}>Touch Note</Text>
 </View>;
}

const s=StyleSheet.create({
 label:{padding:2},
 text:{fontSize:14,lineHeight:19,fontWeight:'800',color:'#49321F',textAlign:'center'},
 outline:{position:'absolute',left:2,right:2,top:2,color:'#FFFFFF'},
});
