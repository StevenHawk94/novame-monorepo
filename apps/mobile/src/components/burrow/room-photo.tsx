import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { fetchRoomPhoto, saveRoomPhoto, fetchMemoryPhoto, saveMemoryPhoto, deleteMemoryPhoto, type MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { refreshBurrow } from '@/lib/burrow-store';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { persistPhotoDraft, readPhotoDraft, removePhotoDraft, type PhotoDraft } from '@/lib/burrow-photo-drafts';

type Photo = { id: string; updatedAt: string };
type MemoryTarget = { entryId: string; slot: number; photo?: Photo; canEdit: boolean };

/** Private URLs live only in focused screen memory, never in the persisted store. */
export function RoomPhoto({ photo, circle = false, memory = false }: { photo?: Photo; circle?: boolean; memory?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let alive = true; let generation = 0;
    const load = () => {
      const request = ++generation;
      setUrl(null);
      if (!photo || AppState.currentState !== 'active') return;
      void (memory ? fetchMemoryPhoto : fetchRoomPhoto)(photo.id).then(next => { if (alive && request === generation) setUrl(next); }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 100_000);
    const identity = subscribeSessionIdentity(() => { generation++; setUrl(null); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') load(); else { generation++; setUrl(null); } });
    return () => { alive = false; generation++; clearInterval(timer); identity(); app.remove(); setUrl(null); };
  }, [photo?.id, photo?.updatedAt, retry, memory]));
  return url ? <Image source={{ uri: url }} cachePolicy="none" contentFit="cover"
    onError={() => setUrl(null)} style={[styles.image, circle && { borderRadius: 200 }]} accessibilityLabel={memory ? 'Shared memory photo' : circle ? 'Doll face photo' : 'Room photo'} />
    : <Pressable accessibilityRole="button" accessibilityLabel="Reload private photo" onPress={() => setRetry(n => n + 1)} style={styles.empty}><Text>{photo ? '↻ Photo' : circle ? '🐰' : '🖼️'}</Text></Pressable>;
}

export function RoomPhotoEditor({ data, ownerId, kind, onClose, memory: memoryTarget }: {
  data: MajorUpdateBootstrap; ownerId: string; kind: 'frame' | 'doll'; onClose: () => void; memory?: MemoryTarget;
}) {
  // Editing is based on the photo version the user actually opened. A live
  // refresh must not silently retarget a draft onto another device's new photo.
  const memory = useRef(memoryTarget).current;
  const [draft, setDraft] = useState<(PhotoDraft & { uri: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const close = useRef(onClose);
  close.current = onClose;
  const epoch = useRef(sessionEpoch());
  const scope = useRef({userId:data.profile.id,partnerId:data.partner?.id??''}).current;
  const samePair = useRef(true);
  samePair.current = scope.userId===data.profile.id&&scope.partnerId===(data.partner?.id??'');
  const target = memory ? `memory:${memory.entryId}:${memory.slot}` : `${kind}:${ownerId}`;
  const current = () => alive.current && samePair.current && epoch.current === sessionEpoch();
  useEffect(()=>{if(!samePair.current)close.current();},[data.profile.id,data.partner?.id]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeSessionIdentity(() => close.current());
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(()=>{
    try{const restored=readPhotoDraft(scope,target);if(restored)setDraft({...restored,uri:`data:image/jpeg;base64,${restored.base64}`});}
    catch{setError('The saved photo draft could not be read. It has not been replaced.');}
  },[]);
  const photo = memory ? memory.photo : data.roomPhotos?.find(p => p.ownerId === ownerId && p.kind === kind);
  const canEdit = memory ? memory.canEdit : kind === 'doll' ? !data.dollChangeUsed : ownerId === data.profile.id;
  async function choose(camera: boolean) {
    if (busy || !canEdit || !current()) return;
    setBusy(true); setError(null);
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!current()) return;
      if (!permission.granted) { Alert.alert('Photo permission needed', 'Allow access in Settings to choose a room photo.'); return; }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1,1], quality: 0.9, exif: false };
      const picked = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!current() || picked.canceled) return;
      const source = picked.assets[0];
      const side = Math.min(source.width, source.height);
      // Native editor provides pan/zoom cropping. Normalize platform output and
      // encode a new bitmap (no original EXIF/location metadata is uploaded).
      const image = await manipulateAsync(source.uri, [
        { crop: { originX: Math.floor((source.width-side)/2), originY: Math.floor((source.height-side)/2), width: side, height: side } },
        { resize: { width: 512, height: 512 } },
      ], { format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (current() && image.base64) {
        const next={uri:image.uri,base64:image.base64,key:randomUUID(),expectedPhotoId:memory?.photo?.id??null,savedAt:Date.now()};
        setDraft(next);
        try{persistPhotoDraft(scope,target,next);}catch{setError('Could not keep this draft on your device. Free space or discard another photo draft before saving.');}
      }
    } catch { if (current()) setError('That photo could not be opened. Try another image.'); }
    finally { if (current()) setBusy(false); }
  }
  async function save() {
    if (!draft || busy || !current() || (!canEdit && kind!=='doll')) return;
    setBusy(true); setError(null);
    try {
      persistPhotoDraft(scope,target,draft);
      if (memory) await saveMemoryPhoto(memory.entryId, memory.slot, draft.expectedPhotoId, draft.base64, draft.key, data.profile.id,scope.partnerId);
      else await saveRoomPhoto(ownerId, kind, draft.base64, draft.key, data.profile.id,scope.partnerId);
      if (!current()) return;
      removePhotoDraft(scope,target,draft.key);
      await refreshBurrow();
      if (current()) onClose();
    } catch (failure) {
      if (!current()) return;
      const code = (failure as { body?: { error?: string } }).body?.error ?? (failure instanceof Error ? failure.message : '');
      setError(code === 'photo_conflict' || code === 'upload_expired' ? 'This photo changed or the upload expired. Close, refresh, and choose it again. Your saved memory is safe.' : code === 'daily_limit_reached' ? 'You already changed a doll today. Try again after your local midnight.' : 'Save didn’t finish. Retry uses the same request, so it won’t count twice.');
    } finally { if (current()) setBusy(false); }
  }
  async function remove() {
    if (!memory || !photo || !canEdit || busy) return;
    setBusy(true); setError(null);
    try {
      await deleteMemoryPhoto(memory.entryId, photo.id, data.profile.id);
      if (!current()) return;
      await refreshBurrow();
      if (current()) onClose();
    } catch { if (current()) setError('The photo could not be removed. Please retry.'); }
    finally { if (current()) setBusy(false); }
  }
  return <Modal transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={styles.scrim}><ScrollView style={styles.sheet} contentContainerStyle={{ padding: 22, gap: 14 }}>
      <Text style={styles.title}>{memory ? 'A photo to remember' : kind === 'doll' ? 'A familiar little face' : 'A memory on the wall'}</Text>
      <Text style={styles.copy}>{memory ? canEdit ? 'Drag and zoom to crop. Only you can change this memory. Photos are shared privately with your current partner; no AI.' : 'Your partner’s memory · view only' : kind === 'doll' ? 'Drag and zoom in the photo editor. Your face is shown in a circle. One saved change per person, per day, across both rooms.' : ownerId === data.profile.id ? 'Drag and zoom in the photo editor. Your partner can look, but only you can replace this photo.' : 'Your partner’s photo · view only'}</Text>
      <View style={[styles.preview, kind === 'doll' && { borderRadius: 120 }]}>
        {draft ? <Image source={{ uri: draft.uri }} cachePolicy="none" style={styles.image} /> : <RoomPhoto photo={photo} circle={kind === 'doll'} memory={!!memory} />}
      </View>
      {kind === 'doll' && data.dollChangeUsed && <Text style={styles.copy}>Today’s doll change is used. You can still view both rooms.</Text>}
      {error && <Text accessibilityRole="alert" style={styles.copy}>{error}</Text>}
      {canEdit && <View style={styles.row}><Button label="Photo library" disabled={busy} onPress={() => void choose(false)} /><Button label="Camera" disabled={busy} onPress={() => void choose(true)} /></View>}
      {draft && <><Text style={styles.copy}>Draft kept on this device. Review and tap Save to send; closing the app does not upload it. Signing out removes local drafts.</Text>
        <Button label={busy ? 'Saving…' : 'Save / retry photo'} disabled={busy || (!canEdit&&kind!=='doll')} onPress={() => void save()} />
        <Button label="Discard local photo draft" disabled={busy} onPress={()=>Alert.alert('Discard this local draft?','This will not undo a photo that the server already saved.',[{text:'Keep',style:'cancel'},{text:'Discard',style:'destructive',onPress:()=>{try{removePhotoDraft(scope,target,draft.key);setDraft(null);}catch{setError('Could not remove the draft. Please try again.');}}}])}/></>}
      {memory && photo && canEdit && !draft && <Button label="Delete photo" disabled={busy} onPress={() => Alert.alert('Delete this photo?', 'It will disappear from this memory for both of you. Your words stay saved.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove() }])} />}
      <Button label={draft ? 'Close · keep draft' : 'Close'} disabled={busy} onPress={onClose} />
    </ScrollView></View>
  </Modal>;
}
function Button({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: .4 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#21130CCC', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '88%', borderRadius: 28, backgroundColor: '#FFF4E1' },
  title: { fontSize: 23, fontWeight: '800', color: '#553521' }, copy: { color: '#79563E', fontSize: 14, lineHeight: 21 },
  preview: { width: 180, height: 180, alignSelf: 'center', overflow: 'hidden', borderRadius: 14, backgroundColor: '#E8C8A0' },
  image: { width: '100%', height: '100%' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, row: { flexDirection: 'row', gap: 12 },
  button: { flexGrow: 1, borderRadius: 16, backgroundColor: '#2F8D72', padding: 14, alignItems: 'center' }, buttonText: { color: '#FFF4E1', fontWeight: '700' },
});
