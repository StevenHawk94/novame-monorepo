import {memo,useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {Pressable} from '@/components/ui/feedback-pressable';
import {useAppViewport} from '@/lib/app-viewport';
import Animated,{runOnJS,runOnUI,useAnimatedProps,useDerivedValue,useFrameCallback,useReducedMotion,useSharedValue,type SharedValue} from 'react-native-reanimated';
import Svg,{Circle,ClipPath,Defs,Ellipse,G,LinearGradient,Path,RadialGradient,Rect,Stop} from 'react-native-svg';
import type {RoomCareAction} from '@novame/domain';
import reference from '@/lib/garden-care-art.json';
import {createGardenParticles,gardenFrame,gardenFlowerLayout,gardenToolTransform,GARDEN_DURATION} from '@/lib/garden-care-motion';
import type {BurrowArtAsset} from '@/lib/burrow-art-assets';
import {Image} from './burrow-image';
import {useCareHoldFeedback} from './care-interaction';
import {CareProgress} from './care-progress';
const MovingPath=Animated.createAnimatedComponent(Path),MovingG=Animated.createAnimatedComponent(G<{matrix?:number[]}>);
type Frame=ReturnType<typeof gardenFrame>;
type Node={tag:string;props:Record<string,string|undefined>;children:Node[]};
const elements:Record<string,React.ElementType>={svg:Svg,defs:Defs,rect:Rect,g:G,path:Path,circle:Circle,ellipse:Ellipse,
 linearGradient:LinearGradient,radialGradient:RadialGradient,stop:Stop};
function FoodClip({frame}:{frame:SharedValue<Frame>}){
 const props=useAnimatedProps(()=>({d:frame.value.mask}));return <MovingPath animatedProps={props}/>;
}
function RotatingArt({frame,water,children}:{frame:SharedValue<Frame>;water:boolean;children:React.ReactNode}){
 const tool=gardenToolTransform(water?'water':'fertilizer');
 const props=useAnimatedProps(()=>{const a=frame.value.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=water?180:210,y=water?175:150;
  return {matrix:[c,s,-s,c,x-x*c+y*s,y-x*s-y*c]};});
 return <G transform={`translate(${tool.x} ${tool.y}) scale(${tool.scale})`}><MovingG animatedProps={props}>{children}</MovingG></G>;
}
const colors={leaf:['#7ec51b','#a7d959'],carrot:['#ed8a3c','#88ad49'],fertilizer:['#57382a','#57382a'],water:['#79c4d8','#b1e0e9']};
function Particles({frame,action,index}:{frame:SharedValue<Frame>;action:RoomCareAction;index:number}){
 const props=useAnimatedProps(()=>({d:frame.value.paths[index]}));
 return <MovingPath fill={colors[action][Math.floor(index/8)]} opacity={(index%8+1)/8} animatedProps={props}/>;
}
function Jet({frame,index}:{frame:SharedValue<Frame>;index:number}){
 const props=useAnimatedProps(()=>({d:frame.value.jets[index],opacity:frame.value.jetOpacity}));
 return <MovingPath fill="none" stroke="#81c9db" strokeLinecap="round" strokeWidth={index===0?1.7:1.35} animatedProps={props}/>;
}
function ReferenceNode({node,prefix,frame,action,root,size}:{node:Node;prefix:string;frame:SharedValue<Frame>;action:RoomCareAction;root?:boolean;size:number}){
 const id=node.props.id;
 if(node.tag==='mask')return <ClipPath id={prefix+id}><FoodClip frame={frame}/></ClipPath>;
 const children=node.children.map((n,i)=><ReferenceNode key={i} node={n} prefix={prefix} frame={frame} action={action} size={size}/>);
 if(['crumbs','carrotCrumbs','grains','waterDrops'].includes(id??''))return <G>{Array.from({length:16},(_,i)=><Particles key={i} action={action} frame={frame} index={i}/>)}</G>;
 if(id==='waterJets')return <G><Jet frame={frame} index={0}/><Jet frame={frame} index={1}/></G>;
 if(id==='bagRotate'||id==='waterRotate')return <RotatingArt frame={frame} water={id==='waterRotate'}>{children}</RotatingArt>;
 const props:Record<string,unknown>={};for(const [key,value]of Object.entries(node.props))if(value!==undefined)props[key==='mask'?'clipPath':key]=key==='id'?prefix+value:value.replace(/url\(#([^)]*)\)/g,(_,v)=>`url(#${prefix}${v})`);
 // react-native-svg extracts stop.props directly before React renders them;
 // a recursive wrapper here would silently turn every gradient stop black.
 if(node.tag==='linearGradient'||node.tag==='radialGradient'){
  const Gradient=elements[node.tag];return <Gradient {...props}>{node.children.map((stop,i)=><Stop key={i} {...stop.props}/>)}</Gradient>;
 }
 // Browser SVG IDs span nested <svg> viewports; native SVG definition lookup
 // does not. Flatten the reference's two square inner viewports to equivalent
 // transforms so their masks share the one native root definition registry.
 if(node.tag==='svg'&&!root){
  const [vx,vy,vw,vh]=String(node.props.viewBox).split(/\s+/).map(Number),w=Number(node.props.width),h=Number(node.props.height);
  const scale=Math.min(w/vw,h/vh),x=Number(node.props.x??0)+(w-vw*scale)/2,y=Number(node.props.y??0)+(h-vh*scale)/2;
  return <G transform={`translate(${x} ${y}) scale(${scale}) translate(${-vx} ${-vy})`}>{children}</G>;
 }
 if(root){props.width=size;props.height=size*(action==='water'||action==='fertilizer'?480/420:1);props.viewBox=action==='water'||action==='fertilizer'?'0 0 420 480':props.viewBox;props.accessible=false;props.pointerEvents='none';}
 const Element=elements[node.tag];return <Element {...props}>{children}</Element>;
}
const Artwork=memo(function Artwork({action,frame,size,prefix}:{action:RoomCareAction;frame:SharedValue<Frame>;size:number;prefix:string}){
 return <ReferenceNode node={reference.art[action]} frame={frame} action={action} prefix={prefix} size={size} root/>;
});
/** Shared four-action hold controller. Release/background/focus loss freeze
 * the SAME elapsed time, mask and particle paths. No WebView/JS frame renders. */
export function GardenCareInteraction({action,flower,onComplete,complete,availableHeight}:{action:RoomCareAction;flower?:BurrowArtAsset;onComplete:()=>void;complete:boolean;availableHeight?:number}){
 const {width,height}=useAppViewport(),[measured,setMeasured]=useState<number|null>(null),reduced=useReducedMotion();
 const body=measured??availableHeight??height-140;
 const pouring=action==='water'||action==='fertilizer',ratio=pouring?480/420:1;
 const size=Math.max(1,Math.min(420,width-32,(body-128)/ratio));
 const flowerLayout=useMemo(()=>gardenFlowerLayout(flower),[flower]),artScale=size/420;
 const prefix=useId().replace(/[^a-z0-9]/gi,'')+'garden';
 const elapsed=useSharedValue(complete?GARDEN_DURATION[action]:0),holding=useSharedValue(false),delivered=useSharedValue(complete);
 const callback=useRef(onComplete);callback.current=onComplete;
 const finishRef=useRef<()=>void>(()=>{});
 const deliver=useCallback(()=>finishRef.current(),[]);
 const alive=useRef(true),finished=useRef(complete);
 const feedback=useCareHoldFeedback(()=>stop());
 const particles=useMemo(()=>createGardenParticles(action),[action]);
 const landing=flowerLayout.landing;
 const frame=useDerivedValue(()=>gardenFrame(action,elapsed.value,particles,reduced,landing),[action,particles,reduced,landing]);
 const progress=useDerivedValue(()=>elapsed.value/GARDEN_DURATION[action],[action]);
 function stop(){runOnUI(()=>{'worklet';holding.value=false;})();ticker.setActive(false);feedback.stop();}
 function finish(){
  if(!alive.current||!feedback.canStart()||finished.current)return;
  finished.current=true;stop();callback.current();
 }
 finishRef.current=finish;
 const tick=useCallback((info:{timeSincePreviousFrame:number|null})=>{
  'worklet';
  if(!holding.value||delivered.value)return;
  elapsed.value=Math.min(GARDEN_DURATION[action],elapsed.value+Math.max(0,info.timeSincePreviousFrame??0));
  if(elapsed.value>=GARDEN_DURATION[action]){holding.value=false;delivered.value=true;runOnJS(deliver)();}
 },[action,holding,delivered,elapsed,deliver]);
 const ticker=useFrameCallback(tick,false);
 function start(){
  if(complete||finished.current||!feedback.canStart())return;
  if(delivered.value){finish();return;}
  feedback.start();runOnUI(()=>{'worklet';holding.value=true;})();ticker.setActive(true);
 }
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop();};},[]);
 useEffect(()=>{if(complete){finished.current=true;stop();runOnUI(()=>{'worklet';elapsed.value=GARDEN_DURATION[action];delivered.value=true;})();}},[complete,action]);
 const label={carrot:'Hold to feed your bunny a carrot',water:'Hold to water your flower',leaf:'Hold to feed your partner’s bunny some greens',fertilizer:'Hold to fertilize your partner’s flower'}[action];
 return <View style={s.root} testID={`garden-care-${action}`} onLayout={event=>{if(event.nativeEvent.layout.height>0)setMeasured(event.nativeEvent.layout.height);}}>
  <Text style={s.hint}>Press and Hold</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Release to pause. Hold again to continue."
   disabled={complete} onPressIn={start} onPressOut={stop} onAccessibilityTap={start}
   style={{width:size,height:size*ratio,alignSelf:'center'}}>
   <Artwork action={action} frame={frame} prefix={prefix} size={size}/>
   {pouring&&flower&&<View pointerEvents="none" testID="garden-care-flower" style={{position:'absolute',overflow:'hidden',
    left:flowerLayout.left*artScale,top:flowerLayout.top*artScale,width:flowerLayout.width*artScale,height:flowerLayout.height*artScale}}>
    <Image source={flower.source} contentFit="contain" style={{position:'absolute',left:flowerLayout.image.left*artScale,top:flowerLayout.image.top*artScale,
     width:flowerLayout.image.width*artScale,height:flowerLayout.image.height*artScale}}/>
   </View>}
  </Pressable>
  <View style={s.meter}><CareProgress progress={progress} label={action==='water'?'Watering':action==='fertilizer'?'Fertilizing':'Feeding'} color={action==='water'?'#81C9DB':'#A8C972'}/><Text style={s.resume}>Release to pause · Hold to continue</Text></View>
 </View>;
}
const s=StyleSheet.create({root:{flex:1,justifyContent:'center',gap:14},hint:{fontSize:18,fontWeight:'700',color:'#604124',textAlign:'center'},
 meter:{marginHorizontal:28,gap:10},resume:{fontSize:13,color:'#816F5B',textAlign:'center'}});
