import * as Haptics from 'expo-haptics';

/**
 * Haptics singleton — semantic wrapper around expo-haptics.
 *
 * Use these named methods instead of direct expo-haptics calls
 * so we have a single place to silence/disable haptics if needed
 * (accessibility settings, user preference, etc.) in stage 3+.
 */
export const haptics = {
  /** Light tap — list selection, toggle, minor confirmation. */
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

  /** Medium tap — button press, action confirmation. */
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),

  /** Heavy tap — important action, drawer open, modal present. */
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),

  /** Success notification — operation completed. */
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),

  /** Warning notification — caution required. */
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),

  /** Error notification — operation failed. */
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),

  /** Selection change — picker scroll, slider tick. */
  selection: () => Haptics.selectionAsync(),
};
