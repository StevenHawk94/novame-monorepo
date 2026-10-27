import { type ReactNode, useMemo,useEffect,useRef,useState } from 'react';
import { Keyboard,StyleSheet, useWindowDimensions, View } from 'react-native';
import {AppViewportContext} from '@/lib/app-viewport';
import {appViewportLayout,keyboardViewportLayout,APP_CANVAS_BACKGROUND} from '@/lib/app-viewport-layout';

/**
 * Phase-one large-screen compatibility frame.
 *
 * Burrow is still a phone-first, portrait experience. Android 16 can ignore a
 * portrait request on large displays, however, so an unfolded foldable or a
 * wide freeform window must not stretch the phone composition across the whole
 * display. Keep the complete app inside a centered portrait canvas until the
 * individual destinations receive purpose-built two-pane layouts.
 *
 * Compact portrait phones remain exactly full width. On a large display (the
 * Android medium-width breakpoint) or a clearly landscape/wide window, the
 * canvas is capped at 520dp. Prefer 9:20; shorter windows may use up to 9:16.
 * Tall windows get vertical as well as horizontal letterboxing. Nothing is
 * stretched, and keyboard resizing does not select another composition.
 */
export {LARGE_SCREEN_BREAKPOINT,APP_FRAME_MIN_WIDTH,APP_FRAME_MAX_WIDTH} from '@/lib/app-viewport-layout';
export const APP_FRAME_PORTRAIT_RATIO = 9 / 20;

export type AdaptiveFrameMetrics = {
  constrained: boolean;
  width: number;
  height:number;
  left:number;
  top:number;
};

export function getAdaptiveFrameMetrics(
  windowWidth: number,
  windowHeight: number,
): AdaptiveFrameMetrics {
  return appViewportLayout(windowWidth,windowHeight);
}

export function AdaptiveAppFrame({ children }: { children: ReactNode }) {
  const native = useWindowDimensions(),{width,height}=native;
  const [keyboardVisible,setKeyboardVisible]=useState(()=>Keyboard.isVisible());
  useEffect(()=>{
    const show=Keyboard.addListener('keyboardDidShow',()=>setKeyboardVisible(true));
    const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardVisible(false));
    return()=>{show.remove();hide.remove();};
  },[]);
  const previous=useRef<{windowWidth:number;frame:ReturnType<typeof appViewportLayout>}|null>(null);
  const keyboard=keyboardVisible||Keyboard.isVisible();
  const frame = useMemo(
    () => keyboardViewportLayout(width,height,previous.current,keyboard),
    [width, height,keyboard],
  );
  if(!keyboard)previous.current={windowWidth:width,frame};
  // Moving an unchanged canvas within a larger window must not redraw every
  // retained page. Native-coordinate outlets subscribe separately to offsets.
  const viewport=useMemo(()=>({...native,width:frame.width,height:frame.height}),[native.scale,native.fontScale,frame.width,frame.height]);

  return (
    <View style={styles.outside}>
      <View
        testID="adaptive-app-frame"
        style={[
          styles.canvas,
          frame.constrained ? { width: frame.width,height:frame.height,flex:0 } : styles.compactCanvas,
        ]}
      >
        <AppViewportContext.Provider value={viewport}>{children}</AppViewportContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outside: {
    flex: 1,
    alignItems: 'center',
    justifyContent:'center',
    backgroundColor: APP_CANVAS_BACKGROUND,
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: APP_CANVAS_BACKGROUND,
  },
  compactCanvas: {
    width: '100%',
  },
});
