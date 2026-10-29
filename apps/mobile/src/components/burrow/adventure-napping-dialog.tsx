import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import {AppModal as Modal} from '@/components/layout/app-modal';
import { BURROW_DAILY_ENTRY_ART } from '@/lib/burrow-ui-assets';
import { Image } from './burrow-image';

/** Home remains mounted beneath a single, gently fading status dialog. */
export function AdventureNappingDialog({ onClose }: { onClose: () => void }) {
  return <Modal transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
    <View style={s.scrim}>
      <View style={s.card} accessibilityViewIsModal>
        <ScrollView bounces={false} contentContainerStyle={s.content}>
          <Image source={BURROW_DAILY_ENTRY_ART.napping} contentFit="contain" style={s.icon}/>
          <Text accessibilityRole="header" style={s.title}>Your bunny is officially napping</Text>
          <Text style={s.copy}>New adventure drops tomorrow!</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="OK" onPress={onClose} style={({pressed})=>[s.button,pressed&&s.pressed]}>
            <Text style={s.buttonText}>OK</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#00000099', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 400, maxHeight: '85%', backgroundColor: '#FFF8EE', borderRadius: 28, overflow: 'hidden',
    shadowColor: '#512A17', shadowOffset: {width:0,height:4}, shadowOpacity:.25, shadowRadius:0, elevation:5 },
  content: { paddingHorizontal: 24, paddingVertical: 28, alignItems: 'center', gap: 18 },
  icon: { width: 80, height: 62 },
  title: { color: '#17120F', fontSize: 22, lineHeight: 29, fontWeight: '800', textAlign: 'center' },
  copy: { color: '#17120F', fontSize: 18, lineHeight: 25, textAlign: 'center' },
  button: { width: '60%', minWidth: 160, minHeight: 50, borderRadius: 28, marginTop: 6,
    backgroundColor: '#673019', alignItems: 'center', justifyContent: 'center', padding: 12 },
  buttonText: { color: '#FFF8EE', fontSize: 20, lineHeight: 26, fontWeight: '700' },
  pressed: { opacity: .8 },
});
