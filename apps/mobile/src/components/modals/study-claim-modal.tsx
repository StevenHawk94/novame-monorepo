/**
 * Study-claim modal — Stage 3.9.A.2.5 (refactored from a (modals) route page
 * to a component-level <Modal> in Phase: modal-coordinator).
 *
 * Why this is a component, not a route: it must participate in the same serial
 * modal layer as announcement + skin (all RN <Modal>), coordinated by
 * modal-coordinator. A pushed route page always renders BELOW a sibling
 * <Modal>, which caused priority inversion / stacking. Now rendered globally
 * from (tabs)/_layout.tsx when claim is the active coordinator slot.
 *
 * Business logic (postStudyClaim, EXP fill animation, Confetti, copy) is
 * unchanged from the route version; only the shell changed: userId is a prop,
 * and closing calls onClose() instead of router.back()/replace().
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Confetti } from '@/components/cards/Confetti';
import {
  fetchCharacterState,
  getCachedCharacterState,
} from '@/lib/character-state';
import { postStudyClaim, type StudyClaimResponse } from '@/lib/study-claim-api';
import { setClaimDeferred } from '@/lib/study-claim-store';
import { haptics } from '@/lib/haptics';

const FILL_DURATION_MS = 900;

type StudyClaimModalProps = {
  /** The authenticated user id to claim for. */
  userId: string;
  /**
   * Pre-settled claim result. When provided (the splash gate already
   * POSTed the claim before entering Home), the modal renders it directly
   * and does NOT call postStudyClaim again. When omitted (in-session
   * detection / background return), the modal self-fetches as before.
   */
  initialResult?: StudyClaimResponse | null;
  /** Called when the user dismisses (Awesome / Close button). */
  onClose: () => void;
};

export function StudyClaimModal({
  userId,
  initialResult,
  onClose,
}: StudyClaimModalProps) {
  const insets = useSafeAreaInsets();
  // Seed from the pre-settled result if present, so the success UI shows
  // immediately with no spinner. submitting starts false in that case.
  const [result, setResult] = useState<StudyClaimResponse | null>(
    initialResult ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(!initialResult);

  const charName = getCachedCharacterState()?.charName || 'Your companion';

  const progress = useSharedValue(0);
  const targetRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    // Shared helper: animate the EXP bar to the result's fill ratio.
    const animateTo = (res: StudyClaimResponse) => {
      const target =
        res.newExpNeeded > 0
          ? Math.min(1, Math.max(0, res.newExp / res.newExpNeeded))
          : 0;
      targetRef.current = target;
      setTimeout(() => {
        progress.value = withTiming(target, {
          duration: FILL_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        });
      }, 400);
    };

    // Optimistic path: we were handed a locally-computed result, so the
    // success UI shows instantly (no spinner). But nothing has been settled
    // server-side yet -- fire postStudyClaim in the BACKGROUND to actually
    // settle (award XP, flip mode->play, zero afk_study_seconds) and to get
    // the authoritative values. Then reconcile silently:
    //   - success: overwrite the optimistic result with the server's (the
    //     local XP can be slightly low when the cache was stale; this quietly
    //     bumps the bar up to the real value). souls/cardKeyword are ignored.
    //   - nothingToClaim: the effect below closes the modal (already-settled,
    //     e.g. multi-device) -- Home rolls back the optimistic XP (step 6).
    //   - network failure (offline): defer + close (unchanged behaviour);
    //     Home rolls back the optimistic XP (step 6). The session stays
    //     claimable and re-pops on the next app open.
    //   - other error: keep the optimistic result on screen (reconcile is
    //     best-effort; don't wreck a shown celebration over a transient error).
    if (initialResult) {
      animateTo(initialResult);
      (async () => {
        try {
          const authoritative = await postStudyClaim(userId);
          if (cancelled) return;
          setClaimDeferred(false);
          setResult(authoritative);
          if (!authoritative.nothingToClaim) animateTo(authoritative);
        } catch (e) {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : '';
          if (
            msg.includes('Network request failed') ||
            msg.includes('NetworkError') ||
            msg.includes('Failed to fetch')
          ) {
            // Offline: not settled. Defer to Growth "Claim" / next app open
            // and close (Q5e-1). Home rolls back the optimistic XP (step 6).
            setClaimDeferred(true);
            onClose();
            return;
          }
          // Non-network error: leave the optimistic celebration as-is.
          console.warn('[study-claim] background reconcile failed:', msg);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // Self-fetch path (in-session detection / background return): claim now.
    (async () => {
      try {
        const res = await postStudyClaim(userId);
        if (cancelled) return;
        setClaimDeferred(false);
        setResult(res);
        animateTo(res);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : '';
        // Network failure (offline / server unreachable): don't show an
        // error wall and don't auto-retry. Defer instead -- the session
        // stays claimable server-side; the Growth button shows "Claim" and
        // it auto-pops next app open. Non-network errors still surface.
        if (
          msg.includes('Network request failed') ||
          msg.includes('NetworkError') ||
          msg.includes('Failed to fetch')
        ) {
          setClaimDeferred(true);
          onClose();
          return;
        }
        setError(msg || 'Could not claim session');
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, initialResult, progress]);

  // Suppress the celebration for a no-op claim (already settled / nothing
  // banked). The server returns nothingToClaim:true; we close immediately so
  // the coordinator releases the 'claim' slot and the user never sees a blank
  // "+0 XP" modal. Covers both the pre-settled (initialResult) and
  // self-fetched paths since both resolve into `result`.
  useEffect(() => {
    if (result?.nothingToClaim) onClose();
  }, [result, onClose]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const handleAwesome = async () => {
    void haptics.light();
    try {
      await fetchCharacterState(userId);
    } catch {
      // Best-effort.
    }
    onClose();
  };

  // No-op claim (already settled / nothing banked): render nothing at all --
  // no <Modal>, so the transparent full-screen overlay can never block Home
  // touches. The nothingToClaim effect above has already called onClose() to
  // release the coordinator's 'claim' slot.
  if (result?.nothingToClaim) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { paddingBottom: insets.bottom + 16 }]}>
        <Confetti />

        {submitting && !result ? (
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#A855F7" />
            <Text style={[styles.subtitle, { marginTop: 16 }]}>
              Wrapping up your session…
            </Text>
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.title}>Hmm</Text>
            <Text style={styles.subtitle}>{error}</Text>
            <Pressable
              onPress={handleAwesome}
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          </View>
        ) : result && !result.nothingToClaim ? (
          <View style={styles.card}>
            <Text style={styles.tada}>🎉</Text>
            <Text style={styles.title}>Session Complete!</Text>
            <Text style={styles.subtitle}>
              {charName} has dedicated {result.studyHours}h {result.studyMins}m to mastering your wisdom.
            </Text>

            <View style={styles.expCapsule}>
              <Text style={styles.expLabel}>EXP Gained</Text>
              <View style={styles.expValueRow}>
                <Text style={styles.expValue}>+{result.expGained} XP</Text>
                <Text style={styles.expBolt}>⚡</Text>
              </View>
            </View>

            <View style={styles.narrativeCard}>
              <Text style={styles.narrative}>
                {charName} has grown wiser by learning alongside you! They&apos;ve just uncovered a special daily quest to accelerate your growth. Complete it today!
              </Text>
            </View>

            <View style={styles.levelBlock}>
              <View style={styles.levelLabelRow}>
                <Text style={styles.levelText}>Lv. {result.newLevel}</Text>
                <Text style={styles.levelXpText}>
                  {result.newExp} / {result.newExpNeeded} XP
                </Text>
              </View>
              <View style={styles.barTrack}>
                <Animated.View style={[styles.barFill, fillStyle]} />
              </View>
              {result.leveledUp ? (
                <Text style={styles.levelUpHint}>
                  🎉 Level up! {result.oldLevel} → {result.newLevel}
                </Text>
              ) : null}
            </View>

            <Pressable
              onPress={handleAwesome}
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.buttonText}>Let&apos;s Do It! 🚀</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(10,5,30,0.92)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#1F1545',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.18)',
    alignItems: 'stretch',
  },
  tada: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  expCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(168,85,247,0.12)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  expLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  expValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  expValue: { color: '#FACC15', fontSize: 18, fontWeight: '800' },
  expBolt: { color: '#FACC15', fontSize: 16 },
  narrativeCard: {
    backgroundColor: 'rgba(168,85,247,0.06)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.15)',
    marginBottom: 18,
  },
  narrative: { color: 'rgba(255,255,255,0.78)', fontSize: 14, lineHeight: 22 },
  levelBlock: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 22,
  },
  levelLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  levelText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  levelXpText: { color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '600' },
  barTrack: {
    height: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: '#F5641F', borderRadius: 999 },
  levelUpHint: {
    color: '#FACC15',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 10,
  },
  button: {
    backgroundColor: '#A855F7',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
})
