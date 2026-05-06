/**
 * Assets tab — Stage 3.9.B
 *
 * Two sub-tabs:
 *   - Collection: 48-keyword grid showing the user's published wisdom
 *     card progress. Tap a collected keyword to enter the keyword
 *     detail carousel (FlippableCard swipe view).
 *   - Assets: physical product ordering (Wisdom Book + Wisdom Cards
 *     deck) with unlock progress, shipping form, and order history.
 *     Payment integration is deferred to stage 5; the payment view
 *     renders a stub button.
 *
 * Sub-tab pattern matches Growth tab (3.9.A.2.1) for visual
 * consistency: pill labels with a purple underline on the active tab.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CollectionView } from '@/components/assets/collection-view';
import { AssetsView } from '@/components/assets/assets-view';

type SubTab = 'collection' | 'assets';

export default function AssetsTab() {
  const insets = useSafeAreaInsets();
  const [subTab, setSubTab] = useState<SubTab>('collection');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.segHeader}>
        <Pressable onPress={() => setSubTab('collection')} style={styles.segBtn}>
          <Text
            style={[styles.segText, subTab === 'collection' && styles.segTextActive]}
          >
            Collection
          </Text>
          {subTab === 'collection' ? <View style={styles.segUnderline} /> : null}
        </Pressable>
        <Pressable onPress={() => setSubTab('assets')} style={styles.segBtn}>
          <Text
            style={[styles.segText, subTab === 'assets' && styles.segTextActive]}
          >
            Assets
          </Text>
          {subTab === 'assets' ? <View style={styles.segUnderline} /> : null}
        </Pressable>
      </View>

      {subTab === 'collection' ? <CollectionView /> : <AssetsView />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  segHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  segBtn: {
    paddingVertical: 10,
    marginRight: 24,
    position: 'relative',
  },
  segText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 16,
    fontWeight: '700',
  },
  segTextActive: {
    color: '#C084FC',
  },
  segUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#A855F7',
  },
});
