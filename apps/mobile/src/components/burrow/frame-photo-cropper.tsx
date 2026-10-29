import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { Image } from './burrow-image';
import { FRAME_PHOTO_ASPECT, positionedFrameCrop, type PhotoCrop } from '@/lib/room-photo-crop';

type Asset = { uri: string; width: number; height: number };

export function FramePhotoCropper({ asset, onCancel, onConfirm }: {
  asset: Asset;
  onCancel: () => void;
  onConfirm: (crop: PhotoCrop) => Promise<void>;
}) {
  const window = useWindowDimensions();
  const previewWidth = Math.max(160, Math.min(window.width - 64, (window.height - 300) * FRAME_PHOTO_ASPECT, 330));
  const previewHeight = previewWidth / FRAME_PHOTO_ASPECT;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const confirming = useRef(false);
  const [error, setError] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const geometry = positionedFrameCrop(asset.width, asset.height, previewWidth, zoom, offset.x, offset.y);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStart.current = { x: geometryRef.current.offsetX, y: geometryRef.current.offsetY }; },
    onPanResponderMove: (_event, gesture) => {
      setOffset({ x: dragStart.current.x + gesture.dx, y: dragStart.current.y + gesture.dy });
    },
    onPanResponderRelease: () => {
      setOffset(current => {
        const next = positionedFrameCrop(asset.width, asset.height, previewWidth, zoom, current.x, current.y);
        return { x: next.offsetX, y: next.offsetY };
      });
    },
  }), [asset.width, asset.height, previewWidth, zoom]);
  async function confirm() {
    if (confirming.current) return;
    confirming.current = true;
    setBusy(true); setError(false);
    try { await onConfirm(geometry.crop); }
    catch { confirming.current = false; setError(true); setBusy(false); }
  }
  return <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => { if (!busy) onCancel(); }}>
    <View style={styles.scrim}>
      <View style={styles.sheet}>
        <Text style={styles.title}>Crop for your frame</Text>
        <Text style={styles.hint}>Drag to position your photo.</Text>
        <View style={[styles.viewport, { width: previewWidth, height: previewHeight }]} {...responder.panHandlers}>
          <Image source={{ uri: asset.uri }} contentFit="fill" style={{ position: 'absolute', width: asset.width * geometry.scale,
            height: asset.height * geometry.scale,
            left: (previewWidth - asset.width * geometry.scale) / 2 + geometry.offsetX,
            top: (previewHeight - asset.height * geometry.scale) / 2 + geometry.offsetY }} />
        </View>
        <View style={styles.zoomRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => setZoom(value => Math.max(1, Math.round((value - .2) * 10) / 10))} style={styles.zoomButton}><Text style={styles.zoomText}>−</Text></Pressable>
          <Text style={styles.zoomLabel}>Zoom {Math.round(zoom * 100)}%</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => setZoom(value => Math.min(3, Math.round((value + .2) * 10) / 10))} style={styles.zoomButton}><Text style={styles.zoomText}>+</Text></Pressable>
        </View>
        {error && <Text accessibilityRole="alert" style={styles.error}>Photo could not be saved. Please try again.</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{disabled:busy,busy}} disabled={busy} onPress={() => void confirm()} style={[styles.save, busy && styles.disabled]}><Text style={styles.saveText}>Use This Crop</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#1D100ABB', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 430, backgroundColor: '#FFFCF7', borderRadius: 28, padding: 22, alignItems: 'center', gap: 14 },
  title: { color: '#4C2B22', fontSize: 25, fontWeight: '800' },
  hint: { color: '#79563E', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  // Inset borders would change the effective crop area and hide edge pixels.
  viewport: { overflow: 'hidden', backgroundColor: '#E8C8A0' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  zoomButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F1EDE7', alignItems: 'center', justifyContent: 'center' },
  zoomText: { fontSize: 28, lineHeight: 32, color: '#4C2B22' },
  zoomLabel: { color: '#4C2B22', fontSize: 15, minWidth: 80, textAlign: 'center' },
  error: { color: '#BE4434', fontSize: 14 },
  save: { width: '100%', minHeight: 56, borderRadius: 30, backgroundColor: '#4C2B22', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: .5 },
  saveText: { color: '#FFF9F2', fontSize: 17, fontWeight: '800' },
  cancel: { padding: 8 }, cancelText: { color: '#D76444', fontSize: 16, fontWeight: '700' },
});
