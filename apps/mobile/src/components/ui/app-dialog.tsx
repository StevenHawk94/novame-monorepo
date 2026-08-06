import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Themed replacement for the system Alert.alert (design 2026-08-05): white
 * rounded card on a dim overlay, dark-brown pill = confirm, light-tan pill =
 * cancel/decline. Same imperative call shape as Alert.alert, so call sites
 * swap 1:1:
 *
 *   appAlert('Unlock Aloha Beach?', 'This will spend 300 clovers…', [
 *     { text: 'Cancel', style: 'cancel' },
 *     { text: 'Confirm', onPress: buy },
 *   ]);
 *
 * <AppDialogHost /> must be mounted once at the root. A call made while a
 * dialog is open replaces it (matches how our flows use Alert today).
 */

export interface AppAlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface DialogState {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

let present: ((d: DialogState) => void) | null = null;
let pendingWhileUnmounted: DialogState | null = null;

export function appAlert(title: string, message?: string, buttons?: AppAlertButton[]): void {
  const dialog: DialogState = {
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
  };
  if (present) present(dialog);
  else pendingWhileUnmounted = dialog;
}

export function AppDialogHost() {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    present = setDialog;
    if (pendingWhileUnmounted) {
      setDialog(pendingWhileUnmounted);
      pendingWhileUnmounted = null;
    }
    return () => {
      present = null;
    };
  }, []);

  if (!dialog) return null;

  const isCancel = (b: AppAlertButton) => b.style === 'cancel';
  // Row layout for 1–2 buttons (cancel on the left, per the mock); a stack
  // when a flow offers three or more choices.
  const row = dialog.buttons.length <= 2;
  const ordered = row ? [...dialog.buttons].sort((a, b) => Number(isCancel(b)) - Number(isCancel(a))) : dialog.buttons;

  const press = (b: AppAlertButton) => {
    setDialog(null);
    b.onPress?.();
  };

  const cancelBtn = dialog.buttons.find(isCancel);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => press(cancelBtn ?? dialog.buttons[0])}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>{dialog.title}</Text>
          {!!dialog.message && <Text style={s.message}>{dialog.message}</Text>}
          <View style={[s.buttons, row ? s.buttonsRow : s.buttonsStack]}>
            {ordered.map((b, i) => (
              <Pressable
                key={`${b.text}-${i}`}
                onPress={() => press(b)}
                style={({ pressed }) => [
                  s.btn,
                  isCancel(b) ? s.btnCancel : s.btnConfirm,
                  row && s.btnRowItem,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[s.btnText, isCancel(b) ? s.btnTextCancel : s.btnTextConfirm]} numberOfLines={1}>
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(42,33,24,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FDFBF7',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 26,
    shadowColor: '#3A2A1A',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#2B2B2B',
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Inter_500Medium',
    color: '#4A4A4A',
    textAlign: 'center',
    marginTop: 10,
  },
  buttons: { marginTop: 24 },
  buttonsRow: { flexDirection: 'row', gap: 14 },
  buttonsStack: { gap: 12 },
  btn: {
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnRowItem: { flex: 1 },
  btnConfirm: {
    backgroundColor: '#4A2F1B',
    shadowColor: '#3A2A1A',
    shadowOpacity: 0.3,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
  },
  btnCancel: {
    backgroundColor: '#F0D2A0',
    shadowColor: '#C9A468',
    shadowOpacity: 0.5,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
  },
  btnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  btnTextConfirm: { color: '#FFFFFF' },
  btnTextCancel: { color: '#6B4A2F' },
});
