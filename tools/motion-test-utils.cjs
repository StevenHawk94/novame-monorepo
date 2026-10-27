const {load,clock}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/burrow-motion.ts');
/** Deterministic UI-thread clock. React is only rendered by the test itself. */
function motionHarness(h,time=clock()) {
  const timings=[],values=[];
  function cancel(value) { for(const id of value.timers||[])time.globals.clearTimeout(id);value.timers=[];delete value.loop; }
  function schedule(value,animation,delay=0) {
    if(animation?.repeat){value.loop=animation;return;}
    if(animation?.delay!==undefined)return schedule(value,animation.animation,delay+animation.delay);
    if(animation?.sequence) {
      let elapsed=delay;for(const step of animation.sequence){schedule(value,step,elapsed);elapsed+=step.config?.duration||0;}return;
    }
    if(!animation?.timing){value.current=animation;return;}
    timings.push(animation);
    value.timers.push(time.globals.setTimeout(()=>{value.current=animation.value;animation.complete?.(true);},delay+animation.config.duration));
  }
  const reanimated={__esModule:true,default:{View:'AnimatedView',Text:'AnimatedText',createAnimatedComponent:type=>type},
    ReduceMotion:{System:'system',Never:'never'},Easing:{linear:'linear',cubic:'cubic',quad:'quad',in:x=>x,out:x=>x,inOut:x=>x},
    runOnJS:fn=>fn,runOnUI:fn=>fn,cancelAnimation:cancel,useAnimatedStyle:fn=>fn(),useAnimatedProps:fn=>fn(),
    withTiming:(value,config,complete)=>({timing:true,value,config,complete}),
    withDelay:(delay,animation)=>({delay,animation}),withSequence:(...sequence)=>({sequence}),
    withRepeat:(animation,count,reverse)=>({repeat:true,animation,count,reverse}),
    useDerivedValue:fn=>({get value(){return fn();}}),useReducedMotion:()=>false,
    useFrameCallback(callback,autostart=true){
      const ref=h.react.useRef(null);
      if(!ref.current){const driver={active:false,timer:null,callback,setActive(enabled){
        if(this.active===enabled)return;this.active=enabled;
        if(!enabled){time.globals.clearTimeout(this.timer);this.timer=null;return;}
        const step=()=>{if(!this.active)return;this.callback({timeSincePreviousFrame:16});if(this.active)this.timer=time.globals.setTimeout(step,16);};
        this.timer=time.globals.setTimeout(step,16);
      }};ref.current=driver;driver.setActive(autostart);}
      ref.current.callback=callback;h.react.useEffect(()=>()=>ref.current.setActive(false),[]);return ref.current;
    },
    useSharedValue(initial){const ref=h.react.useRef(null);if(!ref.current){const value={current:initial,timers:[],get value(){return this.current;},set value(next){cancel(this);schedule(this,next);},modify(fn){this.current=fn(this.current);}};ref.current=value;values.push(value);}return ref.current;},
  };
  return {reanimated,time,timings,values};
}
function presentationImports(h,time) {
  const motion=motionHarness(h,time);
  const jsx=(type,props)=>({type,props});
  const dialogue=load('apps/mobile/src/components/burrow/friend-dialogue.tsx',{
    react:h.react,
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
    './adventure-reveal':{AdventureReveal:'Reveal'},'./burrow-back-button':{BackIcon:'BackIcon'},
  });
  return {'react-native-reanimated':motion.reanimated,'@/lib/burrow-motion':model,
    './friend-dialogue':dialogue,
    './animated-coin-balance':{AnimatedCoinBalance:'NativeCounter'},
    './adventure-stage-transition':{AdventureStageTransition:'Transition'},
    './adventure-reward-popup':{AdventureRewardPopup:'RewardPopup'},
    './adventure-reveal':{AdventureReveal:'Reveal'},
    './adventure-reward-screen':{AdventureRewardScreen:'RewardScreen'},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20,bottom:0})},motion};
}
module.exports={model,motionHarness,presentationImports};
