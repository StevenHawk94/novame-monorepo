/**
 * WisdomLogRow — Stage 3.9.A.2.4
 *
 * Single row in the Growth tab's My Logs feed. Mirrors the social-feed
 * pattern: avatar + display_name + relative-time + truncated text +
 * Read/Insight action buttons + overflow menu.
 *
 * The row is non-interactive at the surface level (no whole-row tap);
 * actions are explicit through the labeled buttons. This avoids
 * accidental navigation when the user is reading the preview.
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { formatRelativeShort } from '@/lib/relative-time';
import type { WisdomLog } from '@/lib/wisdoms-api';
import { haptics } from '@/lib/haptics';

export type WisdomLogRowProps = {
  wisdom: WisdomLog;
  authorName: string;
  authorAvatar: string | null;
  onRead: (id: string) => void;
  onInsight: (id: string) => void;
  onMenu: (id: string) => void;
};

const FALLBACK_TEXT = '(no transcript)';

export function WisdomLogRow({
  wisdom,
  authorName,
  authorAvatar,
  onRead,
  onInsight,
  onMenu,
}: WisdomLogRowProps) {
  const initial = (authorName?.[0] ?? '?').toUpperCase();
  const preview = wisdom.text?.trim() || FALLBACK_TEXT;
  const time = formatRelativeShort(wisdom.created_at);

  return (
    <View style={styles.card}>
      {/* Header: avatar + name + time + menu */}
      <View style={styles.headerRow}>
        <View style={styles.avatarWrap}>
          {authorAvatar ? (
            <Image source={{ uri: authorAvatar }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{initial}</Text>
            </View>
          )}
        </View>
        <Text style={styles.author}>{authorName}</Text>
        <Text style={styles.time}>{time}</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => { void haptics.light(); onMenu(wisdom.id); }}
          hitSlop={10}
          style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="more-vert" size={22} color="rgba(255,255,255,0.6)" />
        </Pressable>
      </View>

      {/* Preview text */}
      <Text style={styles.preview} numberOfLines={3}>
        {preview}
      </Text>

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <Pressable
          onPress={() => { void haptics.light(); onRead(wisdom.id); }}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.actionBtnSecondary,
            pressed && { opacity: 0.85 },
          ]}
        >
          <MaterialCommunityIcons
            name="book-open-variant"
            size={18}
            color="#FFFFFF"
          />
          <Text style={styles.actionText}>Read</Text>
        </Pressable>
        <Pressable
          onPress={() => { void haptics.light(); onInsight(wisdom.id); }}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.actionBtnPrimary,
            pressed && { opacity: 0.85 },
          ]}
        >
          <MaterialCommunityIcons name="creation" size={18} color="#C4B5FD" />
          <Text style={[styles.actionText, styles.actionTextInsight]}>Insight</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#3B2D6E',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
  },
  avatarFallbackText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  author: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  time: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '500',
  },
  menuBtn: {
    padding: 4,
  },
  preview: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
  },
  actionBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionBtnPrimary: {
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  actionTextInsight: {
    color: '#C4B5FD',
  },
});
