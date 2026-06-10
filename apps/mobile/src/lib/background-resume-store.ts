/**
 * Background-resume overlay store (Stage: splash-claim Step 2).
 *
 * A module-level pub/sub, mirroring study-claim-store / skin-unlock-store,
 * that controls a full-screen "Welcome back" overlay shown when the app
 * returns to the foreground after a long background (the same 30-min
 * staleness window used by cache-refresh-all's shouldRefreshAll).
 *
 * Why an overlay instead of re-showing the native splash: expo-splash-
 * screen's native splash is one-shot -- once hideAsync() runs on cold
 * start it cannot be shown again. So a long-background resume uses a
 * self-drawn overlay that visually matches the launch screen.
 *
 * While visible, the overlay (BackgroundResumeOverlay) runs the same
 * study-claim pre-settle as the cold-start splash gate AND awaits
 * refreshAllCaches, so the user lands on fresh data with the claim modal
 * (if any) ready -- no in-Home "Wrapping up..." spinner. It has its own
 * timeout so a slow network can't strand the overlay.
 *
 * State is just visible/not. _layout subscribes and renders the overlay;
 * the overlay clears it (hide) when its work finishes or times out.
 */
import { useEffect, useState } from 'react';

let _visible = false;
const _listeners = new Set<(v: boolean) => void>();

function notify(): void {
  for (const l of _listeners) l(_visible);
}

/** Show the resume overlay. Idempotent. */
export function showResumeOverlay(): void {
  if (_visible) return;
  _visible = true;
  notify();
}

/** Hide the resume overlay. Idempotent. */
export function hideResumeOverlay(): void {
  if (!_visible) return;
  _visible = false;
  notify();
}

/** Whether the overlay is currently requested (non-hook read). */
export function isResumeOverlayVisible(): boolean {
  return _visible;
}

/** React hook: overlay visibility. Used by app/_layout.tsx. */
export function useResumeOverlayVisible(): boolean {
  const [v, setV] = useState<boolean>(_visible);
  useEffect(() => {
    _listeners.add(setV);
    setV(_visible);
    return () => {
      _listeners.delete(setV);
    };
  }, []);
  return v;
}
