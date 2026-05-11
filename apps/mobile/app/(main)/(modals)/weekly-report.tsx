import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import {
  fetchWisdomCenter,
  generateWeeklyReport,
  type WeeklyReportData,
  type WisdomCenterData,
} from '@/lib/wisdom-center-api';
import { AvatarRow } from '@/components/growth/avatar-row';

/**
 * Weekly Evolution Report overlay -- Stage 3.10.3 B.
 *
 * Renders four AI-generated sections from the most recent weekly report:
 *   1. The Pulse        -- wisdom count + Better Self Match
 *                          delta + per-trait evolution bars.
 *   2. The Narrative    -- prose journey + a highlighted Core Lesson.
 *   3. The Echo         -- community resonance count + avatar row +
 *                          message.
 *   4. The Path Forward -- focus trait for next week + reasoning + a
 *                          motto callout.
 *
 * Three entry states (mount-time decision):
 *   has-report   -- profile.weekly_reports has a row for the current
 *                   week; render the 4 sections immediately.
 *   can-generate -- reportAvailable=true (server says >=2 wisdoms this
 *                   week, no cached report yet); show a Generate CTA
 *                   that POSTs /api/wisdom-center.
 *   too-few      -- reportAvailable=false; show empty state explaining
 *                   the >=2 wisdom threshold.
 *
 * Generate flow:
 *   tap Generate -> POST -> {success, report} OR {notEnough}.
 *   notEnough surfaces as an Alert (rare race: report became
 *   unavailable between fetch and generate).
 *
 * Entry: Home tab description (middle round button) -> /weekly-report.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'has-report'; report: WeeklyReportData; data: WisdomCenterData }
  | { kind: 'can-generate'; data: WisdomCenterData }
  | { kind: 'too-few-first-time'; data: WisdomCenterData }
  | { kind: 'too-few-no-meet'; data: WisdomCenterData }
  | { kind: 'generating' };

function getProgressColor(score: number): string {
  if (score >= 80) return '#22C55E';
  if (score >= 60) return '#EAB308';
  return '#EF4444';
}

export default function WeeklyReportModal() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: sess }) => {
      if (cancelled) return;
      setUserId(sess.session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const res = await fetchWisdomCenter(userId);
      if (cancelled) return;
      if (res.kind === 'error') {
        setPhase({ kind: 'error', message: res.message });
        return;
      }
      const data = res.data;
      if (data.reportAvailable) {
        // Server says: 7 days since last report AND >=2 wisdoms in the
        // last 7 days. Always invite the user to generate, even if a
        // stale report exists -- they want to see this week's growth.
        setPhase({ kind: 'can-generate', data });
      } else if (data.latestReport) {
        // Not in a fresh-generate window yet, but we have a prior
        // report to show. Render it with the reportDate so the user
        // knows what week it covers.
        setPhase({ kind: 'has-report', report: data.latestReport, data });
      } else {
        // Never generated a report at all -- first-time user path.
        setPhase({ kind: 'too-few-first-time', data });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const handleGenerate = async () => {
    if (!userId) return;
    void haptics.medium();
    setPhase({ kind: 'generating' });
    const res = await generateWeeklyReport(userId);
    if (res.kind === 'success') {
      void haptics.success();
      // Re-fetch the full data envelope so we keep avatars + resonance
      // up to date; the report itself we already have inline.
      const fresh = await fetchWisdomCenter(userId);
      const data =
        fresh.kind === 'success'
          ? fresh.data
          : ({} as WisdomCenterData);
      setPhase({ kind: 'has-report', report: res.report, data });
    } else if (res.kind === 'notEnough') {
      void haptics.warning();
      Alert.alert(
        'Not enough wisdoms yet',
        'Share at least 2 wisdoms in the past 7 days to unlock your report.',
      );
      // Generate failed because the threshold wasn't met -- fall back
      // to the "didn't meet" empty state. We assume latestReport
      // existed (otherwise can-generate wouldn't have been the prior
      // phase only via reportAvailable=true), but for safety we don't
      // require it.
      setPhase((p) => (p.kind === 'generating'
        ? { kind: 'too-few-no-meet', data: {} as WisdomCenterData }
        : p));
    } else {
      void haptics.error();
      Alert.alert('Could not generate report', res.message);
      setPhase((p) => p.kind === 'generating'
        ? { kind: 'error', message: res.message }
        : p);
    }
  };

  // ---- header (shared by all phases) ----

  const Header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
        <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
      </Pressable>
      <Text style={styles.title}>Weekly Evolution Report</Text>
      <View style={styles.headerRight} />
    </View>
  );

  // ---- phase renders ----

  if (phase.kind === 'loading' || phase.kind === 'generating') {
    return (
      <View style={styles.root}>
        {Header}
        <View style={styles.centerFlex}>
          <ActivityIndicator color="#A855F7" size="large" />
          {phase.kind === 'generating' ? (
            <Text style={[styles.emptyText, { marginTop: 16 }]}>
              Generating your weekly report...
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  if (phase.kind === 'error') {
    return (
      <View style={styles.root}>
        {Header}
        <View style={styles.centerFlex}>
          <Text style={styles.emptyText}>{phase.message}</Text>
        </View>
      </View>
    );
  }

  if (phase.kind === 'too-few-first-time') {
    return (
      <View style={styles.root}>
        {Header}
        <View style={styles.centerFlex}>
          <Text style={styles.emptyEmoji}>📝</Text>
          <Text style={styles.emptyTitle}>No Report Yet</Text>
          <Text style={styles.emptyDesc}>
            Share at least 2 wisdoms in 7 days to unlock your first
            weekly evolution report.
          </Text>
        </View>
      </View>
    );
  }

  if (phase.kind === 'too-few-no-meet') {
    return (
      <View style={styles.root}>
        {Header}
        <View style={styles.centerFlex}>
          <Text style={styles.emptyEmoji}>🌱</Text>
          <Text style={styles.emptyTitle}>No New Report</Text>
          <Text style={styles.emptyDesc}>
            You didn't meet the requirement in the past 7 days
            (minimum 2 wisdoms). Keep sharing -- your next report
            unlocks once you do.
          </Text>
        </View>
      </View>
    );
  }

  if (phase.kind === 'can-generate') {
    return (
      <View style={styles.root}>
        {Header}
        <View style={styles.centerFlex}>
          <Text style={styles.emptyEmoji}>✨</Text>
          <Text style={styles.emptyTitle}>Your Report is Ready</Text>
          <Text style={styles.emptyDesc}>
            Tap below to generate this week's evolution report from the
            wisdoms you shared.
          </Text>
          <Pressable
            onPress={handleGenerate}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnText}>Generate Report</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- has-report: 4 sections ----

  const { report, data } = phase;
  const reportDateStr = data.reportDate
    ? new Date(data.reportDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  const p = report.section1_pulse ?? {};
  const n = report.section2_narrative ?? {};
  const e = report.section3_echo ?? {};
  const path = report.section4_path ?? {};

  const traitChanges = p.traitChanges ?? [];
  const betterSelfStart = p.betterSelfStart ?? 70;
  const betterSelfEnd = p.betterSelfEnd ?? 70;
  const scoreDiff = betterSelfEnd - betterSelfStart;
  const totalResonance = e.totalResonance ?? 0;
  const activeDays = p.activeDays ?? 0;

  return (
    <View style={styles.root}>
      {Header}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {reportDateStr ? (
          <Text style={styles.reportDateText}>
            Report from {reportDateStr}
          </Text>
        ) : null}

        {/* 1. The Pulse */}
        <View style={styles.card}>
          <SectionLabel icon="monitor-heart" color="#A78BFA">
            THE PULSE
          </SectionLabel>

          <View style={styles.pulseHeadlineRow}>
            <Text style={styles.pulseBigNumber}>{activeDays}</Text>
            <Text style={styles.pulseSubLabel}>
              {activeDays === 1 ? 'wisdom' : 'wisdoms'} shared this week
            </Text>
          </View>

          {/* Better Self Match -- start% [bar +diff] end% */}
          <View style={styles.matchBox}>
            <Text style={styles.matchLabel}>Better Self Match</Text>
            <View style={styles.matchRow}>
              <Text style={styles.matchStart}>{betterSelfStart}%</Text>
              <View style={styles.matchBarWrap}>
                <View style={styles.matchBarBg}>
                  <View
                    style={[
                      styles.matchBarFg,
                      {
                        width: `${Math.min(100, Math.abs(scoreDiff) * 10)}%`,
                        backgroundColor:
                          scoreDiff >= 0 ? '#22C55E' : '#EF4444',
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.matchDiff,
                    { color: scoreDiff >= 0 ? '#22C55E' : '#EF4444' },
                  ]}
                >
                  {scoreDiff >= 0 ? '+' : ''}
                  {scoreDiff}
                </Text>
              </View>
              <Text style={styles.matchEnd}>{betterSelfEnd}%</Text>
            </View>
          </View>

          {/* Trait Evolution */}
          {traitChanges.length > 0 ? (
            <>
              <Text style={styles.subLabel}>Trait Evolution</Text>
              {traitChanges.map((t, idx) => {
                const score = t.score ?? 70;
                const change = t.change ?? 0;
                const color = getProgressColor(score);
                return (
                  <View key={`${t.trait}-${idx}`} style={styles.traitRow}>
                    <Text style={styles.traitName} numberOfLines={1}>
                      {t.trait}
                    </Text>
                    <View style={styles.traitBarBg}>
                      <View
                        style={[
                          styles.traitBarFg,
                          {
                            width: `${Math.min(100, Math.max(0, score))}%`,
                            backgroundColor: color,
                          },
                        ]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.traitChange,
                        {
                          color:
                            change > 0
                              ? '#22C55E'
                              : change < 0
                                ? '#EF4444'
                                : 'rgba(255,255,255,0.3)',
                        },
                      ]}
                    >
                      {change > 0
                        ? `+${change}`
                        : change < 0
                          ? `${change}`
                          : '–'}
                    </Text>
                  </View>
                );
              })}
            </>
          ) : null}
        </View>

        {/* 2. The Narrative */}
        <View style={styles.card}>
          <SectionLabel icon="auto-stories" color="#60A5FA">
            THE NARRATIVE
          </SectionLabel>
          <Text style={styles.subLabel}>Your week in perspective</Text>
          {n.journey ? (
            <Text style={styles.bodyText}>{n.journey}</Text>
          ) : null}
          {n.corelesson ? (
            <View style={styles.lessonBox}>
              <Text style={styles.lessonLabel}>✦ Core Lesson</Text>
              <Text style={styles.lessonText}>{n.corelesson}</Text>
            </View>
          ) : null}
        </View>

        {/* 3. The Echo */}
        <View style={styles.card}>
          <SectionLabel icon="favorite" color="#F472B6">
            THE ECHO
          </SectionLabel>
          <View style={styles.echoRow}>
            <View>
              <Text style={styles.echoNumber}>
                {totalResonance.toLocaleString()}
              </Text>
              <Text style={styles.echoSubLabel}>
                souls reached
              </Text>
            </View>
            <AvatarRow avatars={data.defaultAvatars ?? []} />
          </View>
          {e.message ? (
            <Text style={styles.echoMessage}>{e.message}</Text>
          ) : null}
        </View>

        {/* 4. The Path Forward */}
        <View style={[styles.card, styles.pathCard]}>
          <SectionLabel icon="route" color="#C084FC">
            THE PATH FORWARD
          </SectionLabel>
          {path.focusTrait ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.subLabel}>Next week, nurture your</Text>
              <Text style={styles.focusTrait}>{path.focusTrait}</Text>
              {path.focusReason ? (
                <Text style={styles.focusReason}>{path.focusReason}</Text>
              ) : null}
            </View>
          ) : null}
          {path.motto ? (
            <View style={styles.mottoBox}>
              <Text style={styles.mottoLabel}>Your Motto for Next Week</Text>
              <Text style={styles.mottoText}>{path.motto}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

// ---- sub-components ----

function SectionLabel({
  icon,
  color,
  children,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  children: string;
}) {
  return (
    <View style={styles.sectionLabelRow}>
      <MaterialIcons name={icon} size={16} color={color} />
      <Text style={[styles.sectionLabelText, { color }]}>{children}</Text>
    </View>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    width: 36,
  },
  centerFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 32,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  emptyDesc: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
  primaryBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: '#7C3AED',
    borderRadius: 14,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 20,
  },
  reportDateText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginBottom: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  // Section label
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionLabelText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  // Card
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    marginBottom: 16,
  },
  pathCard: {
    backgroundColor: 'rgba(168,85,247,0.08)',
    borderColor: 'rgba(168,85,247,0.2)',
  },
  subLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '500',
  },
  // Pulse
  pulseHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 16,
  },
  pulseBigNumber: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
  },
  pulseSubLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    flex: 1,
  },
  matchBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  matchLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    marginBottom: 8,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  matchStart: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    fontWeight: '700',
  },
  matchBarWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchBarBg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  matchBarFg: {
    height: '100%',
    borderRadius: 2,
  },
  matchDiff: {
    fontSize: 11,
    fontWeight: '700',
  },
  matchEnd: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  // Trait
  traitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  traitName: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    width: 110,
  },
  traitBarBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  traitBarFg: {
    height: '100%',
    borderRadius: 3,
  },
  traitChange: {
    fontSize: 11,
    fontWeight: '700',
    width: 32,
    textAlign: 'right',
  },
  // Narrative
  bodyText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
  },
  lessonBox: {
    backgroundColor: 'rgba(168,85,247,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.2)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  lessonLabel: {
    color: '#C084FC',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  lessonText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  // Echo
  echoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 12,
  },
  echoNumber: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
  },
  echoSubLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginTop: 2,
  },
  echoMessage: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  // Path
  focusTrait: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  focusReason: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  mottoBox: {
    backgroundColor: 'rgba(168,85,247,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.25)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  mottoLabel: {
    color: '#C084FC',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  mottoText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
});
