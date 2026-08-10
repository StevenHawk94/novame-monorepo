import { Keyboard, TouchableWithoutFeedback, View, type ViewProps } from 'react-native';

/**
 * Screen/overlay root that dismisses the keyboard when a tap lands on
 * non-interactive space. Buttons, inputs and ScrollViews inside still
 * receive their touches first — only unclaimed taps trigger the dismiss,
 * so switching between inputs never flickers the keyboard.
 *
 * Use as the outermost container of any screen with a TextInput (drop-in
 * replacement for its root <View>): without it, a screen whose buttons sit
 * under the keyboard can trap the user (the screenshot bug: MemoryEditSheet's
 * Done button hidden behind the keyboard with no way to close it).
 */
export function KeyboardDismissView({ children, ...rest }: ViewProps) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View {...rest}>{children}</View>
    </TouchableWithoutFeedback>
  );
}
