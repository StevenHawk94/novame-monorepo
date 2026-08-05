import { useEffect, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import { getCurrentSession } from '@/lib/auth';
import { refreshAllCaches } from '@/lib/cache-refresh-all';
import { hideResumeOverlay } from '@/lib/background-resume-store';

/**
 * Full-screen overlay shown when the app returns from a long background.
 *
 * Two thirds of this file used to be study-claim pre-settlement: an ownership
 * flag handed to the in-session detector so its 30s poll could not fire a
 * second POST and double-settle into a flashed "+0 XP". The willpower system
 * is gone (D5) and so is all of it. What remains is what the overlay was
 * always for: hold the launch screen while the caches warm.
 *
 * The 8s cap stays. It does not stop the work -- refreshAllCaches keeps going
 * -- it caps how long a bad network may strand the user behind a purple
 * rectangle.
 */
// Mirrors the current native splash (grid ground + bunny head on beige) so
// the resume flash reads as one continuous screen.
const SPLASH = require('../../../assets/splash-full.png');
const RESUME_TIMEOUT_MS = 8000;

export function BackgroundResumeOverlay() {
  const hiddenRef = useRef(false);

  useEffect(() => {
    const hideOverlay = () => {
      if (hiddenRef.current) return;
      hiddenRef.current = true;
      hideResumeOverlay();
    };

    const timer = setTimeout(hideOverlay, RESUME_TIMEOUT_MS);

    void (async () => {
      try {
        const session = await getCurrentSession();
        const userId = session?.user?.id;
        if (userId) await refreshAllCaches(userId);
      } catch (e) {
        console.warn('[resume-overlay] refresh failed (non-fatal):', e);
      } finally {
        clearTimeout(timer);
        hideOverlay();
      }
    })();

    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.root}>
        <ExpoImage source={SPLASH} style={StyleSheet.absoluteFill} contentFit="cover" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8E2C1' },
});
