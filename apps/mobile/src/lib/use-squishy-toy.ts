import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, runOnUI, useFrameCallback, useReducedMotion, useSharedValue, type FrameInfo,type SharedValue } from 'react-native-reanimated';
import { haptics } from './haptics';
import { LEFT_EDGE_BACK_WIDTH } from './page-edge-gesture';
import { advanceToyMotion, beginToyTouch, cancelToyTouches, createToyMotion, endToyTouch, hitToy, moveToyTouch,
  feedback as toyFeedback,type ToyGeometry, type ToyHit,type ToyMotion } from './squishy-toy-motion';
import type {TouchEvent} from '@novame/domain';

export type ToyMotionHandle={hit:(kind:ToyHit)=>void};
export function useSquishyToy({geometry,left,top,disabled=false,onInteract,onControllerReady,action,interactionScope='toy',onInput,inputStart,inputOffset,onFrame,frameEnabled,readOnly=false}:{
  geometry:ToyGeometry;left:number;top:number;disabled?:boolean;onInteract?:()=>void;
  onControllerReady?:(handle:ToyMotionHandle|null)=>void;action?:{kind:ToyHit;token:number};
  interactionScope?:string;
  onInput?:(batch:TouchEvent[])=>void;inputStart?:SharedValue<number>;
  inputOffset?:SharedValue<number>;
  onFrame?:(motion:ToyMotion,frame:FrameInfo)=>void|boolean;readOnly?:boolean;
  frameEnabled?:SharedValue<boolean>;
}) {
  const reduced=useReducedMotion();
  const focused=useIsFocused();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const active=focused&&foreground&&!disabled;
  const state=useSharedValue(createToyMotion(geometry,reduced));
  const motionGeometry=useRef(geometry);
  const clock=useSharedValue(0);
  const holdAt=useSharedValue(-1);
  const clockReady=useSharedValue(false);
  // This flag is deliberately NOT a Canvas dependency. Stopping a controller
  // must not notify a shader mapper after Fabric has detached its native view.
  const running=useSharedValue(false);
  const inputBuffer=useSharedValue<TouchEvent[]>([]),lastFlush=useSharedValue(0);
  const inputGeneration=useRef(0),inputGenerationUI=useSharedValue(0);
  const inputObserver=useRef(onInput);inputObserver.current=onInput;
  const scope=useRef({key:interactionScope,revision:1});
  if(scope.current.key!==interactionScope)scope.current={key:interactionScope,revision:scope.current.revision+1};
  const revision=scope.current.revision,identity=useSharedValue(revision);
  const mounted=useRef(true),accepting=useRef(active),interact=useRef(onInteract),ready=useRef(onControllerReady);
  interact.current=onInteract;ready.current=onControllerReady;
  const record=useCallback((eventRevision:number)=>{if(mounted.current&&accepting.current&&scope.current.revision===eventRevision)interact.current?.();},[]);
  const deliverInput=useCallback((batch:TouchEvent[],eventRevision:number,generation:number)=>{if(mounted.current&&accepting.current&&scope.current.revision===eventRevision&&inputGeneration.current===generation)inputObserver.current?.(batch);},[]);
  const flushInput=useCallback(()=>{'worklet';if(!inputBuffer.value.length)return;const batch=inputBuffer.value;inputBuffer.value=[];lastFlush.value=clock.value;runOnJS(deliverInput)(batch,identity.value,inputGenerationUI.value);},[inputBuffer,lastFlush,clock,deliverInput,identity,inputGenerationUI]);
  const emitInput=useCallback((kind:number,id:number,x:number,y:number)=>{
    'worklet';if(!onInput||!running.value||!clockReady.value)return;
    if(inputStart&&inputStart.value<0){if(![0,4,5].includes(kind))return;inputStart.value=clock.value;}
    const elapsed=inputStart?Math.max(0,Math.round(clock.value-inputStart.value))+(inputOffset?.value??0):0;
    if(inputStart&&elapsed>=60000)return;
    const b=geometry.bounds,lo=kind===0?0:-1000,hi=kind===0?1000:2000,
      nx=kind>=4?0:Math.round(Math.max(lo,Math.min(hi,1000*(x-b[0])/Math.max(1,b[2]-b[0])))),
      ny=kind>=4?0:Math.round(Math.max(lo,Math.min(hi,1000*(y-b[1])/Math.max(1,b[3]-b[1]))));
    inputBuffer.value=[...inputBuffer.value,[inputOffset?elapsed:Math.round(clock.value),kind,id,nx,ny]];
    if(kind!==1||inputBuffer.value.length>=16)flushInput();
  },[onInput,running,clockReady,inputStart,inputOffset,clock,geometry,inputBuffer,flushInput]);
  const performRecord=useCallback((eventRevision?:number,kind?:ToyHit)=>{
    'worklet';if(running.value&&(eventRevision===undefined||eventRevision===identity.value)){if(kind)emitInput(kind==='squeeze'?4:5,0,0,0);runOnJS(record)(eventRevision??identity.value);}
  },[identity,record,running,emitInput]);
  const feedback=useCallback((heavy=false)=>{if(mounted.current&&accepting.current)void (heavy?haptics.medium():haptics.light());},[]);
  const buttonFeedback=useCallback(()=>{if(mounted.current&&accepting.current)void haptics.soft();},[]);
  useEffect(()=>{const subscription=AppState.addEventListener('change',status=>{
    // Invalidate queued JS deliveries synchronously, before React may batch
    // inactive/active into one render. They cannot reopen a paused pointer.
    const generation=++inputGeneration.current;
    runOnUI(()=>{'worklet';inputGenerationUI.value=generation;inputBuffer.value=[];clockReady.value=false;})();
    setForeground(status==='active');
  });return()=>subscription.remove();},[inputGenerationUI,inputBuffer,clockReady]);
  useEffect(()=>{
    runOnUI(()=>{'worklet';inputBuffer.value=[];identity.value=revision;if(running.value)state.modify(value=>{cancelToyTouches(value);return value;},true);})();
  },[revision,identity,state,running,inputBuffer]);
  const frameCallback=useCallback((frame:FrameInfo)=>{
    'worklet';
    if(!running.value)return;
    if(frameEnabled&&!frameEnabled.value)return; // A paused replay must not notify mesh/shader mappers.
    clock.value=frame.timestamp;
    clockReady.value=true;
    if(onInput&&clock.value-lastFlush.value>=100)flushInput();
    // Only Touch Note capture repeats held feedback. Ordinary touches already
    // emit once in beginToyTouch; holding or dragging must not add more bursts.
    if(onInput&&!readOnly&&state.value.touches.length){
      if(holdAt.value<0)holdAt.value=clock.value;
      else if(clock.value-holdAt.value>=500){holdAt.value=clock.value;let notify=false;state.modify(v=>{const t=v.touches[0];v.clock=clock.value;notify=toyFeedback(v,t.x,t.y);return v;},true);if(notify)runOnJS(feedback)();}
    }else holdAt.value=-1;
    if(onFrame){state.modify(value=>{const advance=onFrame(value,frame);if(advance!==false&&value.active)advanceToyMotion(value,frame.timeSincePreviousFrame??0);return value;},true);return;}
    if(!state.value.active)return; // No Canvas updates while idle.
    state.modify(value=>{advanceToyMotion(value,frame.timeSincePreviousFrame??0);return value;},true);
  },[clock,clockReady,state,running,onFrame,frameEnabled,onInput,lastFlush,flushInput,readOnly,holdAt,feedback]);
  const frameDriver=useFrameCallback(frameCallback,false);
  useLayoutEffect(()=>{
    accepting.current=active;
    const generation=++inputGeneration.current;
    const geometryChanged=motionGeometry.current!==geometry;motionGeometry.current=geometry;
    runOnUI((enabled:boolean)=>{
      'worklet';inputGenerationUI.value=generation;running.value=enabled;clockReady.value=false;
      // Replay owns its pause/resume cursor and held pose. Only a geometry
      // change resets it; ordinary user gestures still reset on foreground.
      if(enabled&&(!readOnly||geometryChanged))state.value=createToyMotion(geometry,reduced);
    })(active);
    frameDriver.setActive(active);
    return()=>{
      accepting.current=false;
      inputGeneration.current++;
      frameDriver.setActive(false);
      // Never modify motion/shader uniforms in teardown. A queued final frame
      // or gesture can still run, but only reads this independent stop flag.
      runOnUI(()=>{'worklet';running.value=false;})();
    };
  },[active,frameDriver,geometry,reduced,state,running,clockReady,inputGenerationUI,readOnly]);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;accepting.current=false;};},[]);
  const performHit=useCallback((kind:ToyHit)=>{
    'worklet';
    if(disabled||!running.value)return;
    let notify=false;
    state.modify(value=>{value.clock=clock.value;notify=hitToy(value,kind);return value;},true);
    if(notify)runOnJS(buttonFeedback)();
  },[state,clock,disabled,buttonFeedback,running]);
  const handle=useMemo<ToyMotionHandle>(()=>({hit:kind=>{if(mounted.current&&accepting.current)runOnUI(performHit)(kind);}}),[performHit]);
  useEffect(()=>{
    ready.current?.(handle);
    return()=>{ready.current?.(null);};
  },[handle]);
  useEffect(()=>{if(action?.token)handle.hit(action.kind);},[action?.token,handle]);
  const gesture=useMemo(()=>Gesture.Manual().enabled(!disabled&&!readOnly).shouldCancelWhenOutside(false)
    .onTouchesDown((event,manager)=>{
      'worklet';
      if(!running.value){manager.fail();return;}
      // Native page-back owns the physical left edge, even inside the toy.
      if(event.allTouches.length===event.changedTouches.length&&event.changedTouches[0]?.absoluteX<=LEFT_EDGE_BACK_WIDTH){manager.fail();return;}
      const wasIdle=state.value.touches.length===0;
      let notify=false,accepted=false;
      state.modify(value=>{
        value.clock=clock.value;
        for(const t of event.changedTouches) {
          const result=beginToyTouch(value,t.id,(t.x-left)/geometry.scale,(t.y-top)/geometry.scale);
          if(result.accepted)emitInput(0,t.id,(t.x-left)/geometry.scale,(t.y-top)/geometry.scale);
          notify=notify||result.feedback;accepted=accepted||result.accepted;
        }
        return value;
      },true);
      if(accepted&&wasIdle){manager.begin();manager.activate();}
      else if(state.value.touches.length===0)manager.fail();
      if(notify)runOnJS(feedback)();
    })
    .onTouchesMove(event=>{
      'worklet';
      if(!running.value)return;
      state.modify(value=>{
        for(const t of event.changedTouches){const held=value.touches.some(v=>v.id===t.id);moveToyTouch(value,t.id,(t.x-left)/geometry.scale,(t.y-top)/geometry.scale);if(held)emitInput(1,t.id,(t.x-left)/geometry.scale,(t.y-top)/geometry.scale);}
        return value;
      },true);
    })
    .onTouchesUp((event,manager)=>{
      'worklet';
      if(!running.value)return;
      let completed=0;
      state.modify(value=>{for(const t of event.changedTouches)if(endToyTouch(value,t.id)){completed++;emitInput(2,t.id,(t.x-left)/geometry.scale,(t.y-top)/geometry.scale);}return value;},true);
      for(let i=0;i<completed;i++)performRecord();
      if(state.value.touches.length===0)manager.end();
    })
    .onTouchesCancelled((_event,manager)=>{
      'worklet';if(!running.value)return;state.modify(value=>{for(const t of value.touches)emitInput(3,t.id,t.x,t.y);cancelToyTouches(value);return value;},true);manager.fail();
    })
    .onFinalize(()=>{
      'worklet';if(running.value&&state.value.touches.length)state.modify(value=>{for(const t of value.touches)emitInput(3,t.id,t.x,t.y);cancelToyTouches(value);return value;},true);
    }),[state,clock,geometry,left,top,disabled,readOnly,feedback,performRecord,running,emitInput]);
  return {state,gesture,handle,performHit,record:performRecord,identity};
}
