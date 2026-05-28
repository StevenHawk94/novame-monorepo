import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  fetchReportHistory,
  type WeeklyReportListItem,
} from '@/lib/wisdom-center-api';

/**
 * Weekly Report History list -- task B (commit 35d).
 *
 * Lists every past weekly report for the user, newest first. Each
 * row shows the week's date range ("Apr 25 - May 1"). Tapping a row
 * opens that week's report by pushing /weekly-report?week_start=...,
 * which the weekly-report modal loads cache-first (MMKV per-week)
 * then server (per Q-C1 architecture).
 *
 * The list itself always comes from the server (source of truth,
 * correct after reinstall / device switch) -- it is NOT cached.
 *
 * Entry: weekly-report modal headerRight history button.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; reports: WeeklyReportListItem[] };

/**
 * Format a Monday week_start ('YYYY-MM-DD') into a "Mon D - Mon D"
 * range spanning that Monday through the following Sunday (+6 days).
 * Per Q-C4: range is week_start .. week_start + 6.
 */
function formatWeekRange(weekStart: string): string {
  // Parse as local date (avoid TZ shift by appending T00:00:00).
  const start = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return weekStart;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(start)} - ${fmt(end)}`;
}

export default function ReportHistoryModal() {
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const res = await fetchReportHistory(userId);
      if (cancelled) return;
      if (res.kind === 'error') {
        setPhase({ kind: 'error', message: res.message });
        return;
      }
      setPhase({ kind: 'ready', reports: res.reports });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const handleOpenReport = (weekStart: string) => {
    void haptics.light();
    router.push({
      pathname: '/(main)/(modals)/weekly-report',
      params: { week_start: weekStart },
    });
  };

  const Header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
        <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
      </Pressable>
      <Text style={styles.title}>Report History</Text>
      <View style={styles.headerRight} />
    </View>
  );

  if (phase.kind === 'loading') {
    return (
      <View style={styles.root}>
        {Header}
        <View style={styles.centerFlex}>
          <ActivityIndicator color="#A78BFA" />
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

  if (phase.reports.length === 0) {
    return (
      <View style={styles.root}>
        {Header}
        <View style={styles.centerFlex}>
          <MaterialIcons
            name="history"
            size={48}
            color="rgba(255,255,255,0.2)"
          />
          <Text style={styles.emptyText}>
            No reports yet. Generate your first weekly report to start
            building your history.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {Header}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {phase.reports.map((r) => (
          <Pressable
            key={r.week_start}
            onPress={() => handleOpenReport(r.week_start)}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
          >
            <View style={styles.rowIconCircle}>
              <MaterialIcons name="event-note" size={20} color="#A78BFA" />
            </View>
            <Text style={styles.rowLabel}>{formatWeekRange(r.week_start)}</Text>
            <MaterialIcons
              name="chevron-right"
              size={22}
              color="rgba(255,255,255,0.3)"
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

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
    gap: 16,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  rowIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(167,139,250,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
