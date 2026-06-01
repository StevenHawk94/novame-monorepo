import * as SplashScreen from 'expo-splash-screen';

/**
 * Centralized splash-hide control for the "hold splash until the first
 * real screen has rendered" pattern (industry standard).
 *
 * The native splash (purple + mascot, configured in app.json) is kept
 * visible by SplashScreen.preventAutoHideAsync() in app/_layout.tsx.
 * It is hidden exactly once, by whichever first destination screen
 * (home / onboarding / auth) finishes its initial layout — see each
 * screen's root onLayout handler. This guarantees the user never sees
 * a blank/placeholder frame between the splash and the rendered screen.
 *
 * hideSplashOnce() is idempotent: multiple destination screens may each
 * call it on layout (only one of them actually renders per launch, but
 * the guard makes accidental double-calls safe), and the 10s timeout
 * fallback in _layout.tsx may also call it if a screen's onLayout never
 * fires (defensive — prevents a permanently stuck splash).
 */
let hidden = false;

export function hideSplashOnce(): void {
  if (hidden) return;
  hidden = true;
  SplashScreen.hideAsync().catch(() => {
    // Already hidden, or preventAutoHideAsync returned false at startup.
    // Nothing to do.
  });
}
