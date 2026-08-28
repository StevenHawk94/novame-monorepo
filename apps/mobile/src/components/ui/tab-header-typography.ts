import { Platform } from 'react-native';

// Preserve Memories on iOS; Android uses the requested shared 20pt title.
// Wrap rather than silently shrinking to make room for a trailing action.
export const MEMORIES_TITLE_TYPOGRAPHY = {
  fontSize: 27,
  lineHeight: 33,
  fontFamily: 'Inter_800ExtraBold',
} as const;

export const androidTabHeaderTypography = Platform.OS === 'android' ? {
  title: { ...MEMORIES_TITLE_TYPOGRAPHY, fontSize: 20, lineHeight: 26, flexShrink: 1 },
  subtitle: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_500Medium' },
} : { title: {}, subtitle: {} };
