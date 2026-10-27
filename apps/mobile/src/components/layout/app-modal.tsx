import {Modal as NativeModal,View,StyleSheet,type ModalProps} from 'react-native';
import {AppWindowLayer} from './app-window-layer';
import {APP_CANVAS_BACKGROUND} from '@/lib/app-viewport-layout';

/** Keep native presentation/dismissal/permission sequencing unchanged. */
export function AppModal({children,...props}:ModalProps) {
  return <NativeModal {...props}><View style={[StyleSheet.absoluteFill,
    !props.transparent&&{backgroundColor:APP_CANVAS_BACKGROUND}]}>
    <AppWindowLayer>{children}</AppWindowLayer>
  </View></NativeModal>;
}
