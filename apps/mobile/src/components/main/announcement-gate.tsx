import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { getCurrentSession } from '@/lib/auth';
import {
  fetchUnreadAnnouncement,
  markAnnouncementRead,
  type Announcement,
} from '@/lib/announcements-api';

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
      void markAnnouncementRead(userId, next.id); // Q2 = read on display
    }
  }, []);

  useEffect(() => {
    void check(); // mount
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);

  if (!announcement) return null;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={() => setAnnouncement(null)}
    >
      <Pressable style={styles.backdrop} onPress={() => setAnnouncement(null)}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{announcement.title}</Text>
          <Text style={styles.body}>{announcement.content}</Text>
          <Pressable style={styles.button} onPress={() => setAnnouncement(null)}>
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
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 22,
  },
  title: {
    color: '#1F1147',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 10,
  },
  body: {
    color: '#4B4364',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 22,
  },
  button: {
    backgroundColor: '#EC4899',
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
});
