import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import {
  NotificationTimePicker,
  formatReminderTime,
  type ReminderTime,
} from '@/components/notifications/notification-time-picker';
import { GridBackground } from '@/components/ui/grid-background';
import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import {
  checkNotificationPermission,
  getNotificationSettings,
  requestNotificationPermission,
} from '@/lib/notification-settings';

type Phase = 'ask' | 'time-picker' | 'saved';

const HOUR_DEFAULT = 20;
const MIN_DEFAULT = 0;

/** Full post-purchase notification setup page. Menu uses a compact modal. */
export default function NotificationSettingsModal() {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('ask');
  const [time, setTime] = useState<ReminderTime>({
    hour: HOUR_DEFAULT,
    min: MIN_DEFAULT,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = getNotificationSettings();
      if (!cancelled) setTime({ hour: saved.hour, min: saved.min });
      const permission = await checkNotificationPermission();
      if (!cancelled) setPhase(permission === 'granted' ? 'time-picker' : 'ask');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    void haptics.light();
    router.back();
  };

  const enable = async () => {
    if (busy) return;
    void haptics.pageOpen();
    setBusy(true);
    const result = await requestNotificationPermission();
    setBusy(false);
    if (result === 'granted') {
      setPhase('time-picker');
      return;
    }
    appAlert(
      'Notifications Disabled',
      'Enable notifications in Settings to receive a daily reminder.',
      [{ text: 'OK', onPress: close }],
    );
  };

  const saved = (next: ReminderTime) => {
    setTime(next);
    setPhase('saved');
    setTimeout(close, 1200);
  };

  return (
    <View style={styles.root}>
      <GridBackground base="#F2E6CB" line="#E3D2B2" cell={22} lineWidth={1.2} />

      {phase !== 'saved' ? (
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={{ flex: 1 }} />
          <Pressable onPress={close} style={styles.closeButton} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}

      {phase === 'ask' ? (
        <View style={styles.centeredBody}>
          <Text style={styles.askEmoji}>🔔</Text>
          <Text style={styles.askTitle}>Stay on Track</Text>
          <Text style={styles.askDescription}>
            Would you like your companion to send you a daily reminder to share your moments?
          </Text>
          <Pressable
            onPress={() => void enable()}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryButton,
              { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryButtonText}>Enable Notifications</Text>
          </Pressable>
          <Pressable onPress={close} style={({ pressed }) => [styles.skipButton, pressed && { opacity: 0.6 }]}>
            <Text style={styles.skipButtonText}>Not now</Text>
          </Pressable>
        </View>
      ) : phase === 'time-picker' ? (
        <View style={styles.centeredBody}>
          <NotificationTimePicker
            initialHour={time.hour}
            initialMin={time.min}
            onSaved={saved}
            onDisabled={close}
          />
        </View>
      ) : (
        <View style={styles.savedBody}>
          <Text style={styles.savedEmoji}>✅</Text>
          <Text style={styles.savedTitle}>Reminder Set!</Text>
          <Text style={styles.savedTime}>Daily at {formatReminderTime(time.hour, time.min)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2E6CB' },
  header: { flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 8 },
  closeButton: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#4A3423',
    alignItems: 'center', justifyContent: 'center',
  },
  centeredBody: {
    flex: 1, paddingHorizontal: 32, paddingBottom: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  askEmoji: { fontSize: 48, marginBottom: 16 },
  askTitle: { color: '#4A3423', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  askDescription: {
    color: '#8A7A63', fontSize: 14, textAlign: 'center',
    lineHeight: 22, marginBottom: 32,
  },
  primaryButton: {
    width: '100%', paddingVertical: 16, backgroundColor: '#8A6240',
    borderRadius: 16, alignItems: 'center', marginBottom: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  skipButton: { paddingVertical: 12, width: '100%', alignItems: 'center' },
  skipButtonText: { color: '#8A7A63', fontSize: 14, fontWeight: '500' },
  savedBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  savedEmoji: { fontSize: 64, marginBottom: 16 },
  savedTitle: { color: '#4A3423', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  savedTime: { color: '#8A7A63', fontSize: 14 },
});
