import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type PropsWithChildren} from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useSegments} from 'expo-router';
import {BurrowLaunchScreen} from '@/components/main/burrow-launch-screen';
import {BURROW_LAUNCH_BACKGROUND} from '@/lib/burrow-onboarding-design';
import {getBurrowSnapshot,useBurrowSnapshot} from '@/lib/burrow-store';
import {burrowEnvironmentIsReady,getBurrowEnvironment,prepareBurrowEnvironment,refreshBurrowEnvironment,subscribeBurrowEnvironment,type EnvironmentContext} from '@/lib/burrow-environment-state';
import {countryForVisit,useBurrowStorefront} from '@/lib/use-burrow-storefront';
import {registerOverlay} from '@/lib/overlay-presence';
import {hideSplashOnce} from '@/lib/splash';
import {HOME_RESUME_AFTER_MS,homeEntryRemainingMs} from '@/lib/home-entry-readiness';
import {sessionUserId} from '@/lib/session-lifecycle';

/** A local-only visual handoff. Children (including the bunny) never unmount.
 * Only first entry/account replacement and a long background may cover the
 * room. Warm navigation/short resumes retain the complete outgoing scene
 * while Home and Burrow's next decoded environment commits atomically. */
export function BurrowEnvironmentGate({children,enabled}:{enabled:boolean}&PropsWithChildren){
  return enabled?<ActiveEnvironmentGate>{children}</ActiveEnvironmentGate>:children;
}
function ActiveEnvironmentGate({children}:PropsWithChildren){
  const {data}=useBurrowSnapshot(),country=useBurrowStorefront(),segments=useSegments();
  const snapshot=useSyncExternalStore(subscribeBurrowEnvironment,getBurrowEnvironment,getBurrowEnvironment);
  // Pair revalidation is not an account replacement or a new app launch.
  const owner=data?.profile.id??sessionUserId()??undefined,timeZone=data?.profile.timezone_name;
  const context:EnvironmentContext={owner:owner??'',timeZone,country};
  // Expo Router omits the index segment for Home; these are the scenic tabs.
  const scenic=segments[0]==='(main)'&&segments[1]==='(tabs)'&&(segments.length===2||segments[2]==='burrow');
  const [foreground,setForeground]=useState(AppState.currentState!=='background');
  const [paintedKey,setPaintedKey]=useState<string|null>(null);
  const [,redraw]=useState(0);
  const entering=useRef(true),previousOwner=useRef(owner);
  const backgroundAt=useRef<number|null>(AppState.currentState==='background'?Date.now():null);
  const overlay=useRef({}).current;
  // Route focus is NOT a new launch. The retained Home/Burrow underneath a
  // child page already owns its rendered scene, including native image refs.
  if(owner!==previousOwner.current)entering.current=true;
  previousOwner.current=owner;
  const ready=!!owner&&burrowEnvironmentIsReady(context);
  const visible=scenic&&entering.current&&(!foreground||!ready||paintedKey!==snapshot.key);
  const prepare=()=>{
    // Bundled environment needs no profile round trip. A known local session
    // can prepare it while the first server snapshot is still unavailable.
    const profile=getBurrowSnapshot().data?.profile;
    const id=profile?.id??owner;if(!id)return;
    void prepareBurrowEnvironment({owner:id,timeZone:profile?.timezone_name,country:countryForVisit()}).catch(()=>{});
  };
  useLayoutEffect(prepare,[owner,timeZone,country]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined,active=AppState.currentState!=='background';
    const tick=()=>{
      clearTimeout(timer);if(!active)return;
      prepare();timer=setTimeout(tick,60_000-Date.now()%60_000);
    };
    tick();
    const sub=AppState.addEventListener('change',state=>{
      if(state==='background'){
        if(backgroundAt.current===null)backgroundAt.current=Date.now();
        active=false;clearTimeout(timer);setForeground(false);
      }else if(state==='active'){
        const elapsed=backgroundAt.current===null?0:Date.now()-backgroundAt.current;
        backgroundAt.current=null;
        if(elapsed>=HOME_RESUME_AFTER_MS)entering.current=true;
        active=true;tick();setForeground(true);
      }
    });
    return()=>{active=false;clearTimeout(timer);sub.remove();};
  },[owner,timeZone,country]);
  useLayoutEffect(()=>{if(visible)return registerOverlay(overlay);},[visible,overlay]);
  useEffect(()=>{
    if(!visible||!foreground)return;
    const timer=setTimeout(()=>{
      entering.current=false;
      redraw(value=>value+1);
    },homeEntryRemainingMs());
    return()=>clearTimeout(timer);
  },[visible,foreground,owner]);
  useLayoutEffect(()=>{
    // Prepare the underlying destination while the child page is still open,
    // not for two extra covered frames after its Back Home action.
    if(!foreground||!ready)return;
    const key=snapshot.key;
    let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
      if(getBurrowEnvironment().key!==key||!burrowEnvironmentIsReady(context))return;
      entering.current=false;setPaintedKey(key);
    });});
    return()=>cancelAnimationFrame(frame);
  },[foreground,ready,snapshot.key]);
  return <View style={styles.root}>
    <View style={styles.root} pointerEvents={visible?'none':'auto'} accessibilityElementsHidden={visible} importantForAccessibility={visible?'no-hide-descendants':'auto'}>{children}</View>
    {visible&&<View testID="burrow-environment-cover" style={styles.cover} accessibilityViewIsModal onLayout={hideSplashOnce}>
      <BurrowLaunchScreen/>
      <View style={styles.status}>{snapshot.failed?<>
        <Text style={styles.copy}>Couldn’t prepare your room. Please try again.</Text>
        <Pressable accessibilityRole="button" onPress={()=>void refreshBurrowEnvironment().catch(()=>{})} style={styles.retry}><Text style={styles.copy}>Retry</Text></Pressable>
      </>:<ActivityIndicator color="#FFF2DF"/>}</View>
    </View>}
  </View>;
}
const styles=StyleSheet.create({root:{flex:1},cover:{...StyleSheet.absoluteFillObject,zIndex:90,elevation:90,backgroundColor:BURROW_LAUNCH_BACKGROUND},
  status:{position:'absolute',left:24,right:24,bottom:80,alignItems:'center',gap:16},copy:{color:'#FFF2DF',fontSize:16,textAlign:'center'},retry:{paddingVertical:14,paddingHorizontal:36,borderRadius:24,backgroundColor:'#673019'}});
