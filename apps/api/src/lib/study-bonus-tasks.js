/**
 * Study-session bonus task templates.
 *
 * Sequential rotation of 24 short self-care quests offered to the
 * user after each completed study session. The user's
 * profiles.study_bonus_task_index column (migration
 * 20260526200000) cursors through this array; each /api/study-claim
 * POST picks TEMPLATES[index] and increments index modulo length.
 *
 * After all 24 templates are used, the cycle restarts from index 0.
 *
 * Inserted into daily_tasks as:
 *   { task_type: 'study_bonus', exp_reward: 10, expires_at: now + 24h }
 *
 * Future evolution: when the product needs admin-editable templates,
 * migrate this array to a study_bonus_task_templates table and let
 * the admin UI manage rows. For now (Stage 6 follow-up) the list is
 * hardcoded — changes require a redeploy, which is acceptable given
 * the 24 entries were product-curated and unlikely to churn.
 */
export const STUDY_BONUS_TASK_TEMPLATES = [
  "Label your current emotion in just one word. Acknowledge it without judgment.",
  "Cross your arms over your chest, give yourself a gentle squeeze, and silently say: \"I am doing the best I can.\"",
  "Drink a full glass of water mindfully, feeling it refresh and re-energize your body.",
  "Clear, organize, or wipe down just one small area around you (like your desk or phone screen).",
  "Stand up, put your hands on your hips (like a superhero), and hold the pose for 30 seconds to boost confidence.",
  "Reach your arms high up to the sky, roll your shoulders backward 5 times, and release the tension.",
  "Text a quick, unexpected \"Thank you\" or a compliment to a friend, colleague, or family member.",
  "Look into the mirror, smile at yourself, and name one trait you truly appreciate about yourself today.",
  "Unfollow or mute one social media account that makes you feel anxious or inadequate.",
  "Think of something that is annoying you right now and ask yourself: \"What is this trying to teach me?\"",
  "Close your eyes and hum your favorite tune softly for 30 seconds. Feel the physical vibration soothe your nervous system.",
  "Take a deep sniff of something around you with a pleasant scent (coffee, a candle, lotion, or fruit) and focus entirely on the smell for 3 breaths.",
  "Close your eyes and picture one place where you feel 100% safe and happy. Take one deep breath there before opening your eyes.",
  "Rub your palms together vigorously for 15 seconds until they get warm, then place them gently over your closed eyes to rest.",
  "Close all the unused tabs on your browser or background apps on your phone. Feel the instant mental relief of a clean digital workspace.",
  "Scroll through your photo album, find one photo that makes you smile, and look at it for 20 seconds.",
  "Place your hand on your heart, take a deep breath, and silently say: \"I don't have to be perfect to be worthy.\"",
  "Sit perfectly still for 30 seconds and try to identify the quietest background sound you can hear right now.",
  "Re-read a nice message or comment someone sent you in the past. Let that warm feeling sink in.",
  "Notice how you are sitting or standing right now. Straighten your spine, drop your shoulders away from your ears, and unclench your jaw.",
  "Find 3 items on your desk or in your room that are actually trash (receipts, wrappers, broken pens) and throw them away.",
  "Walk over to a mirror and give your reflection a high-five. It feels silly, but it scientifically triggers a dopamine hit!",
  "Stand up and literally shake your hands, arms, and legs for 15 seconds as if you are shaking off all the stress of the day.",
  "Put on an upbeat song and move your body freely for just 1 minute. No judgment, just pure movement.",
]

/**
 * Returns the template at currentIndex (wrapped modulo array length)
 * plus the next index to write back to profiles.study_bonus_task_index.
 *
 * Safe against any positive integer or 0; wraps cleanly on overflow.
 */
export function pickStudyBonusTaskTemplate(currentIndex) {
  const len = STUDY_BONUS_TASK_TEMPLATES.length
  const safeIdx = ((currentIndex % len) + len) % len
  return {
    text: STUDY_BONUS_TASK_TEMPLATES[safeIdx],
    nextIndex: (safeIdx + 1) % len,
  }
}
