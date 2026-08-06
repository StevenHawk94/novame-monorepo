/**
 * Weekly Quests themes (C12). A user picks one theme, then picks 7 of its ~20
 * candidate tasks (or writes their own / has the AI build a Custom plan), and
 * commits to a 7-day plan: one check-off per day, clovers per task, a bonus for
 * finishing all seven. Self and Friend scopes share the shape; a few themes
 * differ between them (see scope).
 *
 * Task copy is first-draft and meant to be tuned; the numbers (rewards, days)
 * live here so they can be balanced in one place.
 */
// PRD §8.1 (2026-07 ruling Q16): each daily check-off pays 30 — and because
// only one task can be checked per calendar day, the effective daily cap is
// also 30. Finishing all seven inside the week pays 200 on top.
export const CLOVERS_PER_TASK = 30;
export const COMPLETION_BONUS = 200;
export const PLAN_DAYS = 7;
export const TASKS_TO_PICK = 7;

export interface QuestTheme {
  key: string;
  title: string;
  subtitle: string;
  scope: 'self' | 'friend' | 'both';
  isCustom?: boolean;   // AI-built plan (Plus)
  isWriteOwn?: boolean; // user writes their own tasks
  tasks: string[];      // candidate tasks (~20); ignored for custom/write-own
}

export const QUEST_THEMES: QuestTheme[] = [
  // ---- Custom Goal (AI, Plus) -- shown at the top of both scopes ----
  {
    key: 'custom',
    title: 'Custom Goal',
    subtitle: 'Let harebi build the plan for you based on your goal',
    scope: 'both',
    isCustom: true,
    tasks: [],
  },

  // ---- Fitness ----
  {
    key: 'fitness',
    title: 'Fitness',
    subtitle: 'Build Strength and Boost Energy',
    scope: 'both',
    tasks: [
      'Did some form of exercise today', 'Stretched your body for a few minutes',
      'Took the stairs instead of the elevator', 'Went for a walk',
      'Completed a workout session', 'Moved your body for at least 10 minutes',
      'Got up and moved after sitting for a long time', 'Did some strength training',
      'Did some cardio', 'Practiced good posture today',
      'Took a stretch break during work', 'Parked farther away and walked the extra distance',
      'Did a quick bodyweight workout', 'Went for a bike ride',
      'Practiced balance or flexibility exercises', 'Warmed up before physical activity',
      'Cooled down or stretched after activity', 'Chose stairs over an escalator',
      'Got your heart rate up today', 'Did some light active recovery (walk, gentle stretch)',
    ],
  },

  // ---- Weight Loss ----
  {
    key: 'weight_loss',
    title: 'Weight Loss',
    subtitle: 'Healthy habits with steady progress',
    scope: 'both',
    tasks: [
      'Resisted a craving for unhealthy food', 'Tracked what you ate today',
      'Drank water instead of a sugary drink', 'Stopped eating when full instead of overeating',
      'Chose a healthy snack over junk food', 'Avoided late-night snacking',
      'Ate a home-cooked meal instead of takeout', 'Skipped seconds at a meal',
      'Checked a nutrition label before eating something', 'Planned your meals ahead of time',
      'Avoided sugary desserts today', 'Chose a smaller portion size',
      'Ate slowly and paid attention while eating', 'Avoided mindless snacking while distracted (TV/phone)',
      'Said no to fast food today', 'Tracked your weight or progress',
      'Prepped a healthy meal or snack in advance', 'Avoided alcohol or sugary drinks today',
      'Chose vegetables over processed food', 'Stuck to your portion or calorie goal',
    ],
  },

  // ---- Study ----
  {
    key: 'study',
    title: 'Study',
    subtitle: 'Focus deeper and learn steadily',
    scope: 'both',
    tasks: [
      'Studied for a set period of time', 'Reviewed notes from a class or course',
      'Completed a reading assignment', 'Practiced a skill you’re learning',
      'Took notes during a study session', 'Avoided distractions while studying',
      'Reviewed material before a test or exam', 'Completed a homework assignment',
      'Watched an educational video or lecture', 'Made a study plan or schedule',
      'Practiced with flashcards or a quiz', 'Asked a question or sought help when stuck',
      'Summarized what you learned today', 'Explored a topic outside your usual subject',
      'Took a focused study break (not scrolling)', 'Reviewed mistakes from a past test or assignment',
      'Completed a study goal you set for today', 'Practiced recalling information without looking',
      'Organized your study materials or notes', 'Read for at least 20–30 minutes',
    ],
  },

  // ---- Work ----
  {
    key: 'work',
    title: 'Work',
    subtitle: 'Get focused and make real progress',
    scope: 'self',
    tasks: [
      'Completed your top priority task', 'Started work on time',
      'Finished a task you’d been putting off', 'Took a proper break during work',
      'Avoided constantly checking email or social media', 'Responded to important messages',
      'Planned your tasks for the day', 'Wrapped up work without overworking late',
      'Helped a coworker with something', 'Stayed fully present in a meeting (no multitasking)',
      'Cleared out your inbox', 'Made progress ahead of a deadline',
      'Took a lunch break away from your desk', 'Said no to an unnecessary distraction or task',
      'Organized your workspace', 'Followed up on something you’d promised',
      'Made progress on a long-term project', 'Set a clear goal for the day',
      'Avoided procrastinating on a task', 'Left work at a reasonable time',
    ],
  },

  // ---- Parenting ----
  {
    key: 'parenting',
    title: 'Parenting',
    subtitle: 'Small moments that matter',
    scope: 'self',
    tasks: [
      'Had quality one-on-one time with your child', 'Read a book together',
      'Stayed patient during a tough moment', 'Praised or encouraged your child today',
      'Played a game together', 'Had a meaningful conversation with your child',
      'Helped with homework or schoolwork', 'Prepared a healthy meal for your child',
      'Kept a promise you made to your child', 'Listened without interrupting or judging',
      'Set a boundary calmly and consistently', 'Had a phone-free moment together',
      'Helped your child through a difficult emotion', 'Did a fun activity outdoors together',
      'Praised effort, not just results', 'Took a moment to laugh together',
      'Followed through on a routine (bedtime, meals, etc.)', 'Apologized if you lost your temper',
      'Asked about your child’s day and really listened', 'Showed physical affection (hug, high five)',
    ],
  },

  // ---- Water Challenge (Friend) ----
  {
    key: 'water',
    title: 'Water Challenge',
    subtitle: 'Drink enough water to keep refresh',
    scope: 'self',
    tasks: [
      'Drank a full glass of water first thing in the morning', 'Reached your daily water goal',
      'Chose water instead of soda or juice', 'Carried a water bottle with you today',
      'Drank a glass of water before each meal', 'Refilled your water bottle at least twice',
      'Chose water instead of coffee or tea in the afternoon', 'Drank water when a reminder went off',
      'Drank water during or after exercise', 'Avoided sugary drinks all day',
      'Drank a glass of water before bed', 'Tracked your water intake today',
      'Checked if you were thirsty before reaching for a snack', 'Chose water over alcohol tonight',
      'Drank water within an hour of waking up', 'Had water instead of a snack for a craving',
      'Finished a full bottle of water today', 'Drank water during a work break',
      'Increased your water intake compared to yesterday', 'Hit your hydration goal by the end of the day',
    ],
  },

  // ---- Mindfulness (Friend) ----
  {
    key: 'mindfulness',
    title: 'Mindfulness',
    subtitle: 'Stay peaceful mind and do not be mad',
    scope: 'self',
    tasks: [
      'Took a few deep breaths to reset', 'Meditated for a few minutes',
      'Noticed and named an emotion instead of reacting', 'Took a moment to feel grateful for something',
      'Paused before reacting to something stressful', 'Practiced a body scan or relaxation exercise',
      'Spent a few minutes in silence without your phone', 'Noticed your surroundings mindfully (sounds, sights)',
      'Journaled your thoughts or feelings', 'Practiced deep breathing when stressed',
      'Let go of a worry instead of dwelling on it', 'Took a mindful walk, noticing your senses',
      'Practiced self-compassion instead of self-criticism', 'Set an intention for the day',
      'Took a break from screens to just be present', 'Ate a meal mindfully, without distractions',
      'Reflected on your day before bed', 'Practiced patience in a frustrating moment',
      'Did a breathing exercise before sleep', 'Checked in with how you’re feeling today',
    ],
  },

  // ---- Write Your Own (self + friend) ----
  {
    key: 'write_own',
    title: 'Write Your Own',
    subtitle: 'Build your own weekly quests to goal',
    scope: 'both',
    isWriteOwn: true,
    tasks: [],
  },
];

export const QUEST_THEME_BY_KEY: Record<string, QuestTheme> =
  Object.fromEntries(QUEST_THEMES.map((t) => [t.key, t]));

/** Themes for a given scope (a 'both' theme appears in both). */
export function themesForScope(scope: 'self' | 'friend'): QuestTheme[] {
  return QUEST_THEMES.filter((t) => t.scope === scope || t.scope === 'both');
}
