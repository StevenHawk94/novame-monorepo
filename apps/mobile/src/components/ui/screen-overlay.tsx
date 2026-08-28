import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Modal, Platform, StyleSheet, View, type ModalProps } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { registerOverlay } from '@/lib/overlay-presence';

/**
 * iOS window overlay: no competing UIViewController presentations and no
 * invisible native dismissal animation after the contents have disappeared.
 * Android uses a Dialog without an asynchronous window exit animation.
 * Keep intentional nested editors/dialogs possible; automatic prompts observe
 * the registry and wait until every visible surface has actually unmounted.
 */
export function ScreenOverlay({ visible = true, children, onShow, onRequestClose,
  statusBarTranslucent, navigationBarTranslucent }: Omit<ModalProps, 'onShow'> & { children: ReactNode; onShow?: () => void }) {
  const owner = useRef({}).current;
  const show = useRef(onShow);
  const shown = useRef(false);
  show.current = onShow;
  useLayoutEffect(() => {
    shown.current = false;
    if (!visible) return;
    const release = registerOverlay(owner);
    return release;
  }, [visible, owner]);
  const didShow = () => {
    if (shown.current) return;
    shown.current = true;
    show.current?.();
  };
  if (!visible) return null;
  const content = <View style={StyleSheet.absoluteFill} accessibilityViewIsModal
    onLayout={Platform.OS === 'ios' ? didShow : undefined}>{children}</View>;
  if (Platform.OS === 'ios') return <FullWindowOverlay>{content}</FullWindowOverlay>;
  return <Modal visible transparent animationType="none" onRequestClose={onRequestClose}
    onShow={didShow} statusBarTranslucent={statusBarTranslucent}
    navigationBarTranslucent={navigationBarTranslucent}>{content}</Modal>;
}
