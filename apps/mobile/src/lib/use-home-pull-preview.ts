import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {Gesture} from 'react-native-gesture-handler';
import {cancelAnimation,Easing,ReduceMotion,runOnJS,runOnUI,useAnimatedStyle,useSharedValue,withTiming} from 'react-native-reanimated';
import {useOverlayPresent} from './overlay-presence';
import {HOME_PULL_ACTIVATION,HOME_PULL_HORIZONTAL_SLOP,HOME_PULL_PRESS_GUARD_MS,HOME_PULL_RETURN_MS,homePullMaximum,homePullProgress} from './home-pull-preview';

/** Native-only visual peek: no scrolling, network, refresh, or per-frame React state.
 * Keep the same animated node/children mounted while focus and overlays change. */
export function useHomePullPreview({enabled,scale,visibleHeight,scope}:{enabled:boolean;scale:number;visibleHeight:number;scope:string}){
  const overlay=useOverlayPresent();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const maxOffset=homePullMaximum(scale,visibleHeight),usable=enabled&&foreground&&!overlay&&maxOffset>0;
  const progress=useSharedValue(0),start=useSharedValue(0),maximum=useSharedValue(maxOffset);
  const phase=useSharedValue(0),blockedUntil=useSharedValue(0),allowed=useSharedValue(false);
  const epoch=useSharedValue(0),gestureEpoch=useSharedValue(-1);
  const alive=useRef(true);
  const pressState=useRef({generation:0,active:false,until:0});
  const mirrorPress=useCallback((generation:number,active:boolean,until:number)=>{
    if(alive.current&&pressState.current.generation===generation){pressState.current.active=active;pressState.current.until=until;}
  },[]);
  const eligibility=useRef({enabled:enabled&&!overlay&&maxOffset>0,maximum:maxOffset});
  useLayoutEffect(()=>{eligibility.current={enabled:enabled&&!overlay&&maxOffset>0,maximum:maxOffset};},[enabled,overlay,maxOffset]);
  const reset=useCallback((canMove=false,nextMaximum?:number)=>{
    const state=pressState.current;
    if(state.active)state.until=Date.now()+HOME_PULL_PRESS_GUARD_MS;
    state.active=false;const generation=++state.generation;
    runOnUI((nextAllowed:boolean,nextMaximum:number|undefined,generation:number)=>{
      'worklet';
      epoch.value=generation;allowed.value=nextAllowed;
      cancelAnimation(progress);
      if(phase.value!==0)blockedUntil.value=Date.now()+HOME_PULL_PRESS_GUARD_MS;
      phase.value=0;progress.value=0;start.value=0;
      if(nextMaximum!==undefined)maximum.value=nextMaximum;
      gestureEpoch.value=-1;
    })(canMove,nextMaximum,generation);
  },[epoch,allowed,progress,phase,blockedUntil,start,maximum,gestureEpoch]);
  useLayoutEffect(()=>{reset(usable,maxOffset);return()=>reset(false);},[usable,scope,maxOffset,reset]);
  useEffect(()=>{
    alive.current=true;
    const sub=AppState.addEventListener('change',state=>{
      // Reset immediately, including Control Centre/inactive and a cancelled
      // finger: an old native gesture cannot resume after the app returns.
      if(state!=='active')reset(false);
      else reset(eligibility.current.enabled,eligibility.current.maximum);
      setForeground(state==='active');
    });
    return()=>{alive.current=false;sub.remove();reset(false);};
  },[reset]);
  const gesture=useMemo(()=>Gesture.Pan()
    .enabled(usable).maxPointers(1)
    .activeOffsetY(HOME_PULL_ACTIVATION).failOffsetY([-HOME_PULL_ACTIVATION,1_000_000])
    .failOffsetX([-HOME_PULL_HORIZONTAL_SLOP,HOME_PULL_HORIZONTAL_SLOP])
    .cancelsTouchesInView(true).shouldCancelWhenOutside(false)
    .onStart(()=>{
      'worklet';
      if(!allowed.value)return;
      cancelAnimation(progress);start.value=progress.value;
      phase.value=1;gestureEpoch.value=epoch.value;blockedUntil.value=Number.MAX_SAFE_INTEGER;
      runOnJS(mirrorPress)(epoch.value,true,Number.MAX_SAFE_INTEGER);
    })
    .onUpdate(event=>{
      'worklet';
      if(!allowed.value||phase.value!==1||gestureEpoch.value!==epoch.value)return;
      progress.value=homePullProgress(start.value,event.translationY);
    })
    .onFinalize(()=>{
      'worklet';
      if(!allowed.value||phase.value!==1||gestureEpoch.value!==epoch.value)return;
      const token=epoch.value;
      phase.value=2;blockedUntil.value=Date.now()+HOME_PULL_PRESS_GUARD_MS;
      runOnJS(mirrorPress)(token,false,Date.now()+HOME_PULL_PRESS_GUARD_MS);
      progress.value=withTiming(0,{duration:HOME_PULL_RETURN_MS,easing:Easing.out(Easing.cubic),reduceMotion:ReduceMotion.System},finished=>{
        if(finished&&epoch.value===token&&phase.value===2)phase.value=0;
      });
    }),[usable,allowed,progress,start,phase,gestureEpoch,epoch,blockedUntil,mirrorPress]);
  const animatedStyle=useAnimatedStyle(()=>({transform:[{translateY:progress.value*maximum.value}]}));
  // Native cancellation handles ordinary touches. This also rejects delayed
  // JS Pressability callbacks from a drag/release or an interrupted gesture.
  const guard=useCallback((action:()=>void)=>()=>{
    // No synchronous JS -> UI reads in an ordinary tap. Native cancellation
    // rejects drags; the generation-fenced JS mirror rejects late callbacks.
    if(!alive.current||pressState.current.active||Date.now()<pressState.current.until)return;
    action();
  },[]);
  return{gesture,animatedStyle,guard};
}
