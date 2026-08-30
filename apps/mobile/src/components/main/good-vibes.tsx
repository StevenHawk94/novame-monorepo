import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSegments } from 'expo-router';
import { useHomeEntry } from '@/lib/use-home-entry';
import { isHomeEntryRoute } from '@/lib/home-entry-readiness';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { createOperationScope, withDeadline } from '@/lib/async-lifecycle';
import { sessionEpoch, subscribeSessionIdentity } from '@/lib/session-lifecycle';
import { requestModalSlot, releaseModalSlot, useActiveModalSlot } from '@/lib/modal-coordinator';
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

import { appAlert } from '@/components/ui/app-dialog';
import { FixedColumnGrid } from '@/components/ui/fixed-column-grid';
import { UserAvatar } from '@/components/ui/user-avatar';
import { haptics } from '@/lib/haptics';
import { GOOD_VIBE_ART } from '@/lib/icons';
import { subscribeGoodVibeRealtime } from '@/lib/pairing-realtime';
import {
  GOOD_VIBE_MESSAGES,
  fetchUnreadGoodVibe,
  markGoodVibeRead,
  sendGoodVibe,
  type GoodVibeInboxItem,
} from '@/lib/friends-api';

type PickerProps = {
  visible: boolean;
  onClose: () => void;
  onSent?: () => void;
  replyToId?: string;
};

export function GoodVibesPicker({ visible, onClose, onSent, replyToId }: PickerProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const operation = useRef(createOperationScope()).current;

  useEffect(() => {
    setSending(false);
    busy.current = false;
    if (!visible) setSelected(null);
    return () => operation.invalidate();
  }, [visible, operation]);

  function close() {
    operation.invalidate();
    busy.current = false;
    onClose();
  }

  async function submit() {
    if (!visible || selected === null || busy.current) return;
    busy.current = true;
    const current = operation.begin();
    const epoch = sessionEpoch();
    setSending(true);
    const result = await withDeadline(sendGoodVibe(selected, replyToId), 20000)
      .catch(() => ({ ok: false, error: 'network' }));
    if (!current() || epoch !== sessionEpoch()) return;
    busy.current = false;
    setSending(false);
    if (result.ok) {
      void haptics.success();
      onSent?.();
      close();
      return;
    }
    if (result.error === 'daily_limit') {
      appAlert('Good Vibes sent', 'You can send one Good Vibes message each day. Come back tomorrow!');
    } else if (result.error === 'not_paired') {
      appAlert('No paired person', 'Pair with someone before sending Good Vibes.');
    } else {
      appAlert('Could not send', 'Please check your connection and try again.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.pickerCard}>
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Select Your Message</Text>
            <Pressable onPress={() => { void haptics.pageClose(); close(); }} hitSlop={12} style={styles.closeIcon}>
              <MaterialIcons name="close" size={24} color="#FFF8E9" />
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.messageScroll,
              selected !== null && styles.messageGridWithSend,
            ]}
          >
            <FixedColumnGrid
              data={GOOD_VIBE_MESSAGES}
              columns={2}
              columnGap={12}
              rowGap={12}
              keyExtractor={(message) => message}
              renderItem={(message, index) => {
                const active = selected === index;
                return (
                  <Pressable
                    onPress={() => { void haptics.light(); setSelected(index); }}
                    style={[styles.messageCard, active && styles.messageCardSelected]}
                  >
                    <ExpoImage
                      source={GOOD_VIBE_ART[index]}
                      style={styles.messageArtwork}
                      contentFit="contain"
                      accessibilityLabel={message}
                    />
                    <Text style={styles.messageText}>{message}</Text>
                  </Pressable>
                );
              }}
            />
          </ScrollView>
          {selected !== null && (
            <View style={[styles.sendButtonWrap, sending && styles.sendButtonDisabled]}>
              <View pointerEvents="none" style={styles.sendButtonBacking} />
              <Pressable
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel={sending ? 'Sending Good Vibe' : 'Send Good Vibe'}
                accessibilityState={{ disabled: sending }}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.sendButton,
                  pressed && !sending && styles.sendButtonPressed,
                ]}
              >
                <Text style={styles.sendText}>{sending ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Global receiver: read once at launch/foreground, then react to the recipient's
 * database events. This keeps in-app delivery immediate without a permanent
 * minute-by-minute network poll.
 */
export function GoodVibesInboxGate() {
  const [vibe, setVibe] = useState<GoodVibeInboxItem | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const vibeRef = useRef<GoodVibeInboxItem | null>(null);
  const replyToIdRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const dismissed = useRef(new Set<string>());
  const segments = useSegments();
  const homeEntry = useHomeEntry();
  const active = useActiveModalSlot();
  const [appState, setAppState] = useState(AppState.currentState);
  const homeLoading = isHomeEntryRoute(segments) && (homeEntry.pending || homeEntry.resumeRequired);
  const eligible = (segments as readonly string[]).includes('(tabs)') && appState === 'active' && !homeLoading;

  useEffect(() => {
    if (eligible && (vibe || replyToId)) requestModalSlot('good-vibe');
    return () => releaseModalSlot('good-vibe');
  }, [eligible, vibe, replyToId]);

  const check = useCallback(async () => {
    // Never consume a message while iOS has the app backgrounded. Timers can
    // briefly keep running during a state transition, but a Modal cannot be
    // relied on to become visible there.
    if (
      AppState.currentState !== 'active'
      || vibeRef.current
      || replyToIdRef.current
      || checkingRef.current
    ) return;
    checkingRef.current = true;
    const epoch = sessionEpoch();
    try {
      const incoming = await withDeadline(fetchUnreadGoodVibe());
      if (mounted.current && epoch === sessionEpoch() && incoming && !dismissed.current.has(incoming.id)) {
        vibeRef.current = incoming;
        setVibe(incoming);
      }
    } catch (error) { console.warn('[good-vibes] inbox failed:', error); }
    finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      setAppState(state);
      if (state === 'active') void check();
    });

    const unsubscribeRealtime = subscribeGoodVibeRealtime(() => {
      void check();
    });
    const unsubscribeIdentity = subscribeSessionIdentity(() => {
      vibeRef.current = null;
      replyToIdRef.current = null;
      dismissed.current.clear();
      setVibe(null);
      setReplyToId(null);
    });

    return () => {
      mounted.current = false;
      releaseModalSlot('good-vibe');
      subscription.remove();
      unsubscribeRealtime();
      unsubscribeIdentity();
    };
  }, [check]);

  function acknowledge(delivered: GoodVibeInboxItem | null) {
    if (!delivered) return;
    dismissed.current.add(delivered.id);
    // Keep the fetch gate closed until read_at is persisted. Clearing the
    // Modal state causes this effect to run again immediately, otherwise the
    // same still-unread row can flash a second time during that short window.
    checkingRef.current = true;
    void withDeadline(markGoodVibeRead(delivered.id)).catch(() => {}).finally(() => {
      checkingRef.current = false;
      if (mounted.current) void check();
    });
  }

  function dismiss() {
    const delivered = vibe;
    acknowledge(delivered);
    vibeRef.current = null;
    setVibe(null);
  }

  function dismissFromButton() {
    void haptics.pageClose();
    dismiss();
  }

  function reply() {
    const delivered = vibe;
    vibeRef.current = null;
    setVibe(null);
    if (delivered?.canReply) {
      replyToIdRef.current = delivered.id;
      setReplyToId(delivered.id);
    }
  }

  return (
    <>
      <Modal visible={!!vibe && eligible && active === 'good-vibe'} transparent animationType="fade" onRequestClose={dismiss}>
        <View style={styles.backdrop}>
          <View style={styles.inboxCard}>
            <Pressable onPress={dismissFromButton} hitSlop={12} style={styles.inboxClose}>
              <MaterialIcons name="close" size={24} color="#FFF8E9" />
            </Pressable>
            {vibe && (
              <>
                <View style={styles.senderRow}>
                  <UserAvatar
                    userId={vibe.senderUserId}
                    avatarUrl={vibe.senderAvatarUrl}
                    isDefaultAvatar={vibe.senderIsDefaultAvatar}
                    size={52}
                  />
                  <Text style={styles.senderName}>{vibe.senderName}</Text>
                </View>
                <Text style={styles.leftMessage}>Left you a message</Text>
                <View style={styles.inboxArtwork}>
                  <ExpoImage
                    source={GOOD_VIBE_ART[vibe.messageIndex]}
                    style={styles.inboxArtworkImage}
                    contentFit="contain"
                    accessibilityLabel={vibe.message}
                  />
                </View>
                {vibe.canReply && (
                  <Pressable onPress={reply} style={styles.replyButton}>
                    <Text style={styles.replyText}>Reply</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
      <GoodVibesPicker
        visible={!!replyToId && eligible && active === 'good-vibe'}
        replyToId={replyToId ?? undefined}
        onClose={() => {
          replyToIdRef.current = null;
          setReplyToId(null);
          void check();
        }}
        onSent={() => {
          if (replyToId) {
            checkingRef.current = true;
            dismissed.current.add(replyToId);
            void withDeadline(markGoodVibeRead(replyToId)).catch(() => {}).finally(() => {
              checkingRef.current = false;
              if (mounted.current) void check();
            });
          }
          replyToIdRef.current = null;
          setReplyToId(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(35, 24, 15, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 44,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    borderRadius: 34,
    backgroundColor: '#53351D',
    padding: 20,
  },
  modalTitleRow: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: '#FFF8E9', fontSize: 25, fontFamily: 'Inter_800ExtraBold', textAlign: 'center' },
  closeIcon: { position: 'absolute', right: 0, top: 3, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  messageScroll: { paddingVertical: 18 },
  messageGridWithSend: { paddingBottom: 94 },
  messageCard: {
    width: '100%',
    minHeight: 176,
    backgroundColor: '#FFF8E7',
    borderRadius: 25,
    borderWidth: 4,
    borderColor: 'transparent',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  messageCardSelected: { borderColor: '#FF7A32', backgroundColor: '#FFF1D4' },
  messageArtwork: { width: '100%', height: 104 },
  messageText: { color: '#24180F', fontSize: 15, lineHeight: 20, textAlign: 'center', fontFamily: 'Inter_700Bold' },
  sendButtonWrap: {
    position: 'absolute', left: 20, right: 20, bottom: 20, zIndex: 3,
  },
  sendButtonBacking: {
    position: 'absolute', left: 0, right: 0, top: 6, bottom: -6,
    borderRadius: 20, backgroundColor: '#C9A97C',
  },
  sendButton: {
    minHeight: 58, borderRadius: 20, backgroundColor: '#FFDC91',
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonPressed: { transform: [{ translateY: 3 }] },
  sendButtonDisabled: { opacity: 0.45 },
  sendText: { color: '#4C2E16', fontSize: 22, fontFamily: 'Inter_800ExtraBold' },
  inboxCard: { width: '100%', maxWidth: 480, borderRadius: 34, backgroundColor: '#53351D', padding: 28, alignItems: 'center' },
  inboxClose: { position: 'absolute', right: 14, top: 14, zIndex: 2 },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  senderName: { color: '#FFF8E9', fontSize: 26, fontFamily: 'Inter_800ExtraBold' },
  leftMessage: { color: '#FFF8E9', fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 28 },
  inboxArtwork: { width: '100%', minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  inboxArtworkImage: { width: '100%', height: 290 },
  replyButton: { width: '100%', minHeight: 60, borderRadius: 20, backgroundColor: '#FFDC91', alignItems: 'center', justifyContent: 'center' },
  replyText: { color: '#4C2E16', fontSize: 23, fontFamily: 'Inter_800ExtraBold' },
});
