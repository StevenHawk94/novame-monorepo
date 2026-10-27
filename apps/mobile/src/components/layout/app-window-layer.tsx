import {useState,useMemo,type ReactNode} from 'react';
import {StyleSheet,View,useWindowDimensions} from 'react-native';
import {useAppViewport,AppViewportContext} from '@/lib/app-viewport';

/** Native modals/FullWindowOverlay escape their React parent's native bounds.
 * Reapply the canvas at that boundary without changing modal lifecycle. */
export function AppWindowLayer({children}:{children:ReactNode}) {
  const native=useWindowDimensions(),canvas=useAppViewport();
  const [measured,setMeasured]=useState<{width:number;height:number;nativeWidth:number;nativeHeight:number}|null>(null);
  // Phone modals keep their exact former native sizing, including Android
  // status/navigation-bar exclusions. Only letterboxed surfaces need a cap.
  const constrained=canvas.width!==native.width||canvas.height!==native.height;
  const host=measured?.nativeWidth===native.width&&measured.nativeHeight===native.height?measured:native;
  const width=Math.min(canvas.width,host.width),height=Math.min(canvas.height,host.height);
  const viewport=useMemo(()=>({...canvas,width,height}),[canvas.scale,canvas.fontScale,width,height]);
  if(!constrained)return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{children}</View>;
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={event=>{
    const {width,height}=event.nativeEvent.layout;
    if(width>0&&height>0)setMeasured(previous=>previous?.width===width&&previous.height===height&&previous.nativeWidth===native.width&&previous.nativeHeight===native.height
      ?previous:{width,height,nativeWidth:native.width,nativeHeight:native.height});
  }}>
    <View pointerEvents="box-none" style={{position:'absolute',left:(host.width-width)/2,
      top:(host.height-height)/2,width,height,overflow:'hidden'}}>
      <AppViewportContext.Provider value={viewport}>{children}</AppViewportContext.Provider>
    </View>
  </View>;
}
