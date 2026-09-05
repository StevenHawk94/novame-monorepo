import { Platform } from 'react-native';

export const MEMORIES_TITLE_TYPOGRAPHY = {
  fontSize: 27,
  lineHeight: 33,
  fontFamily: 'Inter_800ExtraBold',
} as const;

// Keep the three primary content tabs visually consistent while preserving the
// denser Android header sizing requested for smaller Android layouts.
export const tabHeaderTypography = Platform.OS === 'android' ? {
  title: { ...MEMORIES_TITLE_TYPOGRAPHY, fontSize: 20, lineHeight: 26, flexShrink: 1 },
  subtitle: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_500Medium' },
} : {
  title: MEMORIES_TITLE_TYPOGRAPHY,
  subtitle: { fontSize: 13.5, lineHeight: 19, fontFamily: 'Inter_500Medium' },
};
