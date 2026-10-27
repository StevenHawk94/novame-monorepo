/** Shared palette/back control still used by the current Tap Your Day flow. */
import { StyleSheet, View } from 'react-native';
import { BurrowBackButton } from '@/components/burrow/burrow-back-button';
import { haptics } from '@/lib/haptics';

export const RC = {
  yellow: '#F9C939', yellowDrop: '#E8A33C', orange: '#F0885C', orangeDrop: '#D96B3F',
  ink: '#2B2B2B', cream: '#FFF6E8', scrim: 'rgba(0,0,0,0.5)',
};

export function ReflectTopBar({ onBack }: { onBack: () => void }) {
  return <View style={styles.topBar}>
    <BurrowBackButton onPress={() => { void haptics.pageClose(); onBack(); }} />
  </View>;
}
const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
});
