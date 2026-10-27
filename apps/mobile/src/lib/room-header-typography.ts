import { Platform } from 'react-native';

/** Shared native Room title; body and dialogue typography stay independent. */
export const ROOM_TITLE_STYLE = {
  fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  fontSize: 24,
  lineHeight: 30,
  fontWeight: '800' as const,
};
