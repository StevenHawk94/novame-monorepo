import {createContext,useContext} from 'react';
import {Dimensions,useWindowDimensions,type ScaledSize} from 'react-native';
import {appViewportLayout} from './app-viewport-layout';

export const AppViewportContext=createContext<ScaledSize|null>(null);

/** All app-owned layouts use this size; native camera/library UI remains OS-owned. */
export function useAppViewport():ScaledSize {
  const native=useWindowDimensions(),canvas=useContext(AppViewportContext);
  return canvas??{...native,...appViewportLayout(native.width,native.height)};
}

/** Non-React image preparation must plan for the same canvas as the renderer. */
export function getAppViewport():ScaledSize {
  const native=Dimensions.get('window');
  return {...native,...appViewportLayout(native.width,native.height)};
}

/** measureInWindow/FullWindowOverlay use native coordinates, not canvas-local ones. */
export function useAppWindowGeometry() {
  const native=useWindowDimensions(),canvas=useContext(AppViewportContext)??{
    ...native,...appViewportLayout(native.width,native.height),
  };
  return {left:(native.width-canvas.width)/2,top:(native.height-canvas.height)/2,
    nativeWidth:native.width,nativeHeight:native.height,width:canvas.width,height:canvas.height};
}
