/**
 * SeekCardRow — Stage 3.9.A.1.3
 *
 * Single wisdom card row inside Seek Question Detail. Wraps
 * FlippableCard with:
 *   - bookmark save button overlay (top-right of the card)
 *   - author label (name + avatar) below the card
 *
 * Save state is owned by the parent screen and passed in via props.
 * Tapping the bookmark fires onToggleSave; the parent calls the API
 * and updates the saved flag optimistically.
 *
 * Self-card guard: when canSave=false (the user is the card's author),
 * the bookmark is hidden.
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { FlippableCard } from '@/components/cards/FlippableCard';
import type { SeekCard } from '@/lib/seek-types';

export type SeekCardRowProps = {
  card: SeekCard;
  cardWidth: number;
  saved: boolean;
  canSave: boolean;
  saving: boolean;
  onToggleSave: () => void;
};

export function SeekCardRow({
  card,
  cardWidth,
  saved,
  canSave,
  saving,
  onToggleSave,
}: SeekCardRowProps) {
  // Derive R2 filename for FlippableCard. keyword_id format is
  // {category}-{name}, e.g. "mind-clarity". Front: {keyword_id}-front.webp,
  // back: {category}-back.webp.
  const frontFilename = card.keyword_id ? `${card.keyword_id}-front.webp` : null;
  const backCategory = card.keyword_id ? card.keyword_id.split('-')[0] : null;
  const backFilename = backCategory ? `${backCategory}-back.webp` : null;

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

        {/* Bookmark — only if user can save this card */}
        {canSave ? (
          <Pressable
            onPress={onToggleSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.bookmark,
              pressed && styles.bookmarkPressed,
            ]}
            hitSlop={8}
          >
            <MaterialIcons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={saved ? '#A855F7' : '#FFFFFF'}
            />
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
  bookmark: {
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
  bookmarkPressed: {
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
});
