import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { roomPhotoPlaceholderSvg, type RoomPhotoPlaceholderKind } from '@/lib/room-photo-placeholder-art';

const art = { frame: roomPhotoPlaceholderSvg('frame'), doll: roomPhotoPlaceholderSvg('doll') };

/** Decorative only. The existing frame/toy owns all interaction. */
export function RoomPhotoPlaceholder({ kind }: { kind: RoomPhotoPlaceholderKind }) {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fill}>
    <SvgXml xml={art[kind]} width="100%" height="100%" pointerEvents="none" />
  </View>;
}

const styles = StyleSheet.create({ fill: { width: '100%', height: '100%', backgroundColor: '#FFF2DC' } });
