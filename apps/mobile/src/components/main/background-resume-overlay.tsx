/**
 * BackgroundResumeOverlay — Stage: splash-claim Step 2.
 *
 * Full-screen overlay shown when the app returns from a long background
 * (>= the 30-min staleness window). Visually matches the launch screen
 * (purple + NovaMe logo + spinner). While visible it:
 *
 *   1. Pre-settles a pending study-claim (if a study session ended in the
 *      background) via the SAME preSettleStudyClaim used by the cold-start
 *      splash gate, so the claim modal opens in Home with its result ready
 *      instead of showing a "Wrapping up..." spinner.
 *   2. Awaits refreshAllCaches so the user lands on hot data (this replaces
 *      the previous fire-and-forget refresh in _layout's AppState handler).
 *
 * CRITICAL — two independent lifecycles (do not re-merge them):
 *
 *   A. Overlay VISIBILITY (hideOverlay): the purple screen. Hidden either
 *      when the work finishes OR at the 8s timeout, so a slow network can't
 *      strand the user on the overlay.
 *
 *   B. Claim OWNERSHIP (beginExternalClaim / endExternalClaim): tells the
 *      in-session detector's 30s poll to yield so it can't race a second
 *      POST. This is released ONLY when the settle work actually finishes
 *      (the async finally) -- NOT at the visual timeout. If we released it
 *      at the 8s hide while postStudyClaim were still in flight, the poll
 *      would resume, see WP still 0 (the POST hasn't zeroed afk yet), fire
 *      its own POST, and the two would double-settle -> a flashed "+0 XP".
 *      So the overlay can disappear at 8s while ownership persists until
 *      the POST returns; the claim result is stashed in the module-level
 *      store and surfaces the modal in Home regardless.
 *
 * cleanup deliberately does NOT release ownership: that would reintroduce
 * the same early-release race on unmount. The async finally always runs
 * (Promise.allSettled never rejects), so ownership is guaranteed to be
 * released exactly once the work completes; if the app is killed first,
 * the flag is in-memory and resets on next launch.
 */
import { useEffect, useRef } from 'react';
import { Image, Modal, StyleSheet, View } from 'react-native';

import { getCurrentSession } from '@/lib/auth';
import { preSettleStudyClaim } from '@/lib/pre-settle-study-claim';
import {
  beginExternalClaim,
  endExternalClaim,
} from '@/lib/study-claim-store';
import { refreshAllCaches } from '@/lib/cache-refresh-all';
import { hideResumeOverlay } from '@/lib/background-resume-store';

const SPLASH = require('../../../assets/splash.png');
const RESUME_TIMEOUT_MS = 8000;

export function BackgroundResumeOverlay() {
  const hiddenRef = useRef(false);

  useEffect(() => {
    // Claim ownership for the whole settle, set immediately so the detector
    // poll yields from the very first tick (not just from the POST onward).
    beginExternalClaim();

    // (A) Visibility: hide the overlay. Idempotent. May fire at the 8s
    // timeout or when the work finishes -- whichever comes first.
    const hideOverlay = () => {
      if (hiddenRef.current) return;
      hiddenRef.current = true;
      hideResumeOverlay();
    };

    // 8s visual cap: stop showing the overlay even if work is still going.
    // Ownership is intentionally NOT released here (see header).
    const timer = setTimeout(hideOverlay, RESUME_TIMEOUT_MS);

    void (async () => {
      try {
        const session = await getCurrentSession();
        const userId = session?.user?.id;
        if (!userId) return;
        await Promise.allSettled([
          preSettleStudyClaim(userId, {
            // Ownership already held; harmless re-affirmation before POST.
            onClaimOwned: beginExternalClaim,
          }),
          refreshAllCaches(userId),
        ]);
      } catch (e) {
        console.warn('[resume-overlay] settle/refresh failed (non-fatal):', e);
      } finally {
        // (B) Ownership: released ONLY now, after the POST has actually
        // returned -- the counter is settled, so the poll resuming here
        // will fetch, see mode 'play', and not re-trigger.
        clearTimeout(timer);
        hideOverlay();
        endExternalClaim();
      }
    })();

    // No ownership release in cleanup (would re-introduce the early-release
    // race). The async finally guarantees release once work completes.
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.root}>
        <Image source={SPLASH} style={styles.splashImage} resizeMode="contain" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Mirror the native splash exactly: full-bleed splash.png contained on
  // the same #7C3AED, no spinner -- so the iOS launch-screen flash on a
  // long-background resume transitions seamlessly into this overlay and the
  // user perceives a single continuous launch screen.
  root: {
    flex: 1,
    backgroundColor: '#7C3AED',
  },
  splashImage: {
    width: '100%',
    height: '100%',
  },
});
