import { Animated, StyleSheet, View } from 'react-native';

export const AFFECTION_BURST_DURATION=960;
const hearts=[
  [-86,-76,19],[-46,-103,25],[3,-94,18],[59,-86,22],[90,-38,20],
  [-103,-16,22],[-70,43,20],[-24,76,26],[36,80,18],[82,45,24],
  [-28,-31,17],[29,-35,22],[0,20,24],[-52,7,15],[58,5,17],
] as const;

/** Shared with Receive: one native-driven progress value, no per-frame JS. */
export function AffectionHeartBurst({progress}:{progress:Animated.Value}){
  return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
    {hearts.map(([x,y,size],index)=><Animated.Text key={index} style={{position:'absolute',left:'50%',top:'50%',color:'#F25D6F',fontSize:size,
      opacity:progress.interpolate({inputRange:[0,.2,.75,1],outputRange:[0,1,1,0]}),
      transform:[
        {translateX:progress.interpolate({inputRange:[0,1],outputRange:[0,x]})},
        {translateY:progress.interpolate({inputRange:[0,1],outputRange:[0,y]})},
        {scale:progress.interpolate({inputRange:[0,.5,1],outputRange:[.35,1.3,.75]})},
      ],
    }}>♥</Animated.Text>)}
  </View>;
}
