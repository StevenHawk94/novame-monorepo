import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { saveLocalProfileAvatar } from '@/lib/profile-avatar-local';
import { sessionEpoch, sessionUserId } from '@/lib/session-lifecycle';
import { appAlert } from '@/components/ui/app-dialog';
export function ProfileAvatarEditor({ userId, previousUrl, onClose }: {
    userId: string;
    previousUrl: string;
    onClose: () => void;
}) {
    const insets = useSafeAreaInsets(), [visible, setVisible] = useState(true), [busy, setBusy] = useState(false);
    const source = useRef<'camera' | 'library' | null>(null), lock = useRef(false), live = useRef(true), epoch = useRef(sessionEpoch());
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    const current = () => live.current && epoch.current === sessionEpoch() && userId === sessionUserId();
    async function launch() {
        const selected = source.current;
        if (!selected || lock.current || !current())
            return;
        source.current = null;
        lock.current = true;
        setBusy(true);
        try {
            if (selected === 'camera') {
                const permission = await ImagePicker.requestCameraPermissionsAsync();
                if (!current())
                    return;
                if (!permission.granted) {
                    appAlert('Camera permission needed', 'Allow camera access in Settings to take your profile photo.', [
                        { text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
                    ]);
                    return;
                }
            }
            const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: .9, exif: false,
                cameraType: ImagePicker.CameraType.front };
            const result = selected === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
            if (!current() || result.canceled)
                return;
            const image = result.assets[0];
            if (!image?.uri)
                throw Error('invalid_photo');
            const processed = await manipulateAsync(image.uri, [{ resize: { width: 512, height: 512 } }], { format: SaveFormat.JPEG, compress: .8 });
            if (!current())
                return;
            await saveLocalProfileAvatar(userId, processed.uri, previousUrl);
        }
        catch {
            if (current())
                appAlert('Could not save photo', 'Your previous avatar has not been replaced. Please try again.');
        }
        finally {
            lock.current = false;
            if (current()) {
                setBusy(false);
                onClose();
            }
        }
    }
    function choose(next: 'camera' | 'library') {
        if (source.current || lock.current)
            return;
        source.current = next;
        setVisible(false);
        // iOS must fully dismiss its native sheet before presenting the system
        // camera/picker. Android dismisses this non-animated sheet on the next frame.
        if (Platform.OS !== 'ios')
            requestAnimationFrame(() => void launch());
    }
    return <>
    <Modal transparent visible={visible} animationType="none" onDismiss={() => void launch()} onRequestClose={onClose}>
      <View style={s.scrim}><Pressable accessibilityLabel="Cancel photo selection" style={StyleSheet.absoluteFillObject} onPress={onClose}/>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
          {(['camera', 'library'] as const).map((kind, index) => <Pressable key={kind} accessibilityRole="button" onPress={() => choose(kind)} style={[s.row, index === 0 && s.divider]}>
            <MaterialCommunityIcons name={kind === 'camera' ? 'camera-outline' : 'image-outline'} size={26} color="#57351F"/>
            <Text style={s.text}>{kind === 'camera' ? 'Take a photo' : 'Choose from library'}</Text>
          </Pressable>)}
        </View>
      </View>
    </Modal>
    {busy && <View pointerEvents="none" style={s.status}><ActivityIndicator color="#8B4B2C"/></View>}
  </>;
}
const s = StyleSheet.create({ scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#21120B80' }, sheet: { backgroundColor: '#FFF9F0', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22 },
    row: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 18 }, divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5D6C5' }, text: { fontSize: 17, color: '#57351F' }, status: { position: 'absolute', bottom: 24, alignSelf: 'center' } });
