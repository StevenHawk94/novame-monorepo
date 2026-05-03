import { use } from 'react';
import { ThemeContext } from './theme-context';

/**
 * Hook to consume the active theme.
 *
 * Throws if used outside <ThemeProvider /> — that means the call site
 * is rendered before app/_layout.tsx sets up the provider tree, which
 * is a structural error worth catching loudly.
 *
 * Usage:
 *
 *   const { theme, mode } = useTheme();
 *   <View style={{ backgroundColor: theme.colors.bg }} />
 */
export function useTheme() {
  const ctx = use(ThemeContext);
  if (!ctx) {
    throw new Error(
      'useTheme must be used within <ThemeProvider />. ' +
      'Check that app/_layout.tsx wraps children with ThemeProvider.'
    );
  }
  return ctx;
}
