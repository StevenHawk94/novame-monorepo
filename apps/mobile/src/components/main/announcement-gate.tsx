import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { getCurrentSession } from '@/lib/auth';
import {
  fetchUnreadAnnouncement,
  markAnnouncementRead,
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
  const lastCheckRef = useRef(0);
  // Long admin messages scroll instead of pushing "Got it" off short screens.
  const { height: winHeight } = useWindowDimensions();

  const check = useCallback(async () => {
    const now = Date.now();
    if (now - lastCheckRef.current < THROTTLE_MS) return;

    const session = await getCurrentSession();
    const userId = session?.user?.id;
    if (!userId) return;

    // Advance the throttle only once we actually have a user, so a
    // signed-out moment does not burn the window.
    lastCheckRef.current = now;

    const next = await fetchUnreadAnnouncement(userId);
    if (next) {
      setAnnouncement(next);
      // Coordinator (announcement > claim > skin): request a slot; do NOT
      // mark read here. markRead fires only when we actually become the
      // active modal and render (see effect below), so a queued-but-hidden
      // announcement is never marked seen.
      requestModalSlot('announcement');
    }
  }, []);

  const active = useActiveModalSlot();
  const isActive = active === 'announcement';

  // Mark read the instant we actually display (active + have content) -- Q2
  // "read on display" semantics, now coordinated so it never fires while
  // queued behind a higher-priority modal (none exists above announcement,
  // but this keeps the rule uniform and correct if priorities change).
  const announcementId = announcement?.id;
  useEffect(() => {
    if (!isActive || !announcementId) return;
    let cancelled = false;
    void getCurrentSession().then((session) => {
      const userId = session?.user?.id;
      if (!cancelled && userId) void markAnnouncementRead(userId, announcementId);
    });
    return () => {
      cancelled = true;
    };
  }, [isActive, announcementId]);

  // Release the slot when this gate unmounts (e.g. user navigates away from
  // Home) so a stuck request never blocks claim/skin.
  useEffect(() => {
    return () => releaseModalSlot('announcement');
  }, []);

  useEffect(() => {
    void check(); // mount
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);

  // Only render when we are the active (highest-priority requested) modal.
  if (!announcement || !isActive) return null;

  const close = () => {
    setAnnouncement(null);
    releaseModalSlot('announcement');
  };

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={close}
    >
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Image
            source={require('../../../assets/adaptive-icon.png')}
            style={styles.icon}
            resizeMode="contain"
          />
          <Text style={styles.title}>{announcement.title}</Text>
          <ScrollView
            style={{ maxHeight: winHeight * 0.45, alignSelf: 'stretch' }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.body}>{announcement.content}</Text>
          </ScrollView>
          <Pressable style={styles.button} onPress={close}>
            <Text style={styles.buttonText}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 8, 35, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#4A3423',
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  icon: {
    width: 64,
    height: 64,
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 14,
  },
  body: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#C96F2A',
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
});
