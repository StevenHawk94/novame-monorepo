import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Canvas, Fill, ImageShader, Shader, Skia, useCanvasRef, useImage, type SkImage } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import type { BurrowArtAsset } from '@/lib/burrow-art-assets';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { dollFaceBounds, dollFaceRect } from '@/lib/burrow-doll-face';
import { haptics } from '@/lib/haptics';
import { subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { clampToyPull, TOY_TEXTURE_PADDING, TOY_WARP_SKSL } from '@/lib/burrow-toy-warp';
import { RoomPhoto, useRoomPhotoUri } from './room-photo';
import { FloatingHeart, InteractiveDoll, type DollAction, type HeartParticle } from './interactive-doll';

type DollPhoto = MajorUpdateBootstrap['roomPhotos'][number] | undefined;
type Texture = { key: string; image: SkImage };
type CircleSpec = { x: number; y: number; radius: number };

// The original costume is 600×600. Extra transparent pixels must exist in the
// *source texture*, not just the View, or pulled silhouettes get flat cut edges.
const TEXTURE_PADDING = TOY_TEXTURE_PADDING;
const textureCache = new Map<string, SkImage>();
const verifiedCanvasKeys = new Set<string>();
subscribeSessionIdentity(() => { textureCache.clear(); verifiedCanvasKeys.clear(); });

const warpEffect = Skia.RuntimeEffect.Make(TOY_WARP_SKSL);

function composeTexture(costume: SkImage, face: SkImage | null, asset: BurrowArtAsset): SkImage | null {
  try {
    const width = asset.width + TEXTURE_PADDING * 2;
    const height = asset.height + TEXTURE_PADDING * 2;
    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    if (face) {
      const [left, top, right, bottom] = dollFaceBounds(asset);
      const boxWidth = right - left;
      const boxHeight = bottom - top;
      const aspect = boxWidth / boxHeight;
      const sourceWidth = Math.min(face.width(), face.height() * aspect);
      const sourceHeight = sourceWidth / aspect;
      const crop = { x: (face.width() - sourceWidth) / 2, y: (face.height() - sourceHeight) / 2,
        width: sourceWidth, height: sourceHeight };
      const destination = { x: TEXTURE_PADDING + left, y: TEXTURE_PADDING + top, width: boxWidth, height: boxHeight };
      canvas.drawImageRect(face, crop, destination, Skia.Paint());
    }
    // Photo and costume are baked onto ONE offscreen surface. The shader never
    // receives separate face/art layers, so dragging the head cannot misalign it.
    canvas.drawImage(costume, TEXTURE_PADDING, TEXTURE_PADDING);
    surface.flush();
    // MakeOffscreen may yield a GPU texture owned by the JS-thread context.
    // The Canvas renders on another thread, so hand it a non-texture image.
    return surface.makeImageSnapshot().makeNonTextureImage();
  } catch {
    // Keep the static Toy usable if this native device cannot allocate a GPU
    // surface; diagnose animation quality on a physical device, not simulator.
    return null;
  }
}

export function LocalizedToy({ asset, photo, size, artStyle, action, showInfluence, onInteract }: {
  asset: BurrowArtAsset;
  photo?: DollPhoto;
  size: number;
  artStyle: StyleProp<ViewStyle>;
  action?: DollAction;
  showInfluence: boolean;
  onInteract: () => void;
}) {
  const photoUri = useRoomPhotoUri(photo);
  const costume = useImage(typeof asset.source === 'number' ? asset.source : null);
  const face = useImage(photoUri);
  const key = `${String(asset.source)}:${photo?.id ?? 'empty'}:${photo?.updatedAt ?? ''}`;
  const [texture, setTexture] = useState<Texture | null>(() => {
    const cached = textureCache.get(key);
    return cached ? { key, image: cached } : null;
  });
  const readyTexture = texture?.key === key ? texture.image : textureCache.get(key) ?? null;
  const canvasRef = useCanvasRef();
  const [canvasState, setCanvasState] = useState<{key:string; status:'pending'|'verified'|'unavailable'}>(() => ({
    key, status: verifiedCanvasKeys.has(key) ? 'verified' : 'pending',
  }));
  const warpVerified = canvasState.key === key && canvasState.status === 'verified';
  const warpUnavailable = canvasState.key === key && canvasState.status === 'unavailable';
  const flattened = StyleSheet.flatten(artStyle);
  const artLeft = typeof flattened?.left === 'number' ? flattened.left : 0;
  const artTop = typeof flattened?.top === 'number' ? flattened.top : 0;
  const artWidth = typeof flattened?.width === 'number' ? flattened.width : size;
  const scale = artWidth / asset.width;
  const canvasLeft = artLeft - TEXTURE_PADDING * scale;
  const canvasTop = artTop - TEXTURE_PADDING * scale;
  const canvasWidth = (asset.width + TEXTURE_PADDING * 2) * scale;
  const canvasHeight = (asset.height + TEXTURE_PADDING * 2) * scale;
  const faceBounds = dollFaceBounds(asset);
  const headWidth = (faceBounds[2] - faceBounds[0]) * scale;
  const defaultCircle = {
    x: (TEXTURE_PADDING + (faceBounds[0] + faceBounds[2]) / 2) * scale,
    y: (TEXTURE_PADDING + (faceBounds[1] + faceBounds[3]) / 2) * scale,
    radius: headWidth * .55,
  };
  const [circle, setCircle] = useState<CircleSpec>(defaultCircle);
  const [hearts, setHearts] = useState<HeartParticle[]>([]);
  const heartId = useRef(0);
  const touched = useRef(false);
  const centerX = useSharedValue(defaultCircle.x);
  const centerY = useSharedValue(defaultCircle.y);
  const radius = useSharedValue(defaultCircle.radius);
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const actionKind = useSharedValue(0);
  const impact = useSharedValue(0);
  const uniforms = useDerivedValue(() => ({
    center: [centerX.value, centerY.value],
    pull: [pullX.value, pullY.value],
    radius: radius.value,
    action: actionKind.value,
    impact: impact.value,
    bodyCenter: [(TEXTURE_PADDING + asset.width / 2) * scale, (TEXTURE_PADDING + asset.height * .67) * scale],
  }));

  useEffect(() => {
    const cached = textureCache.get(key);
    if (cached) { setTexture({ key, image: cached }); return; }
    if (!costume || (photo && !face)) return;
    const composite = composeTexture(costume, face, asset);
    if (!composite) {
      setCanvasState({ key, status: 'unavailable' });
      return;
    }
    textureCache.set(key, composite);
    if (textureCache.size > 8) textureCache.delete(textureCache.keys().next().value!);
    setTexture({ key, image: composite });
  }, [key, costume, face, asset, photo]);

  useEffect(() => {
    if (!warpEffect) { setCanvasState({key,status:'unavailable'}); return; }
    if (!readyTexture) return;
    if (verifiedCanvasKeys.has(key)) { setCanvasState({key,status:'verified'}); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const verify = async (attempt: number) => {
      try {
        // A compiled shader is not proof that this device actually drew it.
        // Keep the normal costume visible until a rendered body pixel exists.
        const x = Math.round((TEXTURE_PADDING + asset.width * .5) * scale);
        const y = Math.round((TEXTURE_PADDING + asset.height * .7) * scale);
        const snapshot = await canvasRef.current?.makeImageSnapshotAsync({x:x-6,y:y-6,width:12,height:12});
        const pixels = snapshot?.readPixels();
        if (!live) return;
        if (pixels && Array.from({length:Math.floor(pixels.length/4)},(_,index)=>pixels[index*4+3]).some(alpha=>alpha>0)) {
          verifiedCanvasKeys.add(key);
          setCanvasState({key,status:'verified'});
          return;
        }
      } catch { /* The static costume remains visible on unsupported GPUs. */ }
      if (!live) return;
      if (attempt < 3) timer = setTimeout(() => void verify(attempt + 1), 180);
      else setCanvasState({key,status:'unavailable'});
    };
    timer = setTimeout(() => void verify(1), 120);
    return () => { live = false; clearTimeout(timer); };
  }, [key, readyTexture, warpEffect, asset, scale, canvasRef]);

  const emitHearts = useCallback((count: number) => {
    setHearts(previous => [...previous.slice(-16), ...Array.from({ length: count }, (_, index) => ({
      id: heartId.current++, drift: (index - count / 2) * size * .045,
      rise: size * (.25 + index * .04), delay: index * 45,
      size: Math.max(17, size * .052), originX: size * .5, originY: size * .27,
    }))]);
  }, [size]);
  const removeHeart = useCallback((id: number) => setHearts(previous => previous.filter(heart => heart.id !== id)), []);
  useEffect(() => {
    if (!action?.token) return;
    actionKind.value = action.kind === 'squeeze' ? 1 : 2;
    impact.value = 1;
    impact.value = withTiming(0, { duration: action.kind === 'squeeze' ? 500 : 280 });
    emitHearts(action.kind === 'squeeze' ? 5 : 7);
    void (action.kind === 'squeeze' ? haptics.light() : haptics.medium());
  }, [action?.token]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      touched.current = true;
      const x = event.nativeEvent.locationX - canvasLeft;
      const y = event.nativeEvent.locationY - canvasTop;
      const assetY = y / scale - TEXTURE_PADDING;
      // A face touch gets a head-sized influence, a foot touch gets a smaller
      // circle. The body and opposite foot remain outside that circle.
      const nextRadius = assetY > 470 ? 75 * scale : assetY < 360 ? headWidth * .55 : 95 * scale;
      centerX.value = x; centerY.value = y; radius.value = nextRadius;
      pullX.value = 0; pullY.value = 0; actionKind.value = 0;
      setCircle({ x, y, radius: nextRadius });
    },
    onPanResponderMove: (_event, gesture) => {
      // Safety valve: no more than 15% of head width. This is a partner's
      // photo; deliberately extreme face distortion stops feeling affectionate.
      const clamped = clampToyPull(gesture.dx, gesture.dy, headWidth);
      pullX.value = clamped.x;
      pullY.value = clamped.y;
    },
    onPanResponderRelease: () => {
      pullX.value = withSpring(0, { damping: 15, stiffness: 180 });
      pullY.value = withSpring(0, { damping: 15, stiffness: 180 });
      if (touched.current) { emitHearts(5); void haptics.light(); onInteract(); }
      touched.current = false;
    },
    onPanResponderTerminate: () => {
      touched.current = false;
      pullX.value = withSpring(0); pullY.value = withSpring(0);
    },
  }), [asset, canvasLeft, canvasTop, headWidth, onInteract, scale, emitHearts]);

  if (warpUnavailable) return <InteractiveDoll asset={asset} photo={photo} style={{width:size,height:size,alignSelf:'center'}}
    artStyle={artStyle} action={action} onInteract={onInteract}/>;

  return <View style={{ width: size, height: size, alignSelf: 'center', overflow: 'visible' }} {...responder.panHandlers}>
    {readyTexture && warpEffect ? <View pointerEvents="none" style={{ position: 'absolute', left: canvasLeft, top: canvasTop,
      width: canvasWidth, height: canvasHeight }}>
      <Canvas ref={canvasRef} style={{ width: canvasWidth, height: canvasHeight }}>
        <Fill><Shader source={warpEffect} uniforms={uniforms}>
          <ImageShader image={readyTexture} fit="fill" rect={{ x: 0, y: 0, width: canvasWidth, height: canvasHeight }} />
        </Shader></Fill>
      </Canvas>
      {showInfluence && <Svg pointerEvents="none" width={canvasWidth} height={canvasHeight} style={StyleSheet.absoluteFillObject}>
        <Circle cx={circle.x} cy={circle.y} r={circle.radius} fill="rgba(255,255,255,0.08)"
          stroke="#F16A82" strokeWidth={1.5} strokeDasharray="6 5" />
      </Svg>}
    </View> : null}
    {!warpVerified && <View pointerEvents="none" style={artStyle}>
      <View style={[styles.photo, dollFaceRect(asset)]}>{photo ? <RoomPhoto photo={photo} /> : <View style={styles.emptyFace} />}</View>
      <ExpoImage source={asset.source} contentFit="fill" style={styles.fill} />
    </View>}
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {hearts.map(heart => <FloatingHeart key={heart.id} particle={heart} onDone={removeHeart} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  photo: { position: 'absolute', overflow: 'hidden' },
  emptyFace: { flex: 1, backgroundColor: '#FFF9F0' },
});
