import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '@/lib/haptics';
import {
  cancelDailyReminder,
  checkNotificationPermission,
  getNotificationSettings,
  requestNotificationPermission,
  scheduleDailyReminder,
} from '@/lib/notification-settings';

/**
 * Notification Settings overlay -- Stage 3.10.2 C2.
 *
 * Three states:
 *   ask         -- first-time entry, never enabled. Show big "Enable
 *                  Notifications" CTA + "Not now". Tap CTA -> request
 *                  permission. Granted -> time-picker. Denied -> close.
 *   time-picker -- current state when already enabled OR after grant.
 *                  Hour stepper (0-23 displayed as 12h + AM/PM toggle),
 *                  minute stepper (0/15/30/45 step 15). Set Reminder
 *                  schedules + saves; Turn off cancels + closes.
 *   saved       -- transient confirmation (1.2s) then close.
 *
 * Persistence in lib/notification-settings.ts (MMKV-backed).
 * Notification body reads charName from cached character-state, so a
 * user with charName='Nova' gets:
 *   "How was your day? Nova wants to hear about your life moments."
 */

type Phase = 'ask' | 'time-picker' | 'saved';

const HOUR_DEFAULT = 20;
const MIN_DEFAULT = 0;

function fmtTime(hour: number, min: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

export default function NotificationSettingsModal() {
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>('ask');
  const [hour, setHour] = useState<number>(HOUR_DEFAULT);
  const [min, setMin] = useState<number>(MIN_DEFAULT);
  const [busy, setBusy] = useState(false);

  // ---- mount: decide initial phase from saved settings + permission ----

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = getNotificationSettings();
      // Prime the picker with whatever the user last set, even if disabled.
      if (!cancelled) {
        setHour(saved.hour);
        setMin(saved.min);
      }
      // If they had a live reminder + the OS still grants permission,
      // skip the ask screen and let them edit the time directly.
      if (saved.enabled) {
        const perm = await checkNotificationPermission();
        if (cancelled) return;
        setPhase(perm === 'granted' ? 'time-picker' : 'ask');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- handlers ----

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const handleEnable = async () => {
    if (busy) return;
    void haptics.medium();
    setBusy(true);
    const result = await requestNotificationPermission();
    setBusy(false);
    if (result === 'granted') {
      setPhase('time-picker');
    } else {
      Alert.alert(
        'Notifications Disabled',
        'Enable notifications in Settings to receive a daily reminder.',
        [{ text: 'OK', onPress: handleClose }],
      );
    }
  };

  const handleSkip = () => {
    void haptics.light();
    handleClose();
  };

  const handleSave = async () => {
    if (busy) return;
    void haptics.medium();
    setBusy(true);
    try {
      await scheduleDailyReminder(hour, min);
      void haptics.success();
      setPhase('saved');
      setTimeout(() => {
        handleClose();
      }, 1200);
    } catch (e) {
      console.warn('[notification] schedule failed:', e);
      Alert.alert('Could not schedule reminder', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (busy) return;
    void haptics.warning();
    setBusy(true);
    try {
      await cancelDailyReminder();
    } catch (e) {
      console.warn('[notification] cancel failed:', e);
    } finally {
      setBusy(false);
      handleClose();
    }
  };

  // ---- character name for prompt copy ----

  const charName =
    'your companion';

  // ---- ask phase ----

  if (phase === 'ask') {
    return (
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={{ flex: 1 }} />
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.askBody}>
          <Text style={styles.askEmoji}>🔔</Text>
          <Text style={styles.askTitle}>Stay on Track</Text>
          <Text style={styles.askDesc}>
            Would you like {charName} to send you a daily reminder to share
            your moments?
          </Text>

          <Pressable
            onPress={handleEnable}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnText}>Enable Notifications</Text>
          </Pressable>

          <Pressable
            onPress={handleSkip}
            style={({ pressed }) => [
              styles.skipBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.skipBtnText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- saved phase ----

  if (phase === 'saved') {
    return (
      <View style={styles.root}>
        <View style={styles.savedBody}>
          <Text style={styles.savedEmoji}>✅</Text>
          <Text style={styles.savedTitle}>Reminder Set!</Text>
          <Text style={styles.savedTime}>Daily at {fmtTime(hour, min)}</Text>
        </View>
      </View>
    );
  }

  // ---- time picker phase ----

  const h12 = hour % 12 || 12;
  const ampm: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';

  // Single-step (and long-press repeating) handlers. Minute step is 1
  // for full precision; long-press auto-repeats every 80ms via StepBtn,
  // so dragging from :00 to :30 is ~2.4s. Single tap = single step.
  const incHour = () => {
    void haptics.selection();
    setHour((h) => (h + 1) % 24);
  };
  const decHour = () => {
    void haptics.selection();
    setHour((h) => (h - 1 + 24) % 24);
  };
  const incMin = () => {
    void haptics.selection();
    setMin((m) => (m + 1) % 60);
  };
  const decMin = () => {
    void haptics.selection();
    setMin((m) => (m - 1 + 60) % 60);
  };
  const toggleAmPm = () => {
    void haptics.selection();
    setHour((h) => (h + 12) % 24);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
          <MaterialIcons name="close" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      <View style={styles.pickerBody}>
        <Text style={styles.pickerEmoji}>🔔</Text>
        <Text style={styles.pickerTitle}>Set Reminder Time</Text>
        <Text style={styles.pickerDesc}>
          Choose when {charName} should remind you.
        </Text>

        <View style={styles.pickerCard}>
          <View style={styles.pickerRow}>
            {/* Hour */}
            <View style={styles.col}>
              <StepBtn dir="up" onPress={incHour} />
              <Text style={styles.digit}>
                {String(h12).padStart(2, '0')}
              </Text>
              <StepBtn dir="down" onPress={decHour} />
            </View>

            <Text style={styles.colon}>:</Text>

            {/* Minute */}
            <View style={styles.col}>
              <StepBtn dir="up" onPress={incMin} />
              <Text style={styles.digit}>
                {String(min).padStart(2, '0')}
              </Text>
              <StepBtn dir="down" onPress={decMin} />
            </View>

            {/* AM/PM */}
            <Pressable
              onPress={toggleAmPm}
              style={({ pressed }) => [
                styles.ampm,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.ampmText}>{ampm}</Text>
            </Pressable>
          </View>

          <Text style={styles.pickerSummary}>
            Daily at {fmtTime(hour, min)}
          </Text>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={busy}
          style={({ pressed }) => [
            styles.primaryBtn,
            { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.primaryBtnText}>
            {busy ? 'Saving...' : 'Set Reminder'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleDisable}
          disabled={busy}
          style={({ pressed }) => [
            styles.skipBtn,
            { opacity: busy ? 0.6 : pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={styles.skipBtnText}>Turn off notifications</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- sub-components ----

function StepBtn({ dir, onPress }: { dir: 'up' | 'down'; onPress: () => void }) {
  // Long-press auto-repeat: after a 350ms hold the button starts firing
  // onPress every 80ms so users can scroll quickly to a target value
  // without tapping 30 times. Single tap is unaffected -- the hold timer
  // is cleared on press release before it fires.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRepeat = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  };

  const handlePressIn = () => {
    holdTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = setInterval(() => {
        onPress();
      }, 80);
    }, 350);
  };

  // Cleanup if component unmounts mid-press (modal close, etc.)
  useEffect(() => {
    return stopRepeat;
  }, []);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={stopRepeat}
      style={({ pressed }) => [
        styles.stepBtn,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <MaterialIcons
        name={dir === 'up' ? 'expand-less' : 'expand-more'}
        size={24}
        color="#C084FC"
      />
    </Pressable>
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
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ASK
  askBody: {
    flex: 1,
    paddingHorizontal: 32,
    paddingBottom: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  askTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  askDesc: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  // PICKER
  pickerBody: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  pickerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  pickerDesc: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  pickerCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 20,
    marginBottom: 32,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  col: {
    alignItems: 'center',
    gap: 4,
  },
  stepBtn: {
    width: 44,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(168,85,247,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    width: 60,
    textAlign: 'center',
  },
  colon: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 32,
    fontWeight: '900',
  },
  ampm: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(168,85,247,0.15)',
    borderRadius: 12,
    marginLeft: 8,
  },
  ampmText: {
    color: '#C084FC',
    fontSize: 16,
    fontWeight: '700',
  },
  pickerSummary: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  // Buttons (shared)
  primaryBtn: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  skipBtn: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  skipBtnText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '500',
  },
  // SAVED
  savedBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  savedTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  savedTime: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
});
