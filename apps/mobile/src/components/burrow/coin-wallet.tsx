import {useEffect,useLayoutEffect,useRef} from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {useAppWindowGeometry} from '@/lib/app-viewport';
import {useIsFocused,useNavigation} from '@react-navigation/native';
import {registerCoinWallet} from '@/lib/coin-wallet-registry';
import {coinWalletMetrics,coinWalletWidth,homeWalletFontSize} from '@/lib/coin-wallet-layout';
import {useCoinWalletRegistry} from '@/lib/coin-wallet-registry';
import {useWalletMotion} from './coin-wallet-context';
import {CoinWalletFace} from './coin-wallet-face';

/** A page owns the wallet's position/action, never another copy of its money.
 * Native placement follows its page's navigation animation. A modal promotes
 * the same logical wallet and temporarily hides this face, preserving space. */
export function CoinWallet({balance,onPress,disabled=false,fontSize,style,onAnchor,showAdd=true}: {
  balance:number|null;onPress:()=>void;disabled?:boolean;fontSize?:number;style?:StyleProp<ViewStyle>;showAdd?:boolean;
  onAnchor?:(anchor:{x:number;y:number;width:number;height:number})=>void;
}){
  const viewport=useWindowDimensions(),windowGeometry=useAppWindowGeometry();fontSize??=homeWalletFontSize(viewport.width,viewport.height);
  const focused=useIsFocused(),navigation=useNavigation(),owner=useRef({}).current,view=useRef<View>(null),release=useRef<(()=>void)|undefined>(undefined),generation=useRef(0);
  const model=useWalletMotion(),registry=useCoinWalletRegistry();
  const action=useRef(onPress),notify=useRef(onAnchor);action.current=onPress;notify.current=onAnchor;
  const m=coinWalletMetrics(fontSize),width=coinWalletWidth(balance??0,fontSize,showAdd);
  const active=useRef(focused);active.current=focused;
  const measure=()=>{const token=generation.current;view.current?.measureInWindow((x,y,width,height)=>{
    if(token!==generation.current||!active.current||width<=0||height<=0)return;
    const anchor={x,y:y+m.touchInset,width,height:m.height};
    release.current?.();release.current=registerCoinWallet({owner,anchor,fontSize,showAdd,onPress:()=>action.current(),disabled:disabled||balance===null});
    notify.current?.(anchor);
  });};
  const latestMeasure=useRef(measure);latestMeasure.current=measure;
  useLayoutEffect(()=>{generation.current++;active.current=focused;measure();return()=>{generation.current++;active.current=false;release.current?.();release.current=undefined;};},[focused,fontSize,width,showAdd,disabled,balance===null,windowGeometry.left,windowGeometry.top]);
  useEffect(()=>navigation.addListener('transitionEnd' as never,()=>latestMeasure.current()),[navigation]);
  useEffect(()=>()=>{active.current=false;},[]);
  return <View ref={view} collapsable={false} onLayout={measure}
    testID="coin-wallet-slot" style={[{height:m.touchHeight,marginVertical:-m.touchInset,opacity:registry.portal?0:1},style]}>
    {model&&model.balance!==null?<CoinWalletFace count={model.count} balance={model.balance} fontSize={fontSize} showAdd={showAdd}
      onPress={()=>action.current()} disabled={disabled||balance===null||!!registry.portal}/>:<View style={{width,height:m.touchHeight}}/>}
  </View>;
}
