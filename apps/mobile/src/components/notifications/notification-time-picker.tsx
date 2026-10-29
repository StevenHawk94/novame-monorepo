import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import { MaterialIcons } from '@expo/vector-icons';

import { appAlert } from '@/components/ui/app-dialog';
import { haptics } from '@/lib/haptics';
import {
  cancelDailyReminder,
  scheduleDailyReminder,
} from '@/lib/notification-settings';

export type ReminderTime = { hour: number; min: number };

export function formatReminderTime(hour: number, min: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

export function NotificationTimePicker({
  initialHour,
  initialMin,
  onSaved,
  onDisabled,
  showDisable = true,
}: {
  initialHour: number;
  initialMin: number;
  onSaved: (time: ReminderTime) => void;
  onDisabled?: () => void;
  showDisable?: boolean;
}) {
  const hour=20,min=0;
  const [busy, setBusy] = useState(false);

  const h12 = hour % 12 || 12;
  const ampm: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';

  const save = async () => {
    if (busy) return;
    void haptics.medium();
    setBusy(true);
    try {
      await scheduleDailyReminder(hour, min);
      void haptics.success();
      onSaved({ hour, min });
    } catch (error) {
      console.warn('[notification] schedule failed:', error);
      appAlert('Could not schedule reminder', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    void haptics.warning();
    setBusy(true);
    try {
      await cancelDailyReminder();
      onDisabled?.();
    } catch (error) {
      console.warn('[notification] cancel failed:', error);
      appAlert('Could not turn off reminder','Please try again. Your previous setting has been kept.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={styles.emoji}>🔔</Text>
      <Text style={styles.title}>Adventure Reminder</Text>
      <Text style={styles.description}>At 8:00 PM, only if you haven’t started your adventure.</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.column}>
            <Text style={styles.digit}>{String(h12).padStart(2, '0')}</Text>
          </View>

          <Text style={styles.colon}>:</Text>

          <View style={styles.column}>
            <Text style={styles.digit}>{String(min).padStart(2, '0')}</Text>
          </View>

          <View style={styles.ampm}>
            <Text style={styles.ampmText}>{ampm}</Text>
          </View>
        </View>

        <Text style={styles.summary}>Daily at {formatReminderTime(hour, min)}</Text>
      </View>

      <Pressable
        onPress={() => void save()}
        disabled={busy}
        style={({ pressed }) => [
          styles.primaryButton,
          { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.primaryButtonText}>{busy ? 'Saving...' : 'Set Reminder'}</Text>
      </Pressable>

      {showDisable ? (
        <Pressable
          onPress={() => void disable()}
          disabled={busy}
          style={({ pressed }) => [
            styles.secondaryButton,
            { opacity: busy ? 0.6 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={styles.secondaryButtonText}>Turn off reminder</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function StepButton({
  direction,
  onPress,
}: {
  direction: 'up' | 'down';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, pressed && { opacity: 0.6 }]}
    >
      <MaterialIcons
        name={direction === 'up' ? 'expand-less' : 'expand-more'}
        size={24}
        color="#8A6240"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  emoji: { fontSize: 40, marginBottom: 12 },
  title: { color: '#4A3423', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  description: { color: '#8A7A63', fontSize: 13, textAlign: 'center', marginBottom: 24 },
  card: {
    width: '100%', backgroundColor: '#FFFFFF', borderRadius: 20,
    borderWidth: 1.5, borderColor: '#E8D5B0', padding: 20, marginBottom: 32,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  column: { alignItems: 'center', gap: 4 },
  stepButton: {
    width: 44, height: 36, borderRadius: 12, backgroundColor: '#FBF6EA',
    alignItems: 'center', justifyContent: 'center',
  },
  digit: { color: '#4A3423', fontSize: 32, fontWeight: '900', width: 60, textAlign: 'center' },
  colon: { color: '#C9BCA5', fontSize: 32, fontWeight: '900' },
  ampm: {
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FBF6EA',
    borderRadius: 12, marginLeft: 8,
  },
  ampmText: { color: '#8A6240', fontSize: 16, fontWeight: '700' },
  summary: { color: '#8A7A63', fontSize: 12, textAlign: 'center', marginTop: 16 },
  primaryButton: {
    width: '100%', paddingVertical: 16, backgroundColor: '#8A6240',
    borderRadius: 16, alignItems: 'center', marginBottom: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryButton: { paddingVertical: 12, width: '100%', alignItems: 'center' },
  secondaryButtonText: { color: '#8A7A63', fontSize: 14, fontWeight: '500' },
});
