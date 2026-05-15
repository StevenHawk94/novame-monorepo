/**
 * SeekCardRow — Stage 3.9.A.1.3 + Stage 6 block-update.
 *
 * Single wisdom card row inside Seek Question Detail. Wraps
 * FlippableCard with:
 *   - "more options" menu (top-right of the card) -> Block action
 *   - author label (name + avatar) below the card
 *
 * Stage 6 change: the previous bookmark/save button was replaced with
 * a three-dot menu. Tapping the menu surfaces a single Block action;
 * tapping Block fires onBlock and the parent hides the card from the
 * list (and persists the block server-side).
 *
 * Self-card guard: canBlock=false on the user's own cards. They
 * shouldn't be able to block their own posts.
 *
 * Menu implementation: RN <Modal> with transparent backdrop. Using
 * a Modal (rather than absolute-positioned views) means the menu
 * floats above the card list correctly regardless of parent
 * overflow/clipping, and the backdrop Press dismiss is free.
 */
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { FlippableCard } from '@/components/cards/FlippableCard';
import { haptics } from '@/lib/haptics';
import type { SeekCard } from '@/lib/seek-types';

export type SeekCardRowProps = {
  card: SeekCard;
  cardWidth: number;
  canBlock: boolean;
  onBlock: () => void;
};

export function SeekCardRow({
  card,
  cardWidth,
  canBlock,
  onBlock,
}: SeekCardRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Derive R2 filename for FlippableCard. keyword_id format is
  // {category}-{name}, e.g. "mind-clarity". Front: {keyword_id}-front.webp,
  // back: {category}-back.webp.
  const frontFilename = card.keyword_id ? `${card.keyword_id}-front.webp` : null;
  const backCategory = card.keyword_id ? card.keyword_id.split('-')[0] : null;
  const backFilename = backCategory ? `${backCategory}-back.webp` : null;

  const openMenu = () => {
    void haptics.light();
    setMenuOpen(true);
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  const handleBlock = () => {
    // medium haptic: block is a more impactful action than a casual tap
    void haptics.medium();
    setMenuOpen(false);
    onBlock();
  };

  return (
    <View style={styles.row}>
      {/* Card */}
      <View style={styles.cardWrap}>
        <FlippableCard
          frontFilename={frontFilename}
          backFilename={backFilename}
          quoteShort={card.quote_short || ''}
          insightFull={card.insight_full || ''}
          width={cardWidth}
          defaultSide="back"
        />

        {/* More-options trigger — only on cards the user can block */}
        {canBlock ? (
          <Pressable
            onPress={openMenu}
            style={({ pressed }) => [
              styles.menuTrigger,
              pressed && styles.menuTriggerPressed,
            ]}
            hitSlop={8}
          >
            <MaterialIcons name="more-horiz" size={22} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>

      {/* Author */}
      <View style={styles.author}>
        <View style={styles.avatar}>
          {card.creator_avatar ? (
            <Image source={{ uri: card.creator_avatar }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarFallback}>🔮</Text>
          )}
        </View>
        <Text style={styles.authorName} numberOfLines={1}>
          {card.creator_name || 'WisdomSeeker'}
        </Text>
        {card.saved_count != null && card.saved_count > 0 ? (
          <View style={styles.savedBadge}>
            <MaterialIcons name="bookmark" size={11} color="rgba(168,85,247,0.85)" />
            <Text style={styles.savedBadgeText}>{card.saved_count}</Text>
          </View>
        ) : null}
      </View>

      {/* Block menu (Modal) */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
      >
        {/* Full-screen backdrop. Tapping anywhere outside the menu
            card dismisses it. The Pressable handles outside-tap
            dismiss; the inner card stops propagation. */}
        <Pressable style={styles.backdrop} onPress={closeMenu}>
          <Pressable
            style={styles.menuCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Pressable
              onPress={handleBlock}
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.menuItemPressed,
              ]}
            >
              <MaterialIcons name="block" size={20} color="#EF4444" />
              <Text style={styles.menuItemText}>Block this wisdom</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    marginBottom: 32,
  },
  cardWrap: {
    position: 'relative',
  },
  menuTrigger: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTriggerPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.92 }],
  },
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    fontSize: 12,
  },
  authorName: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.15)',
  },
  savedBadgeText: {
    color: 'rgba(168,85,247,0.85)',
    fontSize: 11,
    fontWeight: '700',
  },
  // ---- Block menu ----
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  menuCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1E1A3E',
    borderRadius: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemPressed: {
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  menuItemText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
