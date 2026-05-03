import { createContext, type ReactNode, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { themes, type Theme } from '@novame/ui-tokens';

/**
 * Theme system for @novame/mobile.
 *
 * Consumes packages/ui-tokens themes (day/night) and exposes the
 * active theme via React context.
 *
 * Stage 2.3: System color scheme detection only (no user override yet).
 *   - iOS/Android system theme → maps to day/night
 *   - Live updates when system theme changes
 *
 * Stage 3+: User override via settings, persisted to MMKV.
 */

export type ThemeMode = 'day' | 'night';

export type ThemeContextValue = {
  /** Active theme bundle (colors, spacing, typography, etc.). */
  theme: Theme;
  /** Active mode name. */
  mode: ThemeMode;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(systemScheme === 'light' ? 'day' : 'night');

  // Re-sync when the system color scheme changes
  useEffect(() => {
    setMode(systemScheme === 'light' ? 'day' : 'night');
  }, [systemScheme]);

  const value: ThemeContextValue = {
    theme: themes[mode],
    mode,
  };

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
