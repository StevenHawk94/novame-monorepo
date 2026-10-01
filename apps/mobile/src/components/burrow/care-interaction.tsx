import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { ClipPath, Defs, G, Path } from 'react-native-svg';
import { Image } from 'expo-image';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import { haptics } from '@/lib/haptics';

const CARROT_BODY='M97 84 C82 152 84 260 96 348 C99 368 104 374 110 366 C126 300 148 196 162 96 C166 76 154 66 132 66 C112 66 100 72 97 84 Z';
const BITE_COUNT=14;
const BITE_INTERVAL=320;
type Crumb={id:number;x:number;y:number;dx:number;dy:number;spin:number;size:number;color:string;duration:number;anim:Animated.Value};

function biteClip(bite:number) {
  if (!bite) return 'M0 -80 H250 V452 H0 Z';
  if (bite>=BITE_COUNT) return 'M0 0 Z';
  const y=372-(bite/BITE_COUNT)*306;
  const room=Math.max(0,y-66);
  const shrink=Math.min(1,room/27.625);
  let edge=`M 190 ${y}`;
  for(let i=0;i<4;i++){
    const xa=190-i*32.5, xb=xa-32.5;
    const seed=bite*7+i;
    const r=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
    const depth=16.25*.85*shrink*(1+(r(seed)-.5)*.8);
    const endY=y+(r(seed+99)-.5)*16.25*.5*.4*shrink;
    edge+=` Q ${(xa+xb)/2} ${y-depth*1.6} ${xb} ${endY}`;
  }
  return `M0 -80 H250 V${y} ${edge.replace(/^M /,'L ')} L0 ${y} Z`;
}

export function FeedInteraction({ onComplete, complete }: { onComplete:()=>void; complete:boolean }) {
  const {height}=useWindowDimensions();
  const carrotHeight=Math.min(400,Math.max(230,height*.46));
  const carrotWidth=carrotHeight*230/400;
  const [bite,setBite]=useState(0);
  const [crumbs,setCrumbs]=useState<Crumb[]>([]);
  const biteRef=useRef(0);
  const crumbId=useRef(0);
  const crumbAnimations=useRef<Animated.CompositeAnimation[]>([]);
  const alive=useRef(true);
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const stop=()=>{if(timer.current){clearInterval(timer.current);timer.current=null;}};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop();crumbAnimations.current.forEach(animation=>animation.stop());};},[]);
  const scatter=(atY:number,color='#F5841F')=>{
    const next=Array.from({length:4},()=>({
      id:++crumbId.current,x:124/230*carrotWidth,y:atY/400*carrotHeight,
      dx:(Math.random()-.5)*52/230*carrotWidth,dy:(70+Math.random()*70)/400*carrotHeight,
      spin:(Math.random()-.5)*360,size:4+Math.random()*6,color,
      duration:520+Math.random()*240,anim:new Animated.Value(0),
    }));
    setCrumbs(previous=>[...previous,...next].slice(-40));
    next.forEach(crumb=>{
      const animation=Animated.timing(crumb.anim,{toValue:1,duration:crumb.duration,useNativeDriver:true});
      crumbAnimations.current.push(animation);
      animation.start(()=>{
        crumbAnimations.current=crumbAnimations.current.filter(item=>item!==animation);
        if(alive.current)setCrumbs(previous=>previous.filter(item=>item.id!==crumb.id));
      });
    });
  };
  const chomp=()=>{
    if(biteRef.current>=BITE_COUNT)return;
    biteRef.current++;
    setBite(biteRef.current);
    scatter(372-biteRef.current/BITE_COUNT*306);
    void haptics.light();
    if(biteRef.current>=BITE_COUNT){scatter(60,'#3E8E41');stop();onComplete();}
  };
  const start=()=>{if(timer.current||complete||biteRef.current>=BITE_COUNT)return;chomp();timer.current=setInterval(chomp,BITE_INTERVAL);};
  return <View style={styles.carePage}>
    <Text style={styles.caption}>Press and hold the carrot. Each little bite makes it disappear.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Hold to feed your bunny" onPressIn={start} onPressOut={stop} style={[styles.carrotHit,{width:carrotWidth,height:carrotHeight}]}>
      <Svg width={carrotWidth} height={carrotHeight} viewBox="0 0 230 400" style={{overflow:'visible'}}>
        <Defs><ClipPath id="bite"><Path d={biteClip(bite)}/></ClipPath><ClipPath id="carrotBody"><Path d={CARROT_BODY}/></ClipPath></Defs>
        {bite<BITE_COUNT&&<G transform="translate(131 74) scale(.78)">
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#557F37" transform="rotate(-46) translate(0 -4) scale(1.02 .94)"/>
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#618F3C" transform="rotate(-17) translate(0 -8) scale(1.1 1.12)"/>
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#557F37" transform="rotate(11) translate(0 -7) scale(-1.06 1.06)"/>
          <Path d="M0 4 C-15 -24 -17 -58 -6 -78 Q1 -90 9 -77 C19 -56 12 -20 0 4 Z" fill="#618F3C" transform="rotate(38) translate(0 -3) scale(-.98 .9)"/>
          {['M1 8 C-8 -6 -22 -26 -34 -42','M1 8 C-3 -12 -10 -40 -18 -62','M1 8 C4 -14 8 -42 13 -62','M1 8 C8 -4 20 -24 31 -38'].map((d,i)=><Path key={i} d={d} fill="none" stroke="#3D6527" strokeWidth={3.4} strokeLinecap="round" opacity={.95}/>)}
        </G>}
        <G clipPath="url(#bite)"><Path d={CARROT_BODY} fill="#F1813C"/><G clipPath="url(#carrotBody)">
          <Path d="M86 90 C74 180 82 300 100 378 L78 378 L70 90 Z" fill="#D9682C" opacity={.14}/>
          <Path d="M140 84 C152 130 146 200 128 262 C150 200 156 128 150 84 Z" fill="#FFB27A" opacity={.3}/>
          {["M100 148 C116 141 134 147 151 142","M104 162 C118 157 130 161 142 158","M96 228 C111 221 128 228 139 222","M100 242 C112 238 122 241 131 238","M98 306 C109 301 120 306 127 302","M101 318 C109 315 116 317 121 315"].map((d,i)=><Path key={i} d={d} fill="none" stroke="#7A4A27" strokeWidth={2.6} opacity={.62}/>)}</G></G>
      </Svg>
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>{crumbs.map(crumb=><Animated.View key={crumb.id} style={{position:'absolute',left:crumb.x-crumb.size/2,top:crumb.y-crumb.size/2,width:crumb.size,height:crumb.size,borderRadius:2,backgroundColor:crumb.color,
        opacity:crumb.anim.interpolate({inputRange:[0,.15,1],outputRange:[0,1,0]}),transform:[
          {translateX:crumb.anim.interpolate({inputRange:[0,1],outputRange:[0,crumb.dx]})},
          {translateY:crumb.anim.interpolate({inputRange:[0,1],outputRange:[0,crumb.dy]})},
          {scale:crumb.anim.interpolate({inputRange:[0,1],outputRange:[.4,.85]})},
          {rotate:crumb.anim.interpolate({inputRange:[0,1],outputRange:['0deg',`${crumb.spin}deg`]})},
        ]}}/>)}</View>
    </Pressable>
    <Text accessibilityLiveRegion="polite" style={styles.progressText}>{complete?'Your bunny is fed!':`Feeding ${Math.round(bite/BITE_COUNT*100)}%`}</Text>
    <View style={styles.track}><View style={[styles.carrotFill,{width:`${bite/BITE_COUNT*100}%`}]} /></View>
  </View>;
}

export function WaterInteraction({ flower, onComplete, complete }: { flower?:BurrowArtAsset; onComplete:()=>void; complete:boolean }) {
  const {height}=useWindowDimensions();
  const [progress,setProgress]=useState(0);
  const [holding,setHolding]=useState(false);
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const started=useRef(0);
  const finished=useRef(false);
  const pulse=useRef(new Animated.Value(0)).current;
  const stop=()=>{if(timer.current){clearInterval(timer.current);timer.current=null;}setHolding(false);};
  useEffect(()=>()=>stop(),[]);
  useEffect(()=>{
    if(!holding){pulse.stopAnimation();pulse.setValue(0);return;}
    const loop=Animated.loop(Animated.timing(pulse,{toValue:1,duration:850,useNativeDriver:true}));
    loop.start();return()=>loop.stop();
  },[holding,pulse]);
  const start=()=>{
    if(complete||timer.current)return;
    started.current=Date.now();setHolding(true);
    timer.current=setInterval(()=>{
      const next=Math.min(1,(Date.now()-started.current)/3000);
      setProgress(next);
      if(next>=1){finished.current=true;stop();void haptics.success();onComplete();}
    },40);
  };
  const release=()=>{if(!finished.current)setProgress(0);stop();};
  return <View style={styles.carePage}>
    <Pressable accessibilityRole="button" accessibilityLabel="Hold the watering can for three seconds" onPressIn={start} onPressOut={release} style={[styles.canHit,{height:Math.min(190,height*.27)}]}>
      <View style={{transform:[{rotate:holding?'-13deg':'0deg'}]}}><Svg width={210} height={170} viewBox="0 0 210 170">
        <Path d="M97 51 C112 15 172 15 174 72 C176 104 156 119 146 119" fill="none" stroke="#B95D33" strokeWidth={14}/>
        <Path d="M76 53 L139 48 Q156 48 155 65 L148 139 Q145 151 129 151 L78 144 Q66 141 65 127 L59 72 Q58 56 76 53Z" fill="#CB6A3B" stroke="#A9492C" strokeWidth={6}/>
        <Path d="M66 95 L24 112 L28 128 L68 116Z" fill="#C36034" stroke="#A9492C" strokeWidth={5}/>
        <Path d="M11 106 Q4 107 5 116 Q5 130 22 134 L32 126 L27 110Z" fill="#B75C34" stroke="#9C4C2D" strokeWidth={4}/>
        <Path d="M81 65 L74 124" stroke="#E28A55" opacity={.65} strokeWidth={8} strokeLinecap="round"/>
      </Svg></View>
      {holding&&[0,1,2,3].map(i=><Animated.Text key={i} pointerEvents="none" style={[styles.drop,{left:38+i*11,top:115+i*10,opacity:pulse.interpolate({inputRange:[0,.15,.8,1],outputRange:[0,1,1,0]}),transform:[{translateY:pulse.interpolate({inputRange:[0,1],outputRange:[0,110+i*13]})}]}]}>💧</Animated.Text>)}
    </Pressable>
    <Text style={styles.caption}>Press and hold to water · 3 seconds</Text>
    <View style={styles.flowerStage}>{flower?<Image source={flower.source} contentFit="contain" style={styles.flower}/>:<Text style={{fontSize:140}}>🌼</Text>}</View>
    <Text accessibilityLiveRegion="polite" style={styles.progressText}>{complete?'Your plant is watered!':holding?`Watering ${Math.round(progress*100)}%`:'Hold the can to begin'}</Text>
    <View style={styles.track}><View style={[styles.waterFill,{width:`${progress*100}%`}]} /></View>
  </View>;
}

const styles=StyleSheet.create({
  carePage:{flex:1,alignItems:'center',justifyContent:'space-between',paddingHorizontal:28,paddingBottom:52},
  title:{fontSize:28,fontWeight:'800',color:'#42271B',textAlign:'center'},
  caption:{fontSize:16,color:'#6B4939',textAlign:'center',lineHeight:23},
  carrotHit:{width:230,height:400,alignItems:'center',justifyContent:'center'},
  progressText:{fontSize:22,fontWeight:'800',color:'#42271B',textAlign:'center'},
  track:{height:14,width:'84%',maxWidth:340,backgroundColor:'#E7E1D9',borderRadius:10,overflow:'hidden'},
  carrotFill:{height:'100%',backgroundColor:'#F1813C'},waterFill:{height:'100%',backgroundColor:'#5FCACA'},
  canHit:{width:230,height:190,alignItems:'center',justifyContent:'center'},drop:{position:'absolute',fontSize:19},
  flowerStage:{flex:1,minHeight:160,width:'80%',justifyContent:'center',alignItems:'center'},flower:{width:'100%',height:'100%'},
});
