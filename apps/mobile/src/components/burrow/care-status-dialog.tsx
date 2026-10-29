import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { careCooldownMessage } from '@/lib/burrow-care-cooldown';

/** A calm, centered room message for care that is already complete. */
export function CareStatusDialog({ kind, onClose, partnerName }: { kind: 'food' | 'water'; onClose: () => void; partnerName?:string }) {
  return <Modal transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
    <View style={s.overlay}>
      <View accessibilityViewIsModal style={s.card}>
        <Text accessibilityRole="header" style={s.message}>{careCooldownMessage(kind,partnerName)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="OK" onPress={onClose} style={s.button}>
          <Text style={s.buttonText}>OK</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 26 },
  card: { width: '100%', maxWidth: 350, paddingHorizontal: 28, paddingVertical: 32, borderRadius: 28,
    backgroundColor: '#FFF8EE', alignItems: 'center', gap: 26 },
  message: { color: '#17100B', fontSize: 20, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  button: { minWidth: 180, minHeight: 50, paddingHorizontal: 32, borderRadius: 30,
    backgroundColor: '#662F19', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFF8EE', fontSize: 20, fontWeight: '700' },
});
