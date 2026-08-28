import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { sessionEpoch } from '@/lib/session-lifecycle';
import { withDeadline } from '@/lib/async-lifecycle';
import { Image as ExpoImage } from 'expo-image';

import { haptics } from '@/lib/haptics';

import { getCurrentSession } from '@/lib/auth';
import {
  clearPreparedAnnouncement,
  markAnnouncementRead,
  prepareUnreadAnnouncement,
  type Announcement,
} from '@/lib/announcements-api';
import {
  requestModalSlot,
  releaseModalSlot,
  useActiveModalSlot,
} from '@/lib/modal-coordinator';

const THROTTLE_MS = 10 * 60 * 1000; // Q1b = 10 min between foreground checks

/**
 * AnnouncementGate -- self-contained Home overlay for admin announcements.
 *
 * Product decisions Q1=B / Q2=A / Q3=A / Q4=A:
 *   - Check for an unread announcement on mount and on app foreground,
 *     throttled to once per 10 min (server "already-read" set is what truly
 *     prevents repeats; the throttle just saves redundant GETs).
 *   - Show at most one (backend returns the highest-priority unread).
 *   - Mark it read the instant it displays, so it never re-pops for this
 *     user -- even if they swipe it away immediately.
 *   - One simple modal (title + content + dismiss). type is not styled
 *     differently and there is no CTA (app_announcements has no link field).
 *
 * Self-contained: resolves the session itself, so mounting it needs no props.
 * RN Modal renders via portal, so its position in the Home tree is irrelevant.
 */
export function AnnouncementGate() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [announcementUserId, setAnnouncementUserId] = useState<string | null>(null);
  const lastCheckRef = useRef(0);
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const checking = useRef(false);
  const readId = useRef<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  // Long admin messages scroll instead of pushing the CTA off short screens.
  const { height: winHeight } = useWindowDimensions();

  const check = useCallback(async () => {
    if (!focusedRef.current || AppState.currentState !== 'active' || checking.current) return;
    const now = Date.now();
    if (now - lastCheckRef.current < THROTTLE_MS) return;
    const epoch = sessionEpoch();
    checking.current = true;
    try {
      const session = await withDeadline(getCurrentSession());
      const userId = session?.user?.id;
      if (!userId || !focusedRef.current || epoch !== sessionEpoch()) return;

      const next = await withDeadline(prepareUnreadAnnouncement(userId));
      if (!focusedRef.current || epoch !== sessionEpoch()) return;
      if (next) {
        // Only a fully prepared announcement consumes the throttle window. A
        // slow/failed image remains eligible for the next foreground retry.
        lastCheckRef.current = now;
        setAnnouncementUserId(userId);
        setAnnouncement(next);
        // Request a slot without marking it read; only onShow does that.
      }
    } catch (error) { console.warn('[announcement] preparation failed:', error); }
    finally { checking.current = false; }
  }, []);

  const active = useActiveModalSlot();
  const isActive = focused && appState === 'active' && active === 'announcement';

  const announcementId = announcement?.id;
  useEffect(() => {
    if (focused && appState === 'active' && announcement) requestModalSlot('announcement');
    return () => releaseModalSlot('announcement');
  }, [focused, appState, announcement]);

  // Release the slot when this gate unmounts (e.g. user navigates away from
  // Home) so a stuck request never blocks claim/skin.
  useEffect(() => {
    return () => { focusedRef.current = false; releaseModalSlot('announcement'); };
  }, []);

  useEffect(() => {
    if (focused) void check();
    const sub = AppState.addEventListener('change', (state) => {
      setAppState(state);
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [check, focused]);

  // Only render when we are the active (highest-priority requested) modal.
  if (!announcement || !isActive) return null;

  const close = () => {
    if (announcementUserId && announcementId) {
      clearPreparedAnnouncement(announcementUserId, announcementId);
    }
    setAnnouncement(null);
    setAnnouncementUserId(null);
    releaseModalSlot('announcement');
  };

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={close}
      onShow={() => {
        if (announcementId && announcementUserId && readId.current !== announcementId) {
          readId.current = announcementId;
          void markAnnouncementRead(announcementUserId, announcementId);
        }
      }}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{announcement.title}</Text>
          <ScrollView
            style={{ maxHeight: winHeight * 0.62, alignSelf: 'stretch' }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <ExpoImage
              source={{ uri: announcement.image_url! }}
              style={styles.image}
              contentFit="contain"
              cachePolicy="disk"
            />
            <Text style={styles.body}>{announcement.content}</Text>
          </ScrollView>
          <Pressable style={styles.button} onPress={() => { void haptics.pageClose(); close(); }}>
            <Text style={styles.buttonText}>Start Today</Text>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 8, 5, 0.64)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 390,
    maxHeight: '90%',
    backgroundColor: '#6E3F2C',
    borderRadius: 28,
    paddingTop: 30,
    paddingBottom: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: '#F9EDD4',
    marginBottom: 22,
  },
  body: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 24,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  button: {
    backgroundColor: '#FFF4D8',
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  buttonText: {
    color: '#4A2F1E',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
});
