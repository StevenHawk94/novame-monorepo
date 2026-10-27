import { useId } from 'react';
import Svg, { Defs, Image, Path, ClipPath } from 'react-native-svg';
import { View, StyleSheet } from 'react-native';
import { Image as FrameImage } from './burrow-image';
import { SURPRISE_DEFAULT_FACE, SURPRISE_FRAME_OPTIONS } from '@/lib/surprise-frame-assets';
import { surpriseDefaultFacePlacement } from '@/lib/surprise-photo-geometry';
import geometry from '@/lib/surprise-frame-geometry.json';


// Compute once, not for every thumbnail/rain particle render.
const defaultFaceLayouts=Object.fromEntries(Object.entries(geometry).map(([frame,hole])=>[
  frame,surpriseDefaultFacePlacement(hole.bounds,hole.path),
]));

export function SurprisePortrait({frame,uri,size=240,transparentCenter=false,portraitUri}:{frame:string;uri?:string;size?:number;transparentCenter?:boolean;portraitUri?:string}) {
  const id=useId().replace(/:/g,'');
  if(portraitUri&&portraitUri!==uri)return <FrameImage source={{uri:portraitUri}} contentFit="fill" style={{width:size,height:size}} accessibilityLabel="Your surprise portrait"/>;
  const art=SURPRISE_FRAME_OPTIONS.find(option=>option.id===frame);
  const hole=geometry[frame as keyof typeof geometry];
  const face=uri?{uri}:transparentCenter?undefined:SURPRISE_DEFAULT_FACE;
  // Old messages keep only their photo and voice, never an old or substituted frame.
  if(!art||!hole)return <View accessibilityLabel="Surprise photo — frame unavailable" style={{width:size,height:size,borderRadius:size/2,overflow:'hidden'}}>
    {face&&<FrameImage source={face} contentFit="cover" style={StyleSheet.absoluteFill}/>}
  </View>;
  const [x,y,width,height]=hole.bounds;
  const placement=uri?{x,y,width,height}:defaultFaceLayouts[frame];
  return <View style={{width:size,height:size}} accessibilityLabel={`${art.name} face frame`}>
    <Svg width={size} height={size} viewBox="0 0 512 512" style={StyleSheet.absoluteFill}>
      <Defs><ClipPath id={`photo${id}`}><Path d={hole.path}/></ClipPath></Defs>
      {face&&<Image href={face} {...placement} preserveAspectRatio="xMidYMid slice" clipPath={`url(#photo${id})`}/>}
    </Svg>
    <FrameImage source={art.source} contentFit="fill" style={StyleSheet.absoluteFill}/>
  </View>;
}
