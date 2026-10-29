import { forwardRef, type ElementRef } from 'react';
import { Alert as NativeAlert, Pressable as NativePressable, TouchableOpacity as NativeTouchableOpacity, Switch as NativeSwitch,
  type AlertButton, type PressableProps, type TouchableOpacityProps, type SwitchProps, type View } from 'react-native';
import { withSoftPress } from '@/lib/haptics';

/** Same native host, ref, press state, hitSlop and layout. No extra View/recognizer.
 * An accepted activation is acknowledged even for accessibility/keyboard clicks;
 * a cancelled scroll and a disabled control do not produce button feedback. */
export const Pressable = forwardRef<View, PressableProps>(function FeedbackPressable(props, ref) {
  const {onPress,onPressIn,onLongPress,onAccessibilityTap,onAccessibilityAction,disabled,accessibilityState} = props;
  const blocked = disabled === true || accessibilityState?.disabled === true;
  return <NativePressable {...props} ref={ref}
    onPress={onPress ? event => { if (!blocked) return withSoftPress(() => onPress(event), event); } : undefined}
    onPressIn={onPressIn ? event => { if (!blocked) return onPress ? onPressIn(event) : withSoftPress(() => onPressIn(event), event); } : undefined}
    onLongPress={onLongPress ? event => { if (!blocked) return withSoftPress(() => onLongPress(event), event); } : undefined}
    onAccessibilityTap={onAccessibilityTap ? () => { if (!blocked) return withSoftPress(onAccessibilityTap); } : undefined}
    onAccessibilityAction={onAccessibilityAction ? event => { if (!blocked) return event.nativeEvent.actionName === 'activate'
      ? withSoftPress(() => onAccessibilityAction(event), event) : onAccessibilityAction(event); } : undefined}/>;
});

export const TouchableOpacity = forwardRef<ElementRef<typeof NativeTouchableOpacity>, TouchableOpacityProps>(function FeedbackOpacity(props, ref) {
  const {onPress,disabled,accessibilityState} = props;
  return <NativeTouchableOpacity {...props} ref={ref} onPress={onPress ? event => {
    if (!disabled && !accessibilityState?.disabled) return withSoftPress(() => onPress(event), event);
  } : undefined}/>;
});

export const Switch = forwardRef<NativeSwitch, SwitchProps>(function FeedbackSwitch(props, ref) {
  const {onValueChange,disabled} = props;
  return <NativeSwitch {...props} ref={ref} onValueChange={onValueChange ? value => {
    if (!disabled) return withSoftPress(() => onValueChange(value));
  } : undefined}/>;
});

/** Keep native destructive/permission alerts native. Only decorate their own
 * button callbacks; presenting a dialog is not itself another activation. */
export const Alert: typeof NativeAlert = {
  ...NativeAlert,
  prompt: (...args: Parameters<typeof NativeAlert.prompt>) => NativeAlert.prompt(...args),
  alert(title, message, buttons, options) {
    const actions: AlertButton[] = buttons?.length ? buttons : [{text: 'OK'}];
    NativeAlert.alert(title, message, actions.map(button => ({
      ...button, onPress: () => withSoftPress(() => button.onPress?.()),
    })), options);
  },
};
