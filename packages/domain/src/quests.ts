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
export const CLOVERS_PER_TASK = 5;
export const COMPLETION_BONUS = 120;
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
      'Do 20 push-ups', 'Take a 30-minute brisk walk', 'Stretch for 10 minutes',
      'Do 3 sets of squats', 'Hold a plank for 1 minute', 'Climb the stairs instead of the lift today',
      'Do a 15-minute home workout', 'Go for a short run', 'Do 30 jumping jacks',
      'Try a yoga flow for 15 minutes', 'Do 3 sets of lunges', 'Cycle or walk somewhere you\u2019d usually drive',
      'Do a full-body stretch before bed', 'Do 15 sit-ups', 'Take a 20-minute nature walk',
      'Do a 10-minute core workout', 'Dance to 3 songs', 'Do wall sits for 2 minutes',
      'Stretch your back and shoulders', 'Take a walk after a meal',
    ],
  },

  // ---- Weight Loss ----
  {
    key: 'weight_loss',
    title: 'Weight Loss',
    subtitle: 'Healthy habits with steady progress',
    scope: 'both',
    tasks: [
      'Drink a glass of water before each meal', 'Swap one snack for fruit', 'Walk 8,000 steps',
      'Eat a vegetable with every meal', 'Skip sugary drinks today', 'Have a protein-rich breakfast',
      'Stop eating 3 hours before bed', 'Cook one meal at home', 'Take the stairs today',
      'Log what you eat today', 'Have a smaller portion at dinner', 'Do a 20-minute walk after lunch',
      'Choose water over soda', 'Add a salad to one meal', 'Avoid second helpings today',
      'Get 7+ hours of sleep', 'Eat slowly and mindfully at one meal', 'Replace dessert with fruit',
      'Do a light morning stretch', 'Plan tomorrow\u2019s meals',
    ],
  },

  // ---- Study ----
  {
    key: 'study',
    title: 'Study',
    subtitle: 'Focus deeper and learn steadily',
    scope: 'both',
    tasks: [
      'Study with no phone for 25 minutes', 'Review yesterday\u2019s notes', 'Read 10 pages',
      'Summarize what you learned in your own words', 'Do one practice problem set', 'Teach a concept to someone',
      'Make flashcards for a tricky topic', 'Study in a distraction-free spot', 'Set 3 goals for today\u2019s session',
      'Take structured breaks (25 on, 5 off)', 'Rewrite messy notes neatly', 'Watch one lecture and take notes',
      'Quiz yourself on last week\u2019s material', 'Outline an essay or report', 'Read one article in your field',
      'Organize your study materials', 'Explain a topic out loud', 'Do the hardest task first',
      'Plan tomorrow\u2019s study blocks', 'Reflect on what confused you today',
    ],
  },

  // ---- Work ----
  {
    key: 'work',
    title: 'Work',
    subtitle: 'Get focused and make real progress',
    scope: 'self',
    tasks: [
      'Do your most important task first', 'Clear your inbox to zero', 'Work 25 minutes with no distractions',
      'Write tomorrow\u2019s top 3 priorities', 'Tidy your workspace', 'Take a real lunch break away from your desk',
      'Finish one task you\u2019ve been avoiding', 'Say no to one non-essential request', 'Block focus time on your calendar',
      'Review your goals for the week', 'Batch similar small tasks together', 'Take a 5-minute break every hour',
      'Update your to-do list', 'Reply to that message you\u2019ve been putting off', 'Prepare for tomorrow\u2019s first meeting',
      'Silence notifications for 1 hour', 'Delegate or drop one task', 'Reflect on one win today',
      'Step outside for fresh air', 'Log off on time today',
    ],
  },

  // ---- Parenting ----
  {
    key: 'parenting',
    title: 'Parenting',
    subtitle: 'Small moments that matter',
    scope: 'self',
    tasks: [
      'Read a story together', 'Have a phone-free meal together', 'Ask about their day and really listen',
      'Play their favourite game for 15 minutes', 'Give a genuine compliment', 'Do a small chore together',
      'Have a 10-minute cuddle or chat', 'Cook or bake something together', 'Take a walk together',
      'Let them choose an activity', 'Praise an effort, not just a result', 'Do a craft or drawing together',
      'Have a dance party', 'Ask them a fun question', 'Put devices away for the evening',
      'Teach them one small skill', 'Write them a little note', 'Have a calm bedtime routine',
      'Laugh together at something silly', 'Tell them one thing you love about them',
    ],
  },

  // ---- Water Challenge (Friend) ----
  {
    key: 'water',
    title: 'Water Challenge',
    subtitle: 'Drink enough water to keep refresh',
    scope: 'friend',
    tasks: [
      'Drink a glass of water when you wake up', 'Finish a bottle before lunch', 'Drink water instead of soda',
      'Have a glass before each meal', 'Refill your bottle 3 times', 'Drink a glass after exercise',
      'Keep water on your desk all day', 'Swap coffee for water once', 'Drink a glass before bed',
      'Add fruit to your water', 'Track your water intake today', 'Drink water when you feel a snack craving',
      'Finish 6 glasses today', 'Have water first thing at work', 'Carry a bottle everywhere today',
      'Drink a glass every 2 hours', 'Start your meal with water', 'Choose water when out today',
      'Drink a glass after each break', 'Hit your daily water goal',
    ],
  },

  // ---- Mindfulness (Friend) ----
  {
    key: 'mindfulness',
    title: 'Mindfulness',
    subtitle: 'Stay peaceful mind and do not be mad',
    scope: 'friend',
    tasks: [
      'Take 10 slow breaths', 'Sit quietly for 5 minutes', 'Notice 5 things you can see, hear, feel',
      'Do one thing without multitasking', 'Take a mindful walk', 'Write down 3 things you\u2019re grateful for',
      'Pause before reacting today', 'Eat one meal slowly and mindfully', 'Do a 10-minute meditation',
      'Notice your breath when stressed', 'Put your phone away for an hour', 'Stretch and check in with your body',
      'Name one feeling honestly', 'Do a body scan before bed', 'Step outside and notice the air',
      'Let go of one small worry', 'Listen fully in one conversation', 'Take a screen-free break',
      'Breathe deeply before a hard task', 'End the day with one kind thought',
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
