import * as Haptics from 'expo-haptics';
import { getInteractionPreferences } from './interaction-preferences';

let pressDepth = 0;
const pressedEvents = new WeakSet<object>();
const perform = (action: () => Promise<void>, legacyPress = false) => {
  if ((legacyPress && pressDepth > 0) || !getInteractionPreferences().haptics) return Promise.resolve();
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
  /** Shared button activation. Not a replacement for continuous interaction feedback. */
  soft: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  /** A request acknowledgement only; hardware sensation must be tested by the user. */
  touchPulse: async () => {
    if(!getInteractionPreferences().haptics)return false;
    try{await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);return true;}catch{return false;}
  },
  /** Page open — user-initiated navigation, matching the bottom tabs. */
  pageOpen: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft), true),

  /** Page/sheet close — user-initiated exit, matching the bottom tabs. */
  pageClose: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft), true),

  /** Light tap — list selection, toggle, minor confirmation. */
  light: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), true),

  /** Medium tap — button press, action confirmation. */
  medium: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), true),

  /** Heavy tap — important action, drawer open, modal present. */
  heavy: () => perform(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), true),

  /** Success notification — operation completed. */
  success: () => perform(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** Warning notification — caution required. */
  warning: () => perform(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),

  /** Error notification — operation failed. */
  error: () => perform(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),

  /** Selection change — picker scroll, slider tick. */
  selection: () => perform(() => Haptics.selectionAsync(), true),
};

/** Synchronous scope only: never await feedback or suppress later business outcomes.
 * The same native event may bubble through nested controls; acknowledge it once. */
export function withSoftPress<T>(action: () => T, event?: object): T {
  const native = event && 'nativeEvent' in event ? event.nativeEvent : event;
  const token = native && typeof native === 'object' ? native : undefined;
  if (pressDepth === 0 && (!token || !pressedEvents.has(token))) void haptics.soft();
  if (token) pressedEvents.add(token);
  pressDepth++;
  try { return action(); } finally { pressDepth--; }
}
