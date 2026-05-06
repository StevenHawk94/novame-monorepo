/**
 * Study-claim modal — Stage 3.9.A.2.5
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
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
import { supabase } from '@/lib/supabase';

const FILL_DURATION_MS = 900;

export default function StudyClaimModal() {
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string | null>(null);
  const [result, setResult] = useState<StudyClaimResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(true);

  const charName = getCachedCharacterState()?.charName || 'Your companion';

  const progress = useSharedValue(0);
  const targetRef = useRef(0);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await postStudyClaim(userId);
        if (cancelled) return;
        setResult(res);
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
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not claim session');
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const handleAwesome = async () => {
    if (userId) {
      try {
        await fetchCharacterState(userId);
      } catch {
        // Best-effort.
      }
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/(tabs)');
  };

  return (
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
            style={({ pressed }) => [
              styles.button,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
        </View>
      ) : result ? (
        <View style={styles.card}>
          <Text style={styles.tada}>🎉</Text>
          <Text style={styles.title}>Session Complete!</Text>
          <Text style={styles.subtitle}>
            {charName} completed {result.studyHours}h {result.studyMins}m of life study
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
              While you were in study mode,{' '}
              <Text style={styles.narrativeBoldPurple}>
                {result.totalSouls} lost souls
              </Text>{' '}
              passed by. I slipped them your{' '}
              <Text style={styles.narrativeBoldWhite}>
                '{result.cardKeyword}'
              </Text>{' '}
              card. Your resonance grew by{' '}
              <Text style={styles.narrativeBoldGreen}>
                +{result.resonanceBoost}
              </Text>
              .
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
            style={({ pressed }) => [
              styles.button,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.buttonText}>Awesome! 🚀</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
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
  tada: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 8,
  },
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
  expLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  expValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  expValue: {
    color: '#FACC15',
    fontSize: 18,
    fontWeight: '800',
  },
  expBolt: {
    color: '#FACC15',
    fontSize: 16,
  },
  narrativeCard: {
    backgroundColor: 'rgba(168,85,247,0.06)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.15)',
    marginBottom: 18,
  },
  narrative: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    lineHeight: 22,
  },
  narrativeBoldPurple: {
    color: '#C084FC',
    fontWeight: '800',
  },
  narrativeBoldWhite: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  narrativeBoldGreen: {
    color: '#22C55E',
    fontWeight: '800',
  },
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
  levelText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  levelXpText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontWeight: '600',
  },
  barTrack: {
    height: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#F5641F',
    borderRadius: 999,
  },
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
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
