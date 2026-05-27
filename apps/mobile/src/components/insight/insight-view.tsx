/**
 * InsightView — Stage 6 Wisdom Insight redesign
 *
 * Pure presentation of a generated wisdom_card payload. Used by:
 *   - record.tsx (after publishing a new wisdom, full data available)
 *   - wisdom-insight.tsx modal (My Logs re-view, cardCollection=null
 *     because "just unlocked" semantics don't apply to historical
 *     wisdoms)
 *
 * The 7-section layout maps to the design figure:
 *   1. Card Collection notification (new-type vs added-to-collection)
 *   2. "Wisdom Behind Your Words" page title
 *   3. FlippableCard (front: keyword art + quote, back: insight_full)
 *      + "Tap to Flip" hint
 *   4. "Your Inner Profile" band:
 *      4a. Per-wisdom server-rolled "people resonated" count (30-999),
 *          persisted on wisdom_cards.community_count. Hidden when null
 *          (historical wisdoms pre-migration 20260525123624).
 *      4b. Aspire progress bar — keyword label + current score%.
 *          deltaPercent shown only when non-null (record.tsx PhaseInsight
 *          shows +2 / -2; My Logs wisdom-insight passes null so the delta
 *          chip is hidden since publish-time delta isn't replayable).
 *      4c. Big emotion keyword + emotion illustration
 *   5. 3-part Reframe (Mirror Hook / Flipped Lens / Permission Slip)
 *      rendered as purple-titled prose sections (no card chrome)
 *   6. "Ask Yourself This" dark card with the question only.
 *      (validation preamble removed in commit 30; legacy rows skip
 *      the validation field even when present.)
 *   7. "Today's Missions to Grow" purple card with task_1 + task_2
 *
 * Legacy compatibility:
 *   - card.reframe == null  -> Section 5 falls back to splitTitleBody
 *     (card.card_b) for a single-section render
 *   - card.reflective_question == null  -> Section 6 hides
 *   - cardCollection == null  -> Section 1 hides (My Logs entry)
 *   - aspireImpact == null  -> Section 4b hides
 */
import { useMemo } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// Stage 6.InsightPrefetch: switched from react-native's ImageBackground
// + Image to expo-image's equivalents. expo-image and react-native use
// separate caches; the prefetch() warm-up in record.tsx (PhasePublishing)
// only populates the expo-image cache, so the renderers had to be on
// the same cache for the prefetch to actually skip the first-decode jank.
// expo-image's ImageBackground was added in #22347 and exposes the same
// style / imageStyle / children API as the RN version, so the swap is
// 1:1 except resizeMode -> contentFit (expo-image's standard prop).
import { ImageBackground, Image as RNImage } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';

import { FlippableCard } from '@/components/cards/FlippableCard';
import { getStandardCardWidth } from '@/lib/card-dimensions';
import { getCachedCharacterState } from '@/lib/character-state';
import type {
  AspireImpact,
  ReflectiveQuestion,
  ReframeData,
} from '@/lib/wisdoms-api';

// ============================================================
// Static asset requires (RN bundler resolves at build time so the
// images are packaged into the app binary — no network latency).
// ============================================================
// Stage 6.InsightPrefetch: cards-background.webp moved from bundle
// require() to an R2-hosted remote URI. Two reasons:
//
//   1. expo-image's prefetch(urls) accepts only string URLs, NOT
//      require() asset ids. With a bundle require source the
//      prefetch cache key (URI form from resolveAssetSource) and
//      the render cache key (number form from require) are
//      different, so the prefetch warm-up never benefits the
//      render path. The user sees a 3-frame staged paint:
//      (a) no background, (b) front card image appears, (c)
//      background finally appears with the rest of the
//      cards-background-anchored UI (collection header, title,
//      tap-to-flip hint).
//
//   2. The same R2 URI is already used by keyword-detail.tsx, so
//      this aligns insight-view.tsx with project convention and
//      means the asset is downloaded + disk-cached by expo-image
//      ONCE per device, then reused everywhere.
//
// The remote file needs to be uploaded to R2 at the path below
// alongside this code deploy. R2 file size should mirror the
// bundle file (~24 KB at time of writing).
const CARDS_BACKGROUND = { uri: 'https://media.novameapp.com/cards-background.webp' };

// Stage 6 follow-up: avatar for the new Truth-Telling Peer block
// (Section C). Reuses the app's adaptive-icon (the same purple cat
// graphic that ships with the app bundle) so no new asset upload
// or R2 plumbing is needed. require() at module scope -- resolved
// once at app start, cached by Metro thereafter.
const PEER_AVATAR = require('../../../assets/adaptive-icon.png');
const EMOTION_IMAGES = {
  sad: require('../../../assets/images/insight/sad.webp'),
  happy: require('../../../assets/images/insight/happy.webp'),
  excited: require('../../../assets/images/insight/excited.webp'),
  peace: require('../../../assets/images/insight/peace.webp'),
  anxious: require('../../../assets/images/insight/anxious.webp'),
  exhausting: require('../../../assets/images/insight/exhausting.webp'),
  fine: require('../../../assets/images/insight/fine.webp'),
  angry: require('../../../assets/images/insight/angry.webp'),
} as const;

type EmotionCategory = keyof typeof EMOTION_IMAGES;

// ============================================================
// Fine-grained emotion keyword -> broad category lookup. AI returns
// a fine-grained keyword like "Joyful"; this maps to the broad
// "happy" category to pick which illustration to render.
//
// Fallback for unrecognized words = 'fine' (neutral / mellow).
// ============================================================
const EMOTION_TO_CATEGORY: Record<string, EmotionCategory> = {
  // Sad
  Discouraged: 'sad', Bitter: 'sad', Sad: 'sad', Apathetic: 'sad',
  Disappointed: 'sad', Dull: 'sad', Powerless: 'sad', Upset: 'sad', Distraught: 'sad',
  Sadness: 'sad',
  // Happy
  Radiant: 'happy', Overjoyed: 'happy', Proud: 'happy', Fulfilled: 'happy',
  Delighted: 'happy', Joyful: 'happy', Elated: 'happy', Hopeful: 'happy',
  Optimistic: 'happy', Connected: 'happy', Happy: 'happy', Cheerful: 'happy',
  Grateful: 'happy', Pleasant: 'happy',
  // Excited
  Thrilled: 'excited', Pumped: 'excited', Triumphant: 'excited', Energized: 'excited',
  Motivated: 'excited', Empowered: 'excited', Ecstatic: 'excited', Inspired: 'excited',
  Exhilarated: 'excited', Driven: 'excited', Buzzing: 'excited', 'On Fire': 'excited',
  Glowing: 'excited',
  // Peace
  Calm: 'peace', Content: 'peace', Reassured: 'peace', Relaxed: 'peace',
  Satisfied: 'peace', Peaceful: 'peace', Confident: 'peace', Cozy: 'peace',
  AtEase: 'peace', 'Steady-Good': 'peace', Comfortable: 'peace', Warm: 'peace',
  'Clear-headed': 'peace',
  // Anxious
  Worried: 'anxious', Pressured: 'anxious', Impatient: 'anxious', Anxious: 'anxious',
  Nervous: 'anxious', Uneasy: 'anxious', Concerned: 'anxious', Unsettled: 'anxious',
  Stressed: 'anxious', Panicked: 'anxious', Freaked: 'anxious', Restless: 'anxious',
  Terrified: 'anxious', Startled: 'anxious', 'On Edge': 'anxious', Petrified: 'anxious',
  Overwhelmed: 'anxious', Alarmed: 'anxious', 'Worked Up': 'anxious', Shocked: 'anxious',
  Irrational: 'anxious',
  // Exhausting
  Drained: 'exhausting', Sluggish: 'exhausting', Flat: 'exhausting', Sleepy: 'exhausting',
  // Fine
  Neutral: 'fine', Composed: 'fine', Simple: 'fine', Mellow: 'fine', Mild: 'fine',
  Grounded: 'fine', Unbothered: 'fine', Soft: 'fine', Balanced: 'fine', Even: 'fine',
  Unemotional: 'fine', Easy: 'fine', Present: 'fine', 'Low-key': 'fine', Plain: 'fine',
  Steady: 'fine', Quiet: 'fine', Meh: 'fine', Reflective: 'fine', Thoughtful: 'fine',
  // Angry
  Resentful: 'angry', Irritated: 'angry', Frustrated: 'angry', Enraged: 'angry',
  Outraged: 'angry', Agitated: 'angry', Tense: 'angry', Furious: 'angry',
};

function emotionToCategory(emotion: string): EmotionCategory {
  return EMOTION_TO_CATEGORY[emotion] ?? 'fine';
}

// ============================================================
// Slug -> display-name map (kept for record.tsx import compat).
// Server returns keyword_id like `mind-clarity`; humans see 'Clarity'.
// ============================================================
export const KEYWORD_ID_TO_NAME: Record<string, string> = {
  'mind-clarity': 'Clarity', 'mind-grounding': 'Grounding', 'mind-focus': 'Focus',
  'mind-curiosity': 'Curiosity', 'mind-stillness': 'Stillness', 'mind-objectivity': 'Objectivity',
  'mind-adaptability': 'Adaptability', 'mind-unlearning': 'Unlearning', 'mind-vision': 'Vision',
  'mind-acceptance': 'Acceptance', 'mind-humor': 'Humor', 'mind-intuition': 'Intuition',
  'heart-resilience': 'Resilience', 'heart-boundaries': 'Boundaries', 'heart-self-compassion': 'Self-Compassion',
  'heart-courage': 'Courage', 'heart-vulnerability': 'Vulnerability', 'heart-empathy': 'Empathy',
  'heart-gratitude': 'Gratitude', 'heart-patience': 'Patience', 'heart-forgiveness': 'Forgiveness',
  'heart-release': 'Release', 'heart-balance': 'Balance', 'heart-joy': 'Joy',
  'action-initiative': 'Initiative', 'action-consistency': 'Consistency', 'action-discipline': 'Discipline',
  'action-decisiveness': 'Decisiveness', 'action-purpose': 'Purpose', 'action-rest': 'Rest',
  'action-resourcefulness': 'Resourcefulness', 'action-accountability': 'Accountability',
  'action-boldness': 'Boldness', 'action-endurance': 'Endurance', 'action-communication': 'Communication',
  'action-momentum': 'Momentum',
  'connection-sovereignty': 'Sovereignty', 'connection-authenticity': 'Authenticity',
  'connection-inspiration': 'Inspiration', 'connection-generosity': 'Generosity',
  'connection-trust': 'Trust', 'connection-reciprocity': 'Reciprocity',
  'connection-collaboration': 'Collaboration', 'connection-leadership': 'Leadership',
  'connection-harmony': 'Harmony', 'connection-legacy': 'Legacy', 'connection-respect': 'Respect',
  'connection-loyalty': 'Loyalty',
};

/**
 * Legacy "Title: xxx\n<body>" parser. Pre-Stage-6 wisdoms stored the
 * dynamic title merged into the body string. Used as the fallback path
 * when card.reframe is null (no 3-part structure available).
 */
export function splitTitleBody(raw: string): { title: string; body: string } {
  if (!raw) return { title: '', body: '' };
  const m = raw.match(/^Title:\s*(.+?)\n([\s\S]*)$/);
  if (m) return { title: m[1].trim(), body: m[2].trim() };
  return { title: '', body: raw };
}

// ============================================================
// Types
// ============================================================

/**
 * Card payload shape consumed by InsightView. Wider than
 * WisdomCardEmbed because record.tsx may also pass an in-memory
 * just-published card that hasn't been re-fetched yet.
 */
export type InsightCardData = {
  keyword_id?: string | null;
  keyword?: string | null;
  quote_short?: string | null;
  insight_full?: string | null;
  // Legacy single-block fields (rendered only when reframe is null)
  card_b?: string | null;
  card_c?: string | null;
  task_1?: string | null;
  task_2?: string | null;
  // Stage 6 redesigned fields
  reframe?: ReframeData | null;
  reflective_question?: ReflectiveQuestion | null;
  aspire_impacts?: AspireImpact[] | null;
  // Stage 6 Bug 3: per-wisdom server-rolled "people resonated" count.
  // Persisted on wisdom_cards.community_count. Optional + nullable
  // because wisdom-insight.tsx (My Logs) reads it off InsightCardData
  // and historical rows have NULL. record.tsx PhaseInsight also lands
  // here via the same InsightCardData type. InsightView Block 4a
  // hides when null.
  community_count?: number | null;
  // Stage 6 follow-up: Section C "Truth-Telling Peer" text. Same
  // optionality semantics as community_count -- nullable for pre-
  // migration rows. InsightView's new chat-bubble block (rendered
  // between Block 3 and Block 4) hides when null/empty.
  peer_comment?: string | null;
};

/**
 * Card Collection notification info. Computed by the parent
 * component from the user's cached wisdoms list before passing in
 * so InsightView doesn't have to query storage during render.
 */
export type CardCollectionInfo = {
  isNewType: boolean;
  keyword: string;
  typesCollected: number;
  cardsCollectedForKeyword: number;
};

/**
 * Aspire impact display data. Computed by the parent from the AI's
 * aspire_impacts array (we pick element [0]) and the user's current
 * aspire_scores from /api/character-state or profile.
 */
export type AspireImpactDisplay = {
  keyword: string;
  // null when no delta should be displayed (e.g. My Logs re-view —
  // showing the publish-time +/- on a historical wisdom would be
  // misleading; only the current score and keyword label render).
  // record.tsx (post-publish) sets +2 / -2; wisdom-insight.tsx sets null.
  deltaPercent: number | null;
  currentScore: number; // 0-100, drives the progress bar fill width
};

export type InsightViewProps = {
  card: InsightCardData | null;
  emotion: string;
  cardCollection: CardCollectionInfo | null;
  aspireImpact: AspireImpactDisplay | null;
  // Stage 6 Bug 3 fix: per-wisdom server-rolled "people resonated" count.
  // null when the wisdom has no persisted community_count column value
  // (historical wisdom_cards rows pre-migration 20260525123624). When
  // null, Block 4a (the big number + subtitle) is hidden — we don't
  // fabricate a number for historical data.
  communityCount: number | null;
  /**
   * Optional extra paddingTop added to Block 1+2's ImageBackground
   * topPurpleWrap. Used by record.tsx PhaseInsight to make room for
   * the iOS status bar while still letting the purple glow extend
   * into the safe area. wisdom-insight.tsx omits this prop (it has
   * its own back-button header handling the safe area), so default
   * 0 preserves the legacy visual.
   */
  topExtraPadding?: number;
};

// ============================================================
// Component
// ============================================================

export function InsightView({
  card,
  emotion,
  cardCollection,
  aspireImpact,
  communityCount,
  topExtraPadding = 0,
}: InsightViewProps) {
  const keywordId = card?.keyword_id ?? 'mind-clarity';
  const frontFilename = `${keywordId}-front.webp`;
  const backFilename = `${keywordId.split('-')[0]}-back.webp`;

  const quoteShort =
    card?.quote_short ?? 'Reflection turns experience into wisdom.';

  // Section 5: prefer Stage-6 reframe; fall back to legacy card_b
  // single-section render if reframe is missing.
  const reframe = card?.reframe ?? null;
  const legacyB = useMemo(() => splitTitleBody(card?.card_b ?? ''), [card?.card_b]);

  const reflective = card?.reflective_question ?? null;
  const hasTasks = !!(card?.task_1 || card?.task_2);

  // Emotion category for the illustration. Falls back to 'fine' for
  // unrecognized words.
  const emotionCategory = emotionToCategory(emotion);
  const emotionImage = EMOTION_IMAGES[emotionCategory];

  // Format community count with thousand separators (1203 -> "1,203").
  // Empty string when communityCount is null — Block 4a is gated on
  // the null check below and won't render this anyway, but the guard
  // prevents the .toLocaleString() crash if anything reaches this hook
  // unexpectedly.
  const communityCountStr = useMemo(
    () => (communityCount == null ? '' : communityCount.toLocaleString('en-US')),
    [communityCount],
  );

  // Stage 6 follow-up: Section C Truth-Telling Peer block. Renders
  // a chat-bubble between Block 3 (Inner Profile) and Block 4
  // (Reframe) when card.peer_comment is non-empty. charName comes
  // from MMKV cache (set during onboarding and refreshed on every
  // /api/character-state fetch), so InsightView doesn't need a new
  // prop -- both record.tsx PhaseInsight and wisdom-insight.tsx My
  // Logs reopen have the same MMKV cache available.
  const peerComment = card?.peer_comment ?? null;
  const peerCommentVisible =
    typeof peerComment === 'string' && peerComment.trim().length > 0;
  const charName = useMemo(
    () => getCachedCharacterState()?.charName?.trim() || 'your companion',
    [],
  );

  // Aspire bar fill clamped 0-100.
  const aspireFillPct = aspireImpact
    ? Math.max(0, Math.min(100, aspireImpact.currentScore))
    : 0;
  const aspireDeltaStr =
    aspireImpact && aspireImpact.deltaPercent != null
      ? (aspireImpact.deltaPercent >= 0 ? '+' : '') + aspireImpact.deltaPercent + '%'
      : '';

  return (
    <View style={styles.container}>
      {/* ============================================================
          Blocks 1 + 2: SHARED purple cards-background.webp glow.
          Block 1 (Card Collection notification) is conditional on
          cardCollection; Block 2 (page title + FlippableCard + flip
          hint) always renders. Both sit on the same ImageBackground
          so the purple light extends from the very top all the way
          down through the FlippableCard and "Tap To Flip" hint --
          matching the design figure.
          ============================================================ */}
      <ImageBackground
        source={CARDS_BACKGROUND}
        style={[styles.topPurpleWrap, { paddingTop: 24 + topExtraPadding }]}
        imageStyle={styles.topPurpleBg}
        contentFit="cover"
        cachePolicy="memory-disk"
      >
        {cardCollection ? (
          <>
            <Text style={styles.collectionHeader}>
              {cardCollection.isNewType
                ? 'New Card Type Unlocked!'
                : 'Added to Collection!'}
            </Text>

            <View style={styles.collectionKeywordRow}>
              <View style={styles.collectionKeywordPill}>
                <Text style={styles.collectionKeywordText}>
                  {cardCollection.keyword}
                </Text>
              </View>
              {cardCollection.isNewType ? (
                <Text style={styles.collectionNewBadge}>New</Text>
              ) : null}
            </View>

            <Text style={styles.collectionSubtitle}>
              {cardCollection.isNewType
                ? `${cardCollection.typesCollected}/48 Types Collected`
                : `${cardCollection.cardsCollectedForKeyword} Cards Collected`}
            </Text>
          </>
        ) : null}

        <Text style={styles.pageTitle}>Wisdom Behind Your Words</Text>

        <View style={styles.cardWrap}>
          <FlippableCard
            frontFilename={frontFilename}
            backFilename={backFilename}
            quoteShort={quoteShort}
            insightFull={card?.insight_full ?? ''}
            width={getStandardCardWidth(Dimensions.get('window').width)}
          />
        </View>
        <Text style={styles.flipHint}>Tap to Flip</Text>
      </ImageBackground>

      {/* ============================================================
          Block 3: Your Inner Profile.
          Light-lilac card containing a purple banner header on top
          and a body region beneath. Wrapped in communityCard so
          the rounded corners + overflow:hidden clip the banner's
          colored edges into the light-lilac card chrome.
          ============================================================ */}
      <View style={styles.communityCard}>
        <View style={styles.communityBanner}>
          <Text style={styles.communityBannerText}>Your Inner Profile</Text>
        </View>

        <View style={styles.communityBody}>
        {/* 4a: per-wisdom resonance count. Hidden when null — historical
            wisdom_cards rows (community_count IS NULL) don't show a
            number rather than fake one. Subtitle copy rewords to
            "resonated with you" per Stage 6 Bug 3 rename. */}
        {communityCount != null ? (
          <View style={styles.communityRow}>
            <Text style={styles.communityBigNumber}>{communityCountStr}</Text>
            <Text style={styles.communityRowCaption}>
              People in the community{'\n'}resonated with you
            </Text>
          </View>
        ) : null}

        {/* 4b: Aspire progress bar (conditional) */}
        {aspireImpact ? (
          <View style={styles.aspireBlock}>
            <View style={styles.aspireBarRow}>
              <View style={styles.aspireBarTrack}>
                <View
                  style={[styles.aspireBarFill, { width: `${aspireFillPct}%` }]}
                >
                  {aspireImpact && aspireImpact.deltaPercent != null ? (
                    <Text style={styles.aspireDeltaInBar}>{aspireDeltaStr}</Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.aspireScoreText}>{aspireFillPct}%</Text>
            </View>
            <Text style={styles.aspireLabel}>Your {aspireImpact.keyword}</Text>
          </View>
        ) : null}

        {/* 4c: Emotion big text + illustration */}
        <View style={styles.emotionRow}>
          <View style={styles.emotionTextCol}>
            <Text style={styles.emotionBigText}>{emotion || 'Reflective'}</Text>
            <Text style={styles.emotionCaption}>Your Emotion Keyword</Text>
          </View>
          <RNImage source={emotionImage} style={styles.emotionImage} contentFit="contain" cachePolicy="memory-disk" />
        </View>
        </View>
      </View>

      {/* ============================================================
          Block 3.5: Truth-Telling Peer (Section C of the AI prompt).
          Chat-bubble carrying a 500-700 char Reddit-style top-voted
          comment, branched by emotional state. Null-gated -- legacy
          wisdoms (pre-migration 20260527000000) skip the block.
          ============================================================ */}
      {peerCommentVisible ? (
        <View style={styles.peerSection}>
          <View style={styles.peerBubble}>
            <Text style={styles.peerBubbleText}>{peerComment}</Text>
            <View style={styles.peerAttribution}>
              <RNImage
                source={PEER_AVATAR}
                style={styles.peerAvatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
              <Text style={styles.peerAttributionText}>
                Words from {charName}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* ============================================================
          Block 4: 3-part Reframe (or legacy single-section fallback).
          White root bg, purple titles, BLACK body text. No emoji
          prefix on titles (prompt now outputs plain text).
          ============================================================ */}
      {reframe ? (
        <View style={styles.reframeSection}>
          {reframe.mirror_hook.title || reframe.mirror_hook.body ? (
            <View style={styles.reframePart}>
              <Text style={styles.reframeTitle}>{reframe.mirror_hook.title}</Text>
              <Text style={styles.reframeBody}>{reframe.mirror_hook.body}</Text>
            </View>
          ) : null}
          {reframe.flipped_lens.title || reframe.flipped_lens.body ? (
            <View style={styles.reframePart}>
              <Text style={styles.reframeTitle}>{reframe.flipped_lens.title}</Text>
              <Text style={styles.reframeBody}>{reframe.flipped_lens.body}</Text>
            </View>
          ) : null}
          {reframe.permission_slip.title || reframe.permission_slip.body ? (
            <View style={styles.reframePart}>
              <Text style={styles.reframeTitle}>{reframe.permission_slip.title}</Text>
              <Text style={styles.reframeBody}>{reframe.permission_slip.body}</Text>
            </View>
          ) : null}
        </View>
      ) : legacyB.body ? (
        // Legacy fallback: pre-Stage-6 wisdoms have no reframe; show
        // the single-section card_b in the same purple-title style.
        <View style={styles.reframeSection}>
          <View style={styles.reframePart}>
            {legacyB.title ? (
              <Text style={styles.reframeTitle}>{legacyB.title}</Text>
            ) : null}
            <Text style={styles.reframeBody}>{legacyB.body}</Text>
          </View>
        </View>
      ) : null}

      {/* ============================================================
          Section 6: Ask Yourself This (conditional)
          ============================================================ */}
      {reflective && reflective.question ? (
        <View style={styles.askCard}>
          <View style={styles.askHeader}>
            <View style={styles.askIconCircle}>
              <MaterialIcons name="help-outline" size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.askTitle}>Ask Yourself This</Text>
          </View>
          {/* Stage 6 follow-up (commit 30): validation preamble removed.
              Only the question renders now. Legacy wisdom rows may
              still have reflective.validation set; we ignore it. */}
          <Text style={styles.askQuestion}>{reflective.question}</Text>
        </View>
      ) : null}

      {/* ============================================================
          Section 7: Today's Missions to Grow (conditional)
          ============================================================ */}
      {hasTasks ? (
        <View style={styles.missionsCard}>
          <View style={styles.missionsHeader}>
            <View style={styles.missionsIconCircle}>
              <MaterialIcons name="check" size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.missionsTitle}>Today's Missions to Grow</Text>
          </View>
          {card?.task_1 ? (
            <View style={styles.missionRow}>
              <Text style={styles.missionBolt}>⚡</Text>
              <Text style={styles.missionText}>{card.task_1}</Text>
            </View>
          ) : null}
          {card?.task_2 ? (
            <View style={styles.missionRow}>
              <Text style={styles.missionBolt}>⚡</Text>
              <Text style={styles.missionText}>{card.task_2}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  container: {
    paddingTop: 0,
    paddingBottom: 16,
  },

  // ============================================================
  // Block 1 + 2 SHARED: purple cards-background.webp glow.
  // Both the Card Collection notification AND the FlippableCard
  // sit on this same backdrop so the purple light extends from
  // the very top down through the card and "Tap to Flip" hint.
  // The webp is sized to cover and the section grows with content.
  // ============================================================
  topPurpleWrap: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  topPurpleBg: {
    // Legacy: under expo-image's ImageBackground this style key is
    // ignored (contentFit on the <ImageBackground> prop above is
    // authoritative). Kept to avoid touching the StyleSheet shape.
    resizeMode: 'cover',
  },

  // ===== Block 1: Card Collection notification =====
  collectionHeader: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 14,
  },
  collectionKeywordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 10,
  },
  collectionKeywordPill: {
    backgroundColor: '#E97FCB',
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 999,
  },
  collectionKeywordText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  collectionNewBadge: {
    color: '#FACC15',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    fontStyle: 'italic',
    marginLeft: -6,
    marginTop: -8,
  },
  collectionSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginBottom: 18,
  },

  // ===== Block 2: page title + FlippableCard + flip hint =====
  // All on the SAME purple glow as Block 1.
  pageTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  cardWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  flipHint: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },

  // ============================================================
  // Block 3: Your Inner Profile.
  // Light-lilac card (#F4F1FF) with a purple banner across the top.
  // Internal text is BLACK (#000000) on the light bg, except the
  // big pink numerics and the emotion keyword.
  // ============================================================
  communityCard: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 24,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F4F1FF',
  },
  communityBanner: {
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    alignItems: 'center',
  },
  communityBannerText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  communityBody: {
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  communityBigNumber: {
    color: '#EC4899',
    fontSize: 48,
    fontFamily: 'Inter_900Black',
    marginRight: 16,
  },
  communityRowCaption: {
    flex: 1,
    color: '#000000',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    lineHeight: 18,
  },

  // 3b Aspire bar
  aspireBlock: {
    marginBottom: 18,
  },
  aspireBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  aspireBarTrack: {
    flex: 1,
    height: 22,
    backgroundColor: '#FCE7F3',
    borderRadius: 999,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  aspireBarFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 60,
  },
  aspireDeltaInBar: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  aspireScoreText: {
    color: '#EC4899',
    fontSize: 22,
    fontFamily: 'Inter_900Black',
    minWidth: 56,
    textAlign: 'right',
  },
  aspireLabel: {
    color: '#000000',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },

  // 3c Emotion big text + illustration
  emotionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emotionTextCol: {
    flex: 1,
  },
  emotionBigText: {
    color: '#EC4899',
    fontSize: 44,
    fontFamily: 'Inter_900Black',
    marginBottom: 2,
  },
  emotionCaption: {
    color: '#000000',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  emotionImage: {
    width: 80,
    height: 80,
    marginLeft: 12,
  },

  // ============================================================
  // Block 4: 3-part Reframe sections.
  // White bg (root), purple titles, BLACK body text.
  // No emoji prefix on titles -- AI prompt now outputs plain text.
  // ============================================================
  reframeSection: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  reframePart: {
    marginBottom: 24,
  },
  reframeTitle: {
    color: '#7C3AED',
    fontSize: 22,
    fontFamily: 'Inter_900Black',
    marginBottom: 12,
    lineHeight: 28,
  },
  reframeBody: {
    color: '#000000',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 23,
  },

  // ============================================================
  // Block 5: Ask Yourself This (dark purple card).
  // ============================================================
  askCard: {
    marginHorizontal: 16,
    backgroundColor: '#1A0F3D',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  askHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  askIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  askTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  askQuestion: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    lineHeight: 23,
  },

  // ============================================================
  // Block 6: Today's Missions to Grow (solid purple card).
  // ============================================================
  missionsCard: {
    marginHorizontal: 16,
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  missionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  missionsIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionsTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  missionBolt: {
    color: '#FACC15',
    fontSize: 16,
    marginTop: 1,
  },
  missionText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    lineHeight: 21,
  },

  // ==========================================================
  // Block 3.5: Truth-Telling Peer Comment (Section C)
  // Light-purple chat-bubble + tail + avatar + attribution row.
  // ==========================================================
  peerSection: {
    marginTop: 18,
    marginBottom: 18,
    paddingHorizontal: 18,
  },
  peerBubble: {
    backgroundColor: '#EDE6FE',
    borderRadius: 18,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 18,
  },
  peerBubbleText: {
    color: '#3D2A66',
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  // Stage 6 follow-up (commit 32): avatar + 'Words from {charName}'
  // moved INSIDE the bubble per design figure. Earlier version had
  // them outside below the bubble with a speech-tail; new figure
  // doesn't use a tail and embeds attribution within the bubble.
  peerAttribution: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  peerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  peerAttributionText: {
    color: '#D946EF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
});
