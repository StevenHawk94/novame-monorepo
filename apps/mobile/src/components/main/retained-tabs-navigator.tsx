import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {
  createNavigatorFactory, TabRouter, useIsFocused, useNavigationBuilder,
  type ParamListBase, type TabActionHelpers, type TabNavigationState, type TabRouterOptions,
} from '@react-navigation/native';
import type {
  BottomTabNavigationEventMap, BottomTabNavigationOptions, BottomTabNavigatorProps,
} from '@react-navigation/bottom-tabs';
import { withLayoutContext } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { homeTabBarHeight } from '@/lib/burrow-home-layout';
import { isRetainedTabCard, retainedTabAction, retainedTabDirection, retainedTabHistory, retainedTabLayers, shouldExitRetainedTab } from '@/lib/retained-tab-layers';
import { BottomTabBar } from './bottom-tab-bar';
import { pageTouchStartX, shouldStartEdgeBack } from '@/lib/page-edge-gesture';
import { uiWorkPriority } from '@/lib/ui-work-priority';
import { markInteractionTiming } from '@/lib/interaction-timing';
import { AnimatedTabScene } from './retained-tab-scene';

type Transition = {
  from: string; to: string; direction: 'open' | 'close'; offset: Animated.Value; width: number;
};
const emptyScene=()=>null;

/**
 * Same TabRouter/cache lifetime as bottom-tabs, with a retained card compositor.
 * BottomTabView hides/detaches inactive scenes even when their React trees survive;
 * translating a child inside it cannot expose Home. Here the actual descriptors
 * stay in stable, keyed, full-size layers. Off-history scenes are invisible but
 * keep their layout and decoded images warm; only the history receives touches.
 */
export function RetainedTabsNavigator(props: BottomTabNavigatorProps) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    TabNavigationState<ParamListBase>, TabRouterOptions, TabActionHelpers<ParamListBase>,
    BottomTabNavigationOptions, BottomTabNavigationEventMap
  >(TabRouter, { ...props, UNSTABLE_router: router => ({
    getStateForAction(state, action, options) {
      const next = router.getStateForAction(state, retainedTabAction(state, action) as typeof action, options);
      return next?.stale === false ? retainedTabHistory(state, next) : next;
    },
  }) });
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const navigationRef = useRef(navigation); navigationRef.current = navigation;
  const selected = state.routes[state.index].key;
  const home = state.routes.find(route => route.name === 'index')?.key;
  const handoffs = useRef(new Map<string, string>());
  const token = (state.routes[state.index].params as { __tabHandoff?: string } | undefined)?.__tabHandoff;
  const nativeHandoff = !!token && handoffs.current.get(selected) !== token;
  if (token) handoffs.current.set(selected, token);
  const previous = useRef(state);
  const mounted = useRef(new Set<string>());
  const painted = useRef(new Set<string>());
  const offsets = useRef(new Map<string, Animated.Value>());
  const exitShields = useRef(new Map<string,{width:number;offset:Animated.AnimatedInterpolation<number>}>());
  const transitionRef = useRef<Transition | null>(null);
  const dragging = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const completedGestureExit = useRef<string | null>(null);
  const gestureAnimation = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const retiredGestureAnimation = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const gestureGeneration = useRef(0);
  const gestureExitFrom = useRef<string | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const [finishedTransition, setFinishedTransition] = useState<Transition | null>(null);
  const [settling, setSettling] = useState(false);

  // Never change a retained layer's Animated node identity (or switch it to a
  // plain number). RN 0.81 restores native default props when replacing an
  // AnimatedProps graph. Swapping 0 -> a new node on a warm tab can reset its
  // position before the entrance runs: the apparent second entrance.
  for (const route of state.routes) {
    if (!offsets.current.has(route.key)) offsets.current.set(route.key, new Animated.Value(0));
    if(exitShields.current.get(route.key)?.width!==width)exitShields.current.set(route.key,{width,
      offset:offsets.current.get(route.key)!.interpolate({inputRange:[0,Math.max(0,width-.001),width],outputRange:[0,0,width],extrapolate:'clamp'})});
  }

  // Allocate the entrance value synchronously, BEFORE making a retained scene
  // visible. An effect that resets an already-visible page exposes a blank frame.
  if (previous.current.routes[previous.current.index].key !== selected) {
    // A newly exposed button may navigate before the old native swipe sends
    // its JS completion. Invalidate BEFORE setValue can synchronously stop it,
    // including leaving and immediately reopening the SAME route key.
    if(gestureAnimation.current){
      gestureGeneration.current++;
      retiredGestureAnimation.current=gestureAnimation.current;gestureAnimation.current=null;
    }
    const direction = retainedTabDirection(previous.current, state);
    const from = previous.current.routes[previous.current.index].key;
    const offset = offsets.current.get(direction === 'open' ? selected : from)!;
    const alreadyExited = direction === 'close' && completedGestureExit.current === from;
    completedGestureExit.current = null;
    const animate = focused && !!direction && !nativeHandoff && !alreadyExited;
    // Home/Quests never translate. Even setValue(0) flushes a JS-driven
    // Animated.Value and schedules a child update DURING navigator render.
    // Do not touch those constant root nodes on My Room's first return.
    // Cards receive one final target write, never width -> 0 during handoff.
    if (isRetainedTabCard(state.routes[state.index].name))
      offsets.current.get(selected)!.setValue(animate && direction === 'open' ? width : 0);
    // A native child owns its own exit. Never run another entrance beneath it.
    transitionRef.current = animate ? { from, to: selected, direction: direction!, offset, width } : null;
    previous.current = state;
    dragging.current = false;
    touchStartX.current = null;
  }
  const transition = transitionRef.current === finishedTransition ? null : transitionRef.current;
  const layers = retainedTabLayers(state);
  if (transition?.direction === 'close') layers.push(transition.from);
  const gestureDestination = !transition && settling && gestureExitFrom.current === selected
    ? layers[layers.length - 2] : undefined;
  for (const key of [...layers, ...state.preloadedRouteKeys]) mounted.current.add(key);
  const selectedOffset = offsets.current.get(selected)!;
  const canExit = isRetainedTabCard(state.routes[state.index].name);
  const hasTabBack = state.history.some(entry => entry.type === 'route' && entry.key !== selected);
  const footerHeight = homeTabBarHeight(width, insets.bottom);

  useLayoutEffect(()=>{
    retiredGestureAnimation.current?.stop();retiredGestureAnimation.current=null;
    if(gestureExitFrom.current&&gestureExitFrom.current!==selected){gestureExitFrom.current=null;setSettling(false);}
  },[selected]);

  useLayoutEffect(() => {
    if (!transition) return;
    uiWorkPriority.transition('retained-tabs', true);
    markInteractionTiming('commit');
    navigationRef.current.emit({ type: 'transitionStart', target: transition.direction === 'open' ? transition.to : transition.from });
    const animation = Animated.timing(transition.offset, {
      toValue: transition.direction === 'open' ? 0 : transition.width,
      duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    const start = () => { markInteractionTiming('transitionStart'); animation.start(({ finished }) => {
      if (!finished || transitionRef.current !== transition) return;
      // Leave closing content offscreen until the same commit hides its layer.
      setFinishedTransition(transition);
      navigationRef.current.emit({ type: 'transitionEnd', target: transition.direction === 'open' ? transition.to : transition.from });
      uiWorkPriority.transition('retained-tabs', false);
      markInteractionTiming('transitionEnd');
    }); };
    // Give a first-visit scene one native layout/paint frame offscreen. Warm
    // visits keep the same decoded images; neither path paints a loading cover.
    const frame = transition.direction === 'open' && !painted.current.has(transition.to) ? requestAnimationFrame(start) : null;
    if (frame === null) start();
    return () => { if (frame !== null) cancelAnimationFrame(frame); animation.stop(); uiWorkPriority.transition('retained-tabs', false); };
  // Navigation helpers can change identity during preload/cache updates. The
  // route transition, not those renders, owns this animation exactly once.
  }, [transition]);

  useLayoutEffect(() => () => {
    gestureGeneration.current += 1;
    gestureAnimation.current?.stop();
  }, []);
  useLayoutEffect(() => { if (!focused) touchStartX.current = null; }, [focused]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: event => {
      touchStartX.current = pageTouchStartX(event);
      return false; // Observe the start without stealing taps or vertical scroll.
    },
    // Capture owns only the reserved edge. Product paging/category rails own
    // the rest of the screen, even if PanResponder's ungranted x0 is zero.
    onMoveShouldSetPanResponderCapture: (_, g) => focused && canExit && !transition && !settling
      && shouldStartEdgeBack(touchStartX.current, g.dx, g.dy, g.numberActiveTouches),
    onMoveShouldSetPanResponder: (_, g) => focused && canExit && !transition && !settling
      && shouldStartEdgeBack(touchStartX.current, g.dx, g.dy, g.numberActiveTouches),
    onPanResponderTerminationRequest: () => !dragging.current,
    onPanResponderGrant: () => { dragging.current = true; selectedOffset.stopAnimation(); },
    onPanResponderMove: (_, g) => {
      if (dragging.current) selectedOffset.setValue(Math.max(0, Math.min(width, g.dx)));
    },
    onPanResponderRelease: (_, g) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (shouldExitRetainedTab(g.dx, g.vx, width)) {
        // Finish on the native driver BEFORE changing focus. Otherwise Home's
        // focus effects/Skia idle animation restart in the middle of the exit,
        // and removing the responder can also trigger a competing snap-back.
        gestureExitFrom.current=selected;setSettling(true);
        const generation = ++gestureGeneration.current;
        const remaining = width - Math.max(0, Math.min(width, g.dx));
        const duration = Math.max(80, Math.min(220, remaining / Math.max(.8, g.vx)));
        const animation = Animated.timing(selectedOffset, {
          toValue: width, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        });
        gestureAnimation.current = animation;
        animation.start(({ finished }) => {
          if (generation !== gestureGeneration.current) return;
          gestureAnimation.current = null;
          gestureExitFrom.current=null;
          setSettling(false);
          if (!finished || selectedRef.current !== selected) return;
          completedGestureExit.current = selected;
          // Tab history only: deep links must not pop the authenticated stack.
          if (hasTabBack) navigationRef.current.goBack();
          else navigationRef.current.navigate('index');
        });
      } else {
        gestureExitFrom.current=null;
        setSettling(true);
        Animated.timing(selectedOffset, { toValue: 0, duration: 180, useNativeDriver: true })
          .start(() => setSettling(false));
      }
    },
    onPanResponderTerminate: () => {
      // A released/committed gesture no longer owns the responder. Never start
      // a reverse animation because React removes its handlers during a commit.
      if (!dragging.current) return;
      dragging.current = false;
      setSettling(true);
      Animated.timing(selectedOffset, { toValue: 0, duration: 180, useNativeDriver: true })
        .start(() => setSettling(false));
    },
  }), [focused, canExit, hasTabBack, transition, settling, selected, selectedOffset, width]);

  // Hit testing follows the native moving cover, not the JS completion
  // callback. During a close the outgoing host consumes covered taps without
  // forwarding them to its children. Once it is offscreen the already-enabled
  // destination works immediately, even if JS hasn't received transitionEnd.
  const destination = gestureDestination ?? selected;
  const closingCover=transition?.direction==='close'?transition.from:gestureDestination?selected:null;
  const destinationInteractive = focused && (!transition || transition.direction === 'close');
  const footerInteractive = destinationInteractive && (destination === home || state.routes.find(route=>route.key===destination)?.name === 'quests');
  return <NavigationContent><View style={styles.root}>
    {state.routes.map(route => {
      if (!mounted.current.has(route.key)) return null;
      const level = layers.indexOf(route.key);
      const visible = level !== -1;
      const top = route.key === selected && !transition;
      const outgoing = transition?.direction === 'close' && route.key === transition.from
        || !!gestureDestination && route.key === selected;
      const offset = offsets.current.get(route.key)!;
      const withFooter = route.name === 'index' || route.name === 'quests';
      return <AnimatedTabScene key={route.key} collapsable={false}
        onLayout={() => { painted.current.add(route.key); }}
        {...(top && canExit ? pan.panHandlers : {})}
        pointerEvents={outgoing && focused ? 'box-only' : route.key === destination && destinationInteractive && (!settling||!!gestureDestination) ? 'auto' : 'none'}
        accessibilityElementsHidden={!top} importantForAccessibility={top ? 'auto' : 'no-hide-descendants'}
        style={[styles.scene, { opacity: visible ? 1 : 0, zIndex: level * 2,
          bottom: withFooter ? footerHeight : 0, transform: [{ translateX: offset }] }]}
        renderScene={descriptors[route.key].render}/>;
    })}
    {/* Home's real footer remains beneath full-screen rooms. Its geometry never
        changes on tab selection, so Home cannot resize/repaint mid-transition. */}
    <View pointerEvents={footerInteractive ? 'auto' : 'none'} accessibilityElementsHidden={!footerInteractive}
      importantForAccessibility={footerInteractive ? 'auto' : 'no-hide-descendants'}
      style={[styles.footer, { height: footerHeight }]}>
      <BottomTabBar state={state} navigation={navigation} descriptors={descriptors} insets={insets} retainedHome />
    </View>
    {/* Keep FULL-screen accidental-touch protection throughout the exit. Its
        hit box moves offscreen at the native endpoint, not after a JS callback
        or timer. Even newly exposed portions cannot receive an early tap. */}
    {closingCover&&<AnimatedTabScene key={'exit-shield:'+closingCover} collapsable={false}
      pointerEvents="box-only" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.scene,{zIndex:100,transform:[{translateX:exitShields.current.get(closingCover)!.offset}]}]}
      renderScene={emptyScene}/>}
  </View></NavigationContent>;
}

const Navigator = createNavigatorFactory(RetainedTabsNavigator)().Navigator;
export const RetainedTabs = withLayoutContext<BottomTabNavigationOptions, typeof Navigator,
  TabNavigationState<ParamListBase>, BottomTabNavigationEventMap>(Navigator);
const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  scene: { ...StyleSheet.absoluteFillObject },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1 },
});
