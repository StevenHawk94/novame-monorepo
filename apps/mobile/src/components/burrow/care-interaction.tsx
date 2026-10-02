import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path } from 'react-native-svg';
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

// Matches water-plant.html: five holes on the blue watering head, each emitting
// a separate ballistic stream. The demo's controls are tuning aids, not UI.
const WATER_HOLES=[[-221.9,-25.6],[-217.9,-34.8],[-214,-44],[-210,-53.2],[-206.1,-62.4]] as const;
// At 75°, the five trajectories cross the flower heads near scene x=180,
// rather than landing left of the vase (the 32° HTML demo has no flower).
const WATER_TUNE={duration:3,rate:12,speed:120,spread:26,gravity:900,tilt:75};
type WaterDrop={x:number;y:number;vx:number;vy:number;r:number;a:number};
type WaterSpark={x:number;y:number;angle:number;distance:number;r:number;age:number;life:number;gold:boolean};
type WaterFrame={tilt:number;progress:number;paths:string[];sparks:WaterSpark[]};

function canPoint(x:number,y:number,tilt:number){
  // Same transform order as the SVG: rotate about (34, 10), then scale and
  // translate. Emission stays welded to each hole while the can tilts.
  const radians=tilt*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const rx=34+(x-34)*c-(y-10)*s,ry=10+(x-34)*s+(y-10)*c;
  return {x:260+rx*.62,y:140+ry*.62};
}
function waterDropPath(drop:WaterDrop){
  const speed=Math.hypot(drop.vx,drop.vy)||1,ux=drop.vx/speed,uy=drop.vy/speed;
  const tail=drop.r*1.8+speed*.009;
  const a={x:drop.x-uy*drop.r,y:drop.y+ux*drop.r};
  const b={x:drop.x+uy*drop.r,y:drop.y-ux*drop.r};
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(drop.x+ux*drop.r).toFixed(1)} ${(drop.y+uy*drop.r).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)} L${(drop.x-ux*tail).toFixed(1)} ${(drop.y-uy*tail).toFixed(1)} Z`;
}

export function WaterInteraction({flower,onComplete,complete}:{flower?:BurrowArtAsset;onComplete:()=>void;complete:boolean}){
  const {width,height}=useWindowDimensions();
  const sceneScale=Math.min(1,(width-32)/360,(height-220)/600);
  const stageWidth=360*sceneScale,stageHeight=600*sceneScale;
  const [holding,setHolding]=useState(false);
  const [frame,setFrame]=useState<WaterFrame>({tilt:0,progress:complete?1:0,paths:['','','','',''],sparks:[]});
  const holdingRef=useRef(false),finishedRef=useRef(complete),progressRef=useRef(complete?1:0);
  const tiltRef=useRef(0),dropsRef=useRef<WaterDrop[]>([]),sparksRef=useRef<WaterSpark[]>([]);
  const accumulators=useRef([0,0,0,0,0]);
  const onCompleteRef=useRef(onComplete);
  onCompleteRef.current=onComplete;
  useEffect(()=>{if(complete)finishedRef.current=true;},[complete]);
  useEffect(()=>{
    let alive=true,handle=0,last=0,lastPaint=0,wasActive=false;
    const tick=(now:number)=>{
      if(!alive)return;
      const dt=last?Math.min((now-last)/1000,.05):0;last=now;
      if(holdingRef.current&&!finishedRef.current){
        progressRef.current=Math.min(1,progressRef.current+dt/WATER_TUNE.duration);
        if(progressRef.current>=1){
          finishedRef.current=true;holdingRef.current=false;setHolding(false);
          const origin=canPoint(-69,42,tiltRef.current);
          sparksRef.current=Array.from({length:14},(_,i)=>({x:origin.x,y:origin.y,
            angle:Math.PI*2*i/14+Math.random()*.4,distance:46+Math.random()*34,
            r:2.4+Math.random()*2,age:0,life:.7+Math.random()*.3,gold:i%2===1}));
          void haptics.success();onCompleteRef.current();
        }
      }
      const target=holdingRef.current?-WATER_TUNE.tilt:0;
      tiltRef.current+=(target-tiltRef.current)*Math.min(1,dt*11);
      if(holdingRef.current){
        const step=WATER_TUNE.spread/(WATER_HOLES.length-1);
        WATER_HOLES.forEach(([hx,hy],index)=>{
          accumulators.current[index]+=dt*WATER_TUNE.rate;
          while(accumulators.current[index]>=1){
            accumulators.current[index]--;
            const point=canPoint(hx,hy,tiltRef.current);
            const degrees=203+tiltRef.current+(index-2)*step+(Math.random()-.5)*5;
            const radians=degrees*Math.PI/180,speed=WATER_TUNE.speed*(.85+Math.random()*.3);
            dropsRef.current.push({x:point.x,y:point.y,vx:Math.cos(radians)*speed,
              vy:Math.sin(radians)*speed,r:2.8+Math.random()*1.2,a:.78+Math.random()*.2});
          }
        });
      }else accumulators.current.fill(0);
      dropsRef.current=dropsRef.current.filter(drop=>{
        drop.vy+=WATER_TUNE.gravity*dt;drop.x+=drop.vx*dt;drop.y+=drop.vy*dt;
        return drop.y<620&&drop.x>-40&&drop.x<400;
      }).slice(-600);
      sparksRef.current=sparksRef.current.filter(spark=>{spark.age+=dt;return spark.age<spark.life;});
      const active=holdingRef.current||dropsRef.current.length>0||sparksRef.current.length>0||Math.abs(tiltRef.current)>.05;
      if(now-lastPaint>=25&&(active||wasActive)){
        lastPaint=now;
        const paths=['','','','',''];
        for(const drop of dropsRef.current){
          const fade=drop.y>420?Math.max(0,1-(drop.y-420)/180):1;
          const visible=drop.a*fade;
          if(visible<.08)continue;
          const bucket=Math.min(4,Math.max(0,Math.round(visible*5)-1));
          paths[bucket]+=waterDropPath(drop)+' ';
        }
        setFrame({tilt:tiltRef.current,progress:progressRef.current,paths,sparks:[...sparksRef.current]});
        wasActive=active;
      }
      handle=requestAnimationFrame(tick);
    };
    handle=requestAnimationFrame(tick);
    return()=>{alive=false;cancelAnimationFrame(handle);holdingRef.current=false;};
  },[]);
  const start=()=>{if(finishedRef.current)return;holdingRef.current=true;setHolding(true);};
  const release=()=>{
    holdingRef.current=false;setHolding(false);
    // A completed watering must be one continuous three-second hold.
    if(!finishedRef.current)progressRef.current=0;
  };
  return <View style={styles.waterPage}>
    <View style={[styles.waterStage,{width:stageWidth,height:stageHeight}]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 600" pointerEvents="none">
        <G transform="translate(260 140) scale(0.62)">
          <G transform={`rotate(${frame.tilt} 34 10)`}>
            <Path d="M66 -30 C138 -34 142 22 50 46" stroke="#9AC4D4" strokeWidth={15} fill="none" strokeLinecap="round"/>
            <Ellipse cx={10} cy={-62} rx={72} ry={16} rotation={11} origin="10, -62" fill="#4F7D8C"/>
            <Ellipse cx={-16} cy={54} rx={62} ry={14} rotation={11} origin="-16, 54" fill="#4F7D8C"/>
            <Path d="M-58.7 -69.4 L78.7 -42.6 L44.9 57.8 L-76.9 34.2 Z" fill="#9AC4D4"/>
            <Ellipse cx={10} cy={-56} rx={72} ry={16} rotation={11} origin="10, -56" fill="#9AC4D4"/>
            <Ellipse cx={-16} cy={46} rx={62} ry={14} rotation={11} origin="-16, 46" fill="#9AC4D4"/>
            <Path d="M-65.6 9.9 L-191.6 -46.1 L-200.4 -25.9 L-74.4 30.1 Z" fill="#9AC4D4"/>
            <Path d="M-191.6 -46.1 L-202.1 -71.6 L-225.9 -16.4 L-200.4 -25.9 Z" fill="#9AC4D4"/>
            <Ellipse cx={-214} cy={-44} rx={8} ry={30} rotation={23.3} origin="-214, -44" fill="#4F7D8C"/>
            <G fill="#38606E">{WATER_HOLES.map(([x,y],index)=><Circle key={index} cx={x} cy={y} r={2.4}/>)}</G>
            <G transform="translate(2 -8)" fill="#E9AC22">
              <Ellipse cx={0} cy={-23} rx={19} ry={16}/>
              <Ellipse cx={21.9} cy={-7.1} rx={19} ry={16} rotation={72} origin="21.9, -7.1"/>
              <Ellipse cx={13.5} cy={18.6} rx={19} ry={16} rotation={144} origin="13.5, 18.6"/>
              <Ellipse cx={-13.5} cy={18.6} rx={19} ry={16} rotation={216} origin="-13.5, 18.6"/>
              <Ellipse cx={-21.9} cy={-7.1} rx={19} ry={16} rotation={288} origin="-21.9, -7.1"/>
              <Circle cx={0} cy={0} r={12.5} fill="#1E6B4F"/>
            </G>
          </G>
        </G>
        {frame.paths.map((path,index)=>path?<Path key={index} d={path} fill="#7CB0C8"
          opacity={(index+1)/5}/>:null)}
        {frame.sparks.map((spark,index)=>{
          const t=spark.age/spark.life,e=1-(1-t)*(1-t),opacity=t<.35?t/.35:1-(t-.35)/.65;
          return <Circle key={index} cx={spark.x+Math.cos(spark.angle)*spark.distance*e}
            cy={spark.y+Math.sin(spark.angle)*spark.distance*e} r={spark.r*(1-t*.6)}
            fill={spark.gold?'#FACF3F':'#7CB0C8'} opacity={Math.max(0,opacity)}/>;
        })}
      </Svg>
      <View pointerEvents="none" style={styles.waterFlower}>{flower?<Image source={flower.source} contentFit="contain" style={styles.flower}/>:<Text style={{fontSize:140}}>🌼</Text>}</View>
      <Text pointerEvents="none" style={[styles.waterTip,{opacity:holding||complete?0:1}]}>Press and hold to water</Text>
      {complete&&<Text pointerEvents="none" style={styles.waterDone}>All watered 🌿</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Hold the watering can for three seconds"
        onPressIn={start} onPressOut={release} style={styles.waterHit}/>
    </View>
    <View style={styles.waterMeter}>
      <Text accessibilityLiveRegion="polite" style={styles.progressText}>{complete?'All watered 🌿':`Watering ${Math.round(frame.progress*100)}%`}</Text>
      <View style={styles.track}><View style={[styles.waterFill,{width:`${frame.progress*100}%`}]}/></View>
    </View>
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
  waterPage:{flex:1,alignItems:'center',justifyContent:'space-between',paddingBottom:42,backgroundColor:'#FDF8EF'},
  waterStage:{position:'relative',flexShrink:1},waterHit:{position:'absolute',left:'30%',top:'14%',width:'68%',height:'24%'},
  waterTip:{position:'absolute',top:'34%',left:0,right:0,textAlign:'center',fontSize:15,fontWeight:'700',color:'#4A3226'},
  waterDone:{position:'absolute',top:'34%',left:0,right:0,textAlign:'center',fontSize:16,fontWeight:'800',color:'#4FB3AC'},
  waterFlower:{position:'absolute',left:'16%',bottom:'3%',width:'68%',height:'36%',alignItems:'center',justifyContent:'center'},
  waterMeter:{width:'100%',maxWidth:360,paddingHorizontal:16,gap:10,alignItems:'center'},
  flower:{width:'100%',height:'100%'},
});
