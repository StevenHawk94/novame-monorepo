import * as Haptics from 'expo-haptics';
import { getInteractionPreferences } from './interaction-preferences';

const perform = (action: () => Promise<void>) => {
  if (!getInteractionPreferences().haptics) return Promise.resolve();
  try { return action().catch(() => {}); } catch { return Promise.resolve(); }
};

/**
 * Haptics singleton — semantic wrapper around expo-haptics.
 *
 * Use these named methods instead of direct expo-haptics calls
 * so we have a single place to silence/disable haptics if needed
 * (accessibility settings, user preference, etc.) in stage 3+.
 */
export const haptics = {
  /** A request acknowledgement only; hardware sensation must be tested by the user. */
  touchPulse: async () => {
    if(!getInteractionPreferences().haptics)return false;
    try{await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);return true;}catch{return false;}
  },
  /** Page open — user-initiated navigation, matching the bottom tabs. */
  pageOpen: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** Page/sheet close — user-initiated exit, matching the bottom tabs. */
  pageClose: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** Light tap — list selection, toggle, minor confirmation. */
  light: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** Medium tap — button press, action confirmation. */
  medium: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),

  /** Heavy tap — important action, drawer open, modal present. */
  heavy: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),

  /** Success notification — operation completed. */
  success: () => perform(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** Warning notification — caution required. */
  warning: () => perform(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),

  /** Error notification — operation failed. */
  error: () => perform(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),

  /** Selection change — picker scroll, slider tick. */
  selection: () => perform(() => Haptics.selectionAsync()),
};
