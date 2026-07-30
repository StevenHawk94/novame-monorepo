import { deleteRecordDraftAudio } from './artifacts';
import { defineKey, definePrefixKey } from './registry';

/**
 * THE key manifest. Every MMKV key in the app, declared exactly once, with an
 * explicit scope. Nowhere else.
 * ===========================================================================
 *
 * Choosing a scope
 * ----------------
 *   'user'    The value describes the signed-in account: anything derived from
 *             an authenticated API call, anything the user typed, any counter
 *             about their behaviour.
 *
 *             WHEN IN DOUBT, CHOOSE THIS. Over-clearing costs one extra fetch.
 *             Under-clearing means user B reads user A's data.
 *
 *   'device'  The value describes this phone: notification schedule, the R2
 *             asset manifest, "have we already asked for a rating". Survives a
 *             user switch on purpose.
 *
 * How this list was established (2026-07)
 * ---------------------------------------
 * Not by reading the sign-out handler -- that handler was the bug. Every entry
 * below was derived from a scan of the real tree for string and template
 * literals, cross-checked against every storage read and write call site,
 * with three assertions:
 *
 *   - `iap.ts` never touches `storage`, so its six `novame.*` literals are App
 *     Store product IDs, not keys.
 *   - The two multi-line `storage.set(` calls (ai-consent.ts, record.tsx) pass
 *     the keys claimed here.
 *   - `novame_weekly_report:` has a getString and a set, and no remove anywhere
 *     in the repo. It leaks by construction.
 *
 * Before the registry, sign-out cleared 6 of these 31 keys. The 14 user-scoped
 * keys marked LEAKED below survived a user switch on a shared device.
 *
 * Retirement (Phase 2)
 * --------------------
 * Voice recording, the weekly report, Discover/Seek, and the 48-keyword card
 * system are all removed in v2.0. Their keys must NOT be deleted from this
 * file when their writers go away: users upgrading from 1.0.x still carry that
 * data on disk, and `clearScope()` is the only thing that will ever remove it.
 * Mark them clear-only, like `kLeaderboardLegacy` below.
 * ===========================================================================
 */

// ===========================================================================
// USER SCOPE (25) -- cleared on SIGNED_IN and on SIGNED_OUT
// ===========================================================================

// --- Authenticated API caches ---------------------------------------------

/** subscription.ts: STORAGE_KEY */
export const kSubscription = defineKey('novame_subscription', 'user');

/** me-stats.ts: STORAGE_KEY */
export const kMeStats = defineKey('novame_me_stats', 'user');

/** Visit Master status cache (cache-first render, avoids the entry flash). */
export const kMasterState = defineKey('novame_master_state', 'user');

/** Selected Home scene + companion skin (personalization panel). */
export const kCosmetics = defineKey('novame_cosmetics', 'user');

/** Latest companion bubble line from a reflection (shown on Home, then fades). */
export const kBubble = defineKey('novame_bubble', 'user');

/** Cached Reflect Feed (My Logs), cache-first render. */
export const kReflectFeed = defineKey('novame_reflect_feed', 'user');

/** Clovers balance + unlocked cosmetics (cache-first). */
export const kCosmeticUnlocks = defineKey('novame_cosmetic_unlocks', 'user');

/** Active quest plan status (cache-first). */
export const kQuestStatus = defineKey('novame_quest_status', 'user');

/** character-state.ts: STORAGE_KEY */
export const kCharacterState = defineKey('novame_character_state', 'user');

/** wisdom-center-api.ts: WISDOM_CENTER_STORAGE_KEY */
export const kWisdomCenter = defineKey('novame_wisdom_center', 'user');

/** LEAKED. wisdoms-api.ts: WISDOMS_STORAGE_KEY -- the user's own entries. */
export const kWisdomLogs = defineKey('novame_wisdom_logs', 'user');

/** LEAKED. user-stats-api.ts: USER_STATS_STORAGE_KEY -- word counts, keywords. */
export const kUserStats = defineKey('novame_user_stats', 'user');

/** LEAKED. daily-tasks-api.ts: DAILY_TASKS_STORAGE_KEY */
export const kDailyTasks = defineKey('novame_daily_tasks', 'user');

/**
 * LEAKED. keyword-detail-cache.ts: PREFIX, read as `PREFIX + slug`.
 *
 * The name says artwork; the value is `WisdomLog[]` -- the user's own journal
 * entries filtered by keyword. Nothing about this key is user-agnostic.
 */
export const kKeywordDetail = definePrefixKey('novame_kwdetail:', 'user');

/**
 * LEAKED, and the one the literal scan missed on the first pass.
 *
 * wisdom-center-api.ts: `weeklyReportCacheKey(weekStart)` builds it with a
 * template literal, so a scan for quoted strings never saw it. It has a
 * getString (:412) and a set (:425) and no remove anywhere in the repo, while
 * its neighbour WISDOM_CENTER_STORAGE_KEY is cleared in three places. The
 * value is the user's AI-generated weekly report.
 */
export const kWeeklyReport = definePrefixKey('novame_weekly_report:', 'user');

/**
 * Clear-only since v2.0: the leaderboard feature was removed (design drops
 * the Home trophy entry; leaderboard-api.ts deleted). Installs that used it
 * still carry the cache on disk, so the key stays registered for clearScope,
 * per the Retirement policy above.
 */
export const kLeaderboard = defineKey('novame_leaderboard_v2', 'user');

/**
 * Clear-only. Never written by current code: leaderboard-api.ts:71 records that
 * the key was renamed to `_v2` so stale caches would be ignored. Ignored, but
 * not deleted -- every install that predates the rename still carries it.
 * Registered so `clearScope` collects it and `assertAllKeysRegistered` stays
 * quiet.
 */
export const kLeaderboardLegacy = defineKey('novame_leaderboard', 'user');

/**
 * LEAKED. seek-cards-cache.ts: PREFIX, read as `keyFor(questionId, userId)`.
 * The userId is baked into the suffix, so a switch orphans rather than leaks --
 * but it is still the previous account's data sitting on the disk.
 */
export const kSeekCards = definePrefixKey('novame_seek_cards_', 'user');

// --- Drafts: the incident --------------------------------------------------

/**
 * LEAKED, AND THE ONE THAT MATTERED.
 *
 * record-draft.ts: META_KEY. The value is `{ audioUri, durationSec, ... }`
 * where audioUri points at `documentDirectory/novame_record_draft.m4a` -- an
 * unpublished voice recording. User B signing in on the same phone was offered
 * user A's recording to resume and publish.
 *
 * `onClear` deletes the audio file, not merely the pointer.
 */
export const kRecordDraft = defineKey('novame_record_draft', 'user', {
  onClear: deleteRecordDraftAudio,
});

/** LEAKED. record.tsx:1944,2829,2834,2836 -- unpublished typed text. */
export const kRecordTypedDraft = defineKey('novame_record_typed_draft', 'user');

/** LEAKED. record.tsx:1928 (multi-line set) -- AI line about A's last entry. */
export const kLastPublishMessage = defineKey('novame_last_publish_message', 'user');

// --- Consent and entitlement -----------------------------------------------

/**
 * LEAKED. ai-consent.ts: STORAGE_KEY.
 *
 * `hasAiConsented()` reads this synchronously before any AI-touching flow
 * opens. A new user could pass that gate on the previous user's consent, in
 * the window before `fetchCharacterState` overwrote it from the server.
 * Bounded, and it self-heals -- but it is a consent record. Treat it as one.
 */
export const kAiConsent = defineKey('novame.ai_consent', 'user');

/**
 * LEAKED. quota-flag.ts: KEY.
 *
 * The ONLY native-boolean key in the app: `storage.set(KEY, true)` +
 * `storage.getBoolean(KEY)`. Every other key is a string. (Repo-wide,
 * getBoolean appears once; getString 32 times; getNumber never.)
 *
 * Phase 0 does not touch reads, so this does not matter yet. Phase 1's typed
 * accessors MUST dispatch on the stored primitive, or `getString` on this key
 * returns undefined and the local paywall short-circuit silently dies.
 */
export const kQuotaExhausted = defineKey('novame_quota_exhausted', 'user');

// --- Behaviour counters ----------------------------------------------------

/** LEAKED. publish-count.ts: PUBLISH_COUNT_KEY. */
export const kPublishCount = defineKey('novame_publish_count', 'user');

/** LEAKED. task-completion-count.ts: TASK_COMPLETION_COUNT_KEY. */
export const kTaskCompletionCount = defineKey('novame_task_completion_count', 'user');

/**
 * LEAKED. (tabs)/index.tsx: WR_DOT_SEEN_KEY.
 * Despite the name, the value is a fingerprint string, not a boolean.
 */
export const kWeeklyReportDotSeen = defineKey('novame_wr_dot_seen', 'user');

/** LEAKED. (tabs)/index.tsx: WR_DOT_CHECKED_DATE_KEY -- a yyyy-mm-dd string. */
export const kWeeklyReportDotCheckedDate = defineKey('novame_wr_dot_checked_date', 'user');

/** LEAKED. notification-settings.ts: PROMPTED_AFTER_PURCHASE_KEY. */
export const kNotifPromptedAfterPurchase = defineKey(
  'novame_notif_prompted_after_purchase',
  'user',
);

// --- Forms and flows -------------------------------------------------------

/**
 * onboarding.ts: STORAGE_KEY. 'preauth', not 'user'.
 *
 * The 11-step flow runs before sign-in, so at SIGNED_IN this blob belongs to
 * the person who just typed it. Clearing it there is not hygiene, it is data
 * loss: `syncOnboardingIfPending` (onboarding.ts:216) reads MMKV on its first
 * synchronous line and returns early when `pendingSync` is false, so the
 * aspire words and companion name never reach the server.
 *
 * At SIGNED_OUT the same blob belongs to the departing user, and goes.
 *
 * Also removed by (auth)/sign-in.tsx:111 -- a dev-only "replay onboarding"
 * button, unrelated to auth lifecycle.
 */
export const kOnboardingState = defineKey('novame_onboarding_state', 'preauth');

/** Whether the pre-auth onboarding intro has been seen on THIS phone. Device
 *  scope, not user/preauth: it must survive sign-out so a returning user goes
 *  straight to sign-in, never re-watches the intro (C4 decision B). Set true
 *  when onboarding reaches sign-in; read by app/index.tsx to route a
 *  session-less launch to onboarding (unseen) vs sign-in (seen). */
export const kOnboardingIntroSeen = defineKey('novame_onboarding_intro_seen', 'device');

/**
 * shipping-form.tsx: STORAGE_KEY. Read by order-history.tsx:122.
 *
 * 'user', not 'preauth': the address is typed after sign-in, inside the
 * checkout flow. The old SIGNED_IN handler preserved it on the grounds that it
 * "doesn't affect any auth-gated UI" -- but it is the previous user's home
 * address, and it renders straight into the next user's shipping form.
 */
export const kShipping = defineKey('novame.shipping', 'user');

/**
 * LEAKED. cache-refresh-all.ts: LAST_REFRESH_KEY.
 *
 * User-scoped on purpose: clearing it means the first foreground tick after a
 * sign-in refreshes everything for the new account, rather than trusting the
 * previous user's freshness stamp.
 */
export const kLastGlobalRefreshMs = defineKey('novame_last_global_refresh_ms', 'user');

/** reflect.tsx: today's reflect count + last submission snapshot (server
 *  authority -- a read-only shadow of what /api/reflect returned, refreshed
 *  from the response, never computed locally). Shape: { date, reflectsToday,
 *  lastSnapshot }. Stale cache only mis-renders briefly; the RPC's daily gate
 *  is the real limit. */
export const kReflectState = defineKey('novame_reflect_state', 'user');

// Reflect 右上角双开关的"记住上次选择"（2026-07-23 需求）：
// { visibleToFriend: boolean, shareToBox: boolean }
export const kReflectShareDefaults = defineKey('novame_reflect_share_defaults', 'user');

// Friends tab caches (2026-07-24 全局缓存优先): status + Messages feed, so
// the tab renders instantly from the last visit while revalidating.
export const kFriendsStatus = defineKey('novame_friends_status', 'user');
export const kFriendsFeed = defineKey('novame_friends_feed', 'user');

// Guided Prompts (流程2) — the user's chosen reflect categories (3-20 keys).
// First run shows the chooser; afterwards the flow jumps straight to the
// prompt pages, editable via the pages' Edit button.
export const kGuidedCategories = defineKey('novame_guided_categories', 'user');

/** status.tsx: the eight-dimension gem totals from /api/status. A read-only
 *  shadow of user_gems; the Status screen derives stage and totals from these
 *  with the shared engine, never storing computed values. */
export const kStatusGems = defineKey('novame_status_gems', 'user');

/** quiet-wins.tsx: whether Quiet Wins was completed today, so the Home entry
 *  can hide once done and reappear next day. Shape: { date, done }. A read-only
 *  shadow of the server's once-per-day gate; a stale cache at worst shows the
 *  entry an extra time, which the RPC then rejects. */
export const kQuietWinsState = defineKey('novame_quiet_wins_state', 'user');

/** new-lens.tsx: today's completion flag + the pre-fetched next card per theme.
 *  Shape: { date, done, nextCards: { [theme]: card } }. The done flag hides the
 *  Home entry once used (resets next day); nextCards is the "cache the next card
 *  on completion" so tomorrow's open is instant, falling back to a fetch if a
 *  card was edited away. A read-only shadow of the server's gate and cursor. */
export const kNewLensState = defineKey('novame_new_lens_state', 'user');

/** true-north.tsx: this week's completion + rankings for the reveal and the
 *  week-over-week comparison. Shape: { weekKey, doneThisWeek, thisWeekRanking,
 *  lastRanking }. A read-only shadow of kit_completions; the weekly gate stays
 *  server-side. */
export const kTrueNorthState = defineKey('novame_true_north_state', 'user');

/** Home + interaction sheet: the companion's authoritative state (xp, stage,
 *  skin, name). Level/progress are derived from xp with the shared engine, not
 *  stored. A read-only shadow refreshed from /api/companion. */
export const kCompanionState = defineKey('novame_companion_state', 'user');

/** Bags tab: collected items + their memories, cached for instant render.
 *  Display info (name, emoji, rarity) is derived from the shared dictionary by
 *  item_id, not stored here. */
export const kBagsState = defineKey('novame_bags_state', 'user');

/** Skills tab: lessons learned, cached for instant render. source 'self' vs
 *  'friend' split client-side. */
export const kSkillsState = defineKey('novame_skills_state', 'user');

/** Tame Enemy daily done flag (local, like New Lens): { date, done }. Server
 *  kit_completions is authoritative, but the sheet reads this synchronously to
 *  drop the daily Kit once tamed. */
export const kTameEnemyState = defineKey('novame_tame_enemy_state', 'user');

/** Home memory bubbles: { date, popped: string[] } — which of today's friend
 *  item bubbles were already popped, so they stay gone across app restarts.
 *  Selection itself is recomputed deterministically (see home-bubbles.ts);
 *  only the popped set needs persistence. Currency for popping arrives with
 *  the P1 economy rework — until then popping is purely visual, so a lost
 *  flag costs nothing but a replayed animation. */
export const kHomeBubblesState = defineKey('novame_home_bubbles_state', 'user');

// ===========================================================================
// DEVICE SCOPE (6) -- survives a user switch, deliberately
// ===========================================================================

/**
 * app-config-api.ts: STORAGE_KEY. Pricing and unlock thresholds are app-wide,
 * not account-wide. The old sign-out handler cleared this; that was a needless
 * refetch on every sign-out, not a fix.
 */
export const kAppConfig = defineKey('novame_app_config', 'device');

/** notification-settings.ts: STORAGE_KEY. The reminder schedule for THIS phone. */
export const kNotificationSettings = defineKey('novame_notification_settings', 'device');

/**
 * rating-prompt.ts: KEY_LAST_PROMPT_AT / KEY_USER_EXPRESSED.
 *
 * Apple rate-limits `requestReview` per device. Tracking it per account would
 * let a user switch "reset" a limit they cannot actually reset -- we would
 * simply call an API that silently does nothing.
 */
export const kRatingPromptLastAt = defineKey('novame_rating_prompt_last_at', 'device');
export const kRatingPromptUserExpressed = defineKey(
  'novame_rating_prompt_user_expressed',
  'device',
);

/** asset-cache.ts: STORAGE_KEY_MANIFEST. Card art and video are user-agnostic. */
export const kAssetManifest = defineKey('asset-manifest:cached', 'device');

/**
 * seek-questions-cache.ts: STORAGE_KEY_PREFIX, read as `keyForFilter(filter)`.
 * The public Seek feed. No userId in the key, no user data in the value.
 */
export const kSeekQuestions = definePrefixKey('novame_seek_questions:', 'device');

/** outfits.ts: cached outfit catalog from the R2 video-manifest (user-agnostic). */
export const kOutfitCatalog = defineKey('novame_outfit_catalog', 'device');

/** outfits.ts: which outfit this account has equipped (mirrors kCosmetics skins). */
export const kEquippedOutfit = defineKey('novame_equipped_outfit', 'user');

/** scenes.ts: cached scene catalog from the R2 video-manifest (user-agnostic). */
export const kSceneCatalog = defineKey('novame_scene_catalog', 'device');
