import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

import { appAlert } from '@/components/ui/app-dialog';
import { UserAvatar } from '@/components/ui/user-avatar';
import { haptics } from '@/lib/haptics';
import { GOOD_VIBE_ART } from '@/lib/icons';
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
};

export function GoodVibesPicker({ visible, onClose, onSent }: PickerProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  async function submit() {
    if (selected === null || sending) return;
    setSending(true);
    const result = await sendGoodVibe(selected);
    setSending(false);
    if (result.ok) {
      void haptics.success();
      onClose();
      onSent?.();
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.pickerCard}>
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Select Your Message</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeIcon}>
              <MaterialIcons name="close" size={24} color="#FFF8E9" />
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.messageGrid}
          >
            {GOOD_VIBE_MESSAGES.map((message, index) => {
              const active = selected === index;
              return (
                <Pressable
                  key={message}
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
            })}
          </ScrollView>
          <Pressable
            disabled={selected === null || sending}
            onPress={() => void submit()}
            style={[styles.sendButton, (selected === null || sending) && styles.sendButtonDisabled]}
          >
            <Text style={styles.sendText}>{sending ? 'Sending…' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Global receiver: checks at launch, foreground, and once a minute in-app. */
export function GoodVibesInboxGate() {
  const [vibe, setVibe] = useState<GoodVibeInboxItem | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);

  const check = useCallback(async () => {
    if (vibe || replyOpen) return;
    const incoming = await fetchUnreadGoodVibe();
    if (!incoming) return;
    // Mark on delivery so reconnects do not repeatedly interrupt the user.
    await markGoodVibeRead(incoming.id);
    setVibe(incoming);
  }, [replyOpen, vibe]);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    const timer = setInterval(() => void check(), 60_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [check]);

  function reply() {
    setVibe(null);
    setReplyOpen(true);
  }

  return (
    <>
      <Modal visible={!!vibe} transparent animationType="fade" onRequestClose={() => setVibe(null)}>
        <View style={styles.backdrop}>
          <View style={styles.inboxCard}>
            <Pressable onPress={() => setVibe(null)} hitSlop={12} style={styles.inboxClose}>
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
                <Pressable onPress={reply} style={styles.replyButton}>
                  <Text style={styles.replyText}>Reply</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
      <GoodVibesPicker visible={replyOpen} onClose={() => setReplyOpen(false)} />
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
  messageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 18 },
  messageCard: {
    width: '48%',
    minHeight: 176,
    flexGrow: 1,
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
  sendButton: { minHeight: 58, borderRadius: 20, backgroundColor: '#FFDC91', alignItems: 'center', justifyContent: 'center' },
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
