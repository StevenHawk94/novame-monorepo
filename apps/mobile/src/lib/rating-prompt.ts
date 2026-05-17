/**
 * rating-prompt.ts -- Stage 6.RatingPrompt
 *
 * Decides if/when to show the App Store rating + feedback prompt,
 * and provides an emit/subscribe channel for triggering the actual
 * BottomSheet display. The sheet itself is mounted in
 * (tabs)/_layout.tsx so it surfaces above whichever tab the user
 * lands on after the record modal closes or after completing a
 * milestone-hitting task.
 *
 * The emit/subscribe pattern mirrors home-refresh-signal.ts: a
 * Set-of-callbacks at module level, no React Context, no Zustand.
 *
 * Decision logic (shouldShowRatingPrompt) gates on:
 *
 *   1. SUBSCRIBED USERS ONLY. Free-tier users are excluded by design
 *      -- they have at most 1 publish/month and minimal product
 *      engagement, so soliciting reviews from them dilutes App Store
 *      rating quality. Only subscribed (basic/pro/ultra) users see
 *      this prompt.
 *
 *   2. ENGAGEMENT MILESTONE -- either condition triggers:
 *        - publish count in [3, 10, 30]  (record flow engagement)
 *        - daily task completion count in [10, 50, 100]  (growth
 *          engagement, independent of publish quota)
 *
 *      Why OR not AND: different user personas use the app
 *      differently. A "reflective writer" publishes frequently but
 *      ignores tasks; a "habit builder" completes tasks daily but
 *      rarely publishes. Both are legitimate engagement signals.
 *
 *   3. AT LEAST 60 DAYS since previous prompt. Defensive cooldown --
 *      hitting milestone 3 -> 10 -> 30 takes time naturally, but
 *      this protects against a user mass-completing tasks in a day.
 *
 *   4. USER HAS NOT PREVIOUSLY EXPRESSED feedback (loved or unhappy).
 *      Per design: respect the user's choice. If they engaged with
 *      the prompt before, never ask again.
 *
 * iOS-layer filtering happens AFTER ours, in SKStoreReviewController:
 *   - max 3 presentations per 365 days
 *   - suppressed if user already rated this app version
 *   - suppressed if user disabled in-app ratings in Settings
 * We don't try to detect these -- just call requestReview() and let
 * iOS decide. Our state tracks USER intent (did they engage with
 * our pre-dialog), not whether iOS actually showed the system UI.
 */
import { storage } from '@/lib/storage';

// ---- MMKV keys ----

const KEY_LAST_PROMPT_AT = 'novame_rating_prompt_last_at';
const KEY_USER_EXPRESSED = 'novame_rating_prompt_user_expressed';

// ---- Trigger configuration ----

const TRIGGER_PUBLISH_COUNTS: readonly number[] = [3, 10, 30];
const TRIGGER_TASK_COUNTS: readonly number[] = [10, 50, 100];
const COOLDOWN_DAYS = 60;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// ---- Decision ----

export type ShouldShowOpts = {
  publishCount: number;
  taskCompletionCount: number;
  isSubscribed: boolean;
};

/**
 * Whether the rating prompt should be shown right now. Performs
 * ALL gating checks (subscription, milestone, cooldown, expressed).
 *
 * Pure read -- does NOT mark anything as shown. The caller is
 * responsible for calling markRatingPromptShown() after the sheet
 * is actually displayed (so re-triggers within cooldown are
 * suppressed even if the user dismisses without expressing).
 */
export function shouldShowRatingPrompt(opts: ShouldShowOpts): boolean {
  // Gate 1: subscribed users only
  if (!opts.isSubscribed) return false;

  // Gate 2: already expressed -- never ask again
  if (getUserExpressed() !== undefined) return false;

  // Gate 3: cooldown
  const lastAt = getLastPromptAt();
  if (lastAt !== null && Date.now() - lastAt < COOLDOWN_MS) return false;

  // Gate 4: at least one engagement milestone hit
  const publishHit = TRIGGER_PUBLISH_COUNTS.includes(opts.publishCount);
  const taskHit = TRIGGER_TASK_COUNTS.includes(opts.taskCompletionCount);
  if (!publishHit && !taskHit) return false;

  return true;
}

function getLastPromptAt(): number | null {
  try {
    const raw = storage.getString(KEY_LAST_PROMPT_AT);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Stamp "we showed the prompt at this time" so the 60-day cooldown
 * starts ticking. Called immediately before emitting the show signal
 * -- this way even if the user dismisses without expressing, we
 * don't re-trigger within cooldown.
 */
export function markRatingPromptShown(): void {
  try {
    storage.set(KEY_LAST_PROMPT_AT, String(Date.now()));
  } catch (e) {
    console.warn('[rating-prompt] mark shown failed:', e);
  }
}

type UserExpressed = 'loved' | 'unhappy';

function getUserExpressed(): UserExpressed | undefined {
  try {
    const raw = storage.getString(KEY_USER_EXPRESSED);
    if (raw === 'loved' || raw === 'unhappy') return raw;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record that the user expressed feedback (either path of the
 * BottomSheet). Permanently suppresses future prompts.
 *
 * Called by RatingPromptSheet when:
 *   - 'loved'   = user tapped "Rate NovaMe" (regardless of whether
 *                 iOS ultimately showed the system rating modal)
 *   - 'unhappy' = user tapped "Send Feedback" (mailto launched)
 *
 * If the user only taps Skip / Maybe later, we do NOT call this --
 * the cooldown-only mechanism allows another attempt at the next
 * milestone if still uncrossed.
 */
export function markUserExpressed(value: UserExpressed): void {
  try {
    storage.set(KEY_USER_EXPRESSED, value);
  } catch (e) {
    console.warn('[rating-prompt] mark expressed failed:', e);
  }
}

// ---- Emit / subscribe pattern (mirrors home-refresh-signal.ts) ----

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Emit a "show the rating prompt sheet now" signal. The subscriber
 * mounted in (tabs)/_layout.tsx calls bottomSheetRef.current.present().
 *
 * Preconditions: caller MUST have verified shouldShowRatingPrompt
 * and called markRatingPromptShown() before emitting. This module
 * does not gate the emit itself -- it's a fire-and-forget signal.
 */
export function emitRatingPromptRequest(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      console.warn('[rating-prompt] listener threw:', e);
    }
  }
}

/**
 * Subscribe a callback to rating-prompt-request emissions. Returns
 * the unsubscribe function. Typical usage from (tabs)/_layout.tsx:
 *
 *   const ref = useRef<RatingPromptSheetRef>(null);
 *   useEffect(
 *     () => subscribeRatingPromptRequest(() => ref.current?.present()),
 *     []
 *   );
 */
export function subscribeRatingPromptRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
