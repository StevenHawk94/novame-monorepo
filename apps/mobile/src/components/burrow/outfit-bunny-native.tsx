import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Canvas, Group, ImageShader, Vertices, useCanvasRef, type SkImage } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated';
import { outfitKey, type OutfitKey } from '@/lib/burrow-outfit-assets';
import { BUNNY_MOTION, BUNNY_RIG, bunnyRenderMesh, bunnyMeshWeights, deformBunnyMesh, bunnyViewport, evaluateBunnyMotion, transformBunnyPoint, type BunnyLayer } from '@/lib/bunny-idle-motion';
import { createLatestOutfitLoader } from '@/lib/latest-outfit-loader';
import { prepareBunny } from '@/lib/prepared-bunny';
import { StaticOutfitBunny, type OutfitBunnyProps } from './outfit-bunny';
import { uiWorkPriority } from '@/lib/ui-work-priority';
import { scheduleBunnyIdle } from '@/lib/bunny-idle-scheduling';
import type {BunnyVariant} from '@/lib/bunny-identity-model';

type Suite = Record<BunnyLayer, SkImage>;
type NativeSkiaRegistry = { SkiaViewApi?: { size(id: number): { width: number; height: number } } };
const layers: BunnyLayer[] = ['tail', 'earLeft', 'earRight', 'body', 'head'];
const mesh = bunnyRenderMesh();
const meshWeights = bunnyMeshWeights(mesh.textures);
const quad = [{ x: 0, y: 0 }, { x: 1189, y: 0 }, { x: 0, y: 1323 }, { x: 1189, y: 1323 }];
const quadIndices = [0, 2, 1, 1, 2, 3];
async function decodeSuite(key: string): Promise<Suite> {
  const [outfit,variant]=key.split(':') as [OutfitKey,BunnyVariant];
  return prepareBunny(outfit,variant);
}

export function NativeOutfitBunny({ outfit, width, height, style, animated = true, active = true,variant='biscuit' }: OutfitBunnyProps) {
  const key = `${outfitKey(outfit)}:${variant}`, focused = useIsFocused();
  const [suite, setSuite] = useState<{ key: string; images: Suite } | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(true);
  const canvas = useCanvasRef();
  const [painted, setPainted] = useState(false);
  const loader = useRef<ReturnType<typeof createLatestOutfitLoader<string, Suite>> | null>(null);
  useEffect(() => {
    const resource = createLatestOutfitLoader(decodeSuite, (loadedKey, images) => setSuite({ key: loadedKey, images }),
      // Shared prewarmed refs may already belong to another retained renderer.
      // Never dispose them from an obsolete selection; bounded cache + GC owns them.
      () => {},
      error => { if (__DEV__) console.warn('[Bunny outfit load]', error); });
    loader.current = resource;
    return () => { resource.close(); loader.current = null; };
  }, []);
  useEffect(() => { loader.current?.request(key); }, [key]);
  useEffect(() => {
    if (!suite || painted || !canvas.current || width <= 0 || height <= 0) return;
    let alive = true, frame = 0, attempts = 0;
    // Render the actual five-layer scene on the native render thread before
    // removing its static underlay or starting deformation. Never swap a
    // visible Image tree for an empty first Canvas frame.
    // Measurement alone does not prove Skia's separate view registry is ready.
    // In 2.2.12 the ASYNC snapshot dereferences a null registry entry on the
    // main thread (a JS Promise catch cannot prevent that native crash). The
    // safe native size() probe returns zero until that registry entry AND its
    // render surface are ready. RN measurement can already be positive then.
    // Also avoid synchronous snapshots: a zero-sized Metal surface can abort
    // natively. Keep capture on the main thread once native readiness is proven.
    const verify = () => { frame = requestAnimationFrame(() => {
      if (!alive) return;
      canvas.current?.measure((_x, _y, w, h) => {
        if (!alive) return;
        if (w <= 0 || h <= 0) { if (++attempts < 30) verify(); return; }
        try {
          const view = canvas.current;
          const nativeSize = view ? (globalThis as NativeSkiaRegistry).SkiaViewApi?.size(view.getNativeId()) : null;
          if (!nativeSize || nativeSize.width <= 0 || nativeSize.height <= 0) {
            if (++attempts < 30) verify(); return;
          }
          void view!.makeImageSnapshotAsync().then(image => {
            image.dispose();
            if (alive) setPainted(true);
          }).catch(() => { /* Retain the identical static underlay. */ });
        } catch {
          // Keep the identical static underlay while the native view registers.
          if (++attempts < 30) verify();
        }
      });
    }); };
    verify();
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [!!suite, painted, focused, width, height, canvas]);
  useEffect(() => {
    let alive = true, changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive && !changed) setReduceMotion(value); }).catch(() => {});
    const reduced = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; setReduceMotion(value); });
    const app = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => { alive = false; reduced.remove(); app.remove(); };
  }, []);
  const seconds = useSharedValue(0), previous = useSharedValue(0);
  const staticPose = useSharedValue(true);
  const frameCallback = useCallback((frame: FrameInfo) => {
    'worklet';
    if (previous.value !== 0) seconds.value = (seconds.value + Math.min(100, frame.timestamp - previous.value) / 1000) % BUNNY_MOTION.cycleSeconds;
    previous.value = frame.timestamp;
  }, [seconds, previous]);
  const clock = useFrameCallback(frameCallback, false);
  useEffect(() => {
    staticPose.value = reduceMotion || !animated || !painted;
    previous.value = 0;
    clock.setActive(false);
    if (!(focused && foreground && active && !reduceMotion && animated && painted && !!suite)) return;
    return scheduleBunnyIdle(uiWorkPriority, running => {
      // Keep seconds/vertices untouched while paused; only reset the delta
      // origin on resume, never catch up the hidden interval or restart phase.
      if (running) previous.value = 0;
      clock.setActive(running);
    });
    // Outfit replacement must not reset seconds/phase.
  }, [focused, foreground, active, reduceMotion, animated, painted, !!suite, clock, previous, staticPose]);
  const state = useDerivedValue(() => evaluateBunnyMotion(seconds.value, staticPose.value));
  // A primitive dependency does not invalidate the body during
  // the one-second tail-only rest. Read each shared pose ONCE, not per point.
  const breath = useDerivedValue(() => state.value.breath);
  const mainVertices = useDerivedValue(() => {
    const phase = breath.value;
    return deformBunnyMesh(mesh.textures, meshWeights,
      BUNNY_MOTION.breathing.maxLiftSourcePx * phase, BUNNY_MOTION.breathing.chestExpansionRatio * phase);
  });
  const leftVertices = useDerivedValue(() => {const pose=state.value;return quad.map(point => transformBunnyPoint('earLeft', point, pose));});
  const rightVertices = useDerivedValue(() => {const pose=state.value;return quad.map(point => transformBunnyPoint('earRight', point, pose));});
  const tailVertices = useDerivedValue(() => {const pose=state.value;return quad.map(point => transformBunnyPoint('tail', point, pose));});
  const fit = useMemo(() => bunnyViewport(width, height), [width, height]);
  // Skia retains image references on its render thread. Let host-object GC
  // release replaced suites after BOTH threads stop referencing them. Do not
  // dispose a previously drawn image from a JS commit. The shared preparation
  // cache retains only two outfits, never all 95 layers (~570 MiB).
  return <View pointerEvents="none" style={[{ width, height }, style]}>
    {!painted && <StaticOutfitBunny outfit={outfit} variant={variant} width={width} height={height} />}
    {suite && <Canvas ref={canvas} style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      <Group transform={[{ translateX: fit.x }, { translateY: fit.y }, { scale: fit.scale }]}>
        {layers.map(layer => {
          const main = layer === 'body' || layer === 'head';
          const vertices = main ? mainVertices : layer === 'tail' ? tailVertices : layer === 'earLeft' ? leftVertices : rightVertices;
          return <Vertices key={layer} mode="triangles" vertices={vertices} textures={main ? mesh.textures : quad}
            indices={main ? mesh.indices : quadIndices}>
            <ImageShader image={suite.images[layer]} fit="none" tx="decal" ty="decal" />
          </Vertices>;
        })}
      </Group>
    </Canvas>}
  </View>;
}
