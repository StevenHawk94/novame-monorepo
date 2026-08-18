/**
 * Quiet Wins -- the preset "small wins" checklist (C5).
 *
 * The user checks whatever's true from a mixed list; the app credits a flat
 * +20 xp once a day regardless of how many are checked. Unlike Reflect and True
 * North, Quiet Wins does NOT award gems -- it's a light daily nudge toward
 * noticing, not a dimension measurement -- so `dimension` here remains
 * backstage metadata and is never a gem source.
 *
 * Two per dimension, sixteen total, shown shuffled and ungrouped (the user
 * never sees the dimension label). Feedback is selected from the version banks
 * below according to how many items were checked. The ids are stable and
 * load-bearing (stored in kit_completions.payload).
 */
import type { DimensionId } from './dimensions';

export interface QuietWin {
  /** Stable id, stored in kit_completions.payload. Never reuse or renumber. */
  id: string;
  text: string;
  /** Backstage metadata only, never a gem source. */
  dimension: DimensionId;
}

export const QUIET_WINS: readonly QuietWin[] = [
  {
    id: 'qw_expression_1',
    dimension: 'expression',
    text: "Said what I actually thought, even though staying quiet was easier",
  },
  {
    id: 'qw_expression_2',
    dimension: 'expression',
    text: "Told someone how I really felt instead of brushing it off",
  },
  {
    id: 'qw_awareness_1',
    dimension: 'awareness',
    text: "Caught myself mid-spiral and actually paused",
  },
  {
    id: 'qw_awareness_2',
    dimension: 'awareness',
    text: "Sat with a hard feeling instead of scrolling it away",
  },
  {
    id: 'qw_momentum_1',
    dimension: 'momentum',
    text: "Started the thing I'd been putting off",
  },
  {
    id: 'qw_momentum_2',
    dimension: 'momentum',
    text: "Sent the message I'd been avoiding",
  },
  {
    id: 'qw_direction_1',
    dimension: 'direction',
    text: "Said no to a plan that didn't feel right",
  },
  {
    id: 'qw_direction_2',
    dimension: 'direction',
    text: "Got a little clearer on what I actually want",
  },
  {
    id: 'qw_steadiness_1',
    dimension: 'steadiness',
    text: "Handled something that threw me off, and stayed standing",
  },
  {
    id: 'qw_steadiness_2',
    dimension: 'steadiness',
    text: "Took a break without guilt",
  },
  {
    id: 'qw_confidence_1',
    dimension: 'confidence',
    text: "Trusted my gut on something I wasn't sure about",
  },
  {
    id: 'qw_confidence_2',
    dimension: 'confidence',
    text: "Did the thing before I felt fully ready",
  },
  {
    id: 'qw_gratitude_1',
    dimension: 'gratitude',
    text: "Noticed a small thing that was better than I expected",
  },
  {
    id: 'qw_gratitude_2',
    dimension: 'gratitude',
    text: "Thanked someone and meant it",
  },
  {
    // qw_connection_1 ("Told someone the truth, gently") retired 2026-08-06 —
    // ids are never reused; old payloads referencing it are simply ignored.
    id: 'qw_connection_3',
    dimension: 'connection',
    text: "Showed up for someone without being asked",
  },
  {
    id: 'qw_connection_2',
    dimension: 'connection',
    text: "Reached out to someone instead of waiting for them",
  },
];

const QUIET_WINS_BY_ID: Record<string, QuietWin> = Object.fromEntries(
  QUIET_WINS.map((w) => [w.id, w]),
);

export interface QuietWinsFeedback {
  /** 0 = none, 1 = one, 2 = 2-6, 3 = 7-10, 4 = 11-16. */
  tier: 0 | 1 | 2 | 3 | 4;
  /** Lines to show on the feedback screen, in order. */
  lines: string[];
}

const ZERO_FEEDBACK = [
  "Some days there's just nothing to check, and that's real too.",
  "A blank day isn't a bad day. It's still yours.",
  "Nothing to check today — and that's okay.",
  'Not every day has something to show for it. This is one of them.',
  "Today just wasn't that kind of day. No explanation needed.",
] as const;

const SINGLE_FEEDBACK: Record<string, readonly string[]> = {
  qw_expression_1: [
    'You said the true thing instead of the easy thing.',
    "Staying quiet would've been simpler. You didn't take the easy way out.",
    'You let people hear what you actually think.',
    'Speaking up instead of staying quiet — that\'s a real choice.',
    'You chose honesty over comfort today.',
  ],
  qw_expression_2: [
    'You let someone in on how you actually felt.',
    "Naming a real feeling out loud isn't easy. You did it anyway.",
    'Instead of brushing it aside, you let it be known.',
    'You gave your feelings a voice instead of swallowing them.',
    "That feeling could've stayed hidden. You said it instead.",
  ],
  qw_awareness_1: [
    'You caught the spiral before it took over.',
    'Noticing it and pausing — that\'s harder than it sounds.',
    "You interrupted your own spiral. That's a skill, not luck.",
    'Mid-spiral, you stopped. That pause counts for a lot.',
    "You caught yourself in the middle of it, and that's not easy to do.",
  ],
  qw_awareness_2: [
    'You let the hard feeling stay instead of numbing it out.',
    'Sitting with something hard instead of scrolling past it takes patience with yourself.',
    "You didn't distract your way out of it. You just sat there with it.",
    'That feeling was hard, and you let yourself feel it instead of running.',
    'Instead of scrolling it away, you gave it a moment.',
  ],
  qw_momentum_1: [
    "The thing you'd been avoiding — you finally started it.",
    'You stopped putting it off and just began.',
    'That thing sat there for a while. Today you moved on it.',
    'Starting is the hardest part, and you did it.',
    "You broke the standoff with that thing you'd been avoiding.",
  ],
  qw_momentum_2: [
    'That message sat unsent for a while. You finally hit send.',
    'You stopped avoiding it and just sent it.',
    'The message you kept putting off — it\'s out there now.',
    'You did the thing that felt easier to keep avoiding.',
    'That one was hanging over you. Not anymore.',
  ],
  qw_direction_1: [
    "You said no to something that didn't sit right with you.",
    "That plan wasn't right for you, and you said so.",
    "Saying no isn't always easy. You did it anyway.",
    'You trusted the "no" instead of talking yourself into it.',
    "Something didn't feel right, and you didn't force yourself through it.",
  ],
  qw_direction_2: [
    'Something got a little clearer today about what you actually want.',
    "You're a bit closer to knowing what you actually want.",
    "Clarity doesn't come all at once. You got a piece of it today.",
    'You know a little more about what you want than you did yesterday.',
    'Today moved you a step closer to what you actually want.',
  ],
  qw_steadiness_1: [
    'Something threw you off, and you stayed standing anyway.',
    "That could've knocked you down. It didn't.",
    'You handled the curveball and kept going.',
    'Thrown off or not, you got through it.',
    "You didn't just survive it. You handled it.",
  ],
  qw_steadiness_2: [
    'You rested, and let yourself have it without guilt.',
    'A break without the guilt attached — that\'s not nothing.',
    "You stopped, and you didn't punish yourself for it.",
    "Rest without apology. That's harder than it sounds.",
    'You gave yourself a break and actually let it be one.',
  ],
  qw_confidence_1: [
    "You weren't sure, and you trusted your gut anyway.",
    "Uncertainty didn't stop you from listening to yourself.",
    'You went with what your gut said, even without certainty.',
    'Not knowing for sure didn\'t stop you from trusting yourself.',
    "You leaned on instinct when the answer wasn't obvious.",
  ],
  qw_confidence_2: [
    "You didn't wait to feel ready. You just did it.",
    'Fully ready never came, and you moved anyway.',
    "You started before you felt prepared, and that's often how it has to go.",
    "Readiness can wait. You didn't.",
    'You did it without waiting for the feeling of readiness to show up.',
  ],
  qw_gratitude_1: [
    'Something turned out better than expected, and you noticed.',
    "You caught a small good thing you could've easily missed.",
    'A small thing surprised you today, in a good way.',
    'You paid attention enough to notice something going right.',
    'Better than expected, and you actually saw it.',
  ],
  qw_gratitude_2: [
    'You said thank you, and you actually meant it.',
    'A real thank you, not just a habit — you gave that today.',
    'You let someone know you meant it.',
    "That thank you wasn't just words.",
    'You took a moment to actually thank someone.',
  ],
  qw_connection_3: [
    'Nobody asked you to show up. You did anyway.',
    'You showed up before anyone had to ask.',
    "That kind of showing up doesn't need a request.",
    "You didn't wait to be asked. You were just there.",
    'Unasked, unprompted — you showed up anyway.',
  ],
  qw_connection_2: [
    'You reached out first, instead of waiting for them to.',
    'Instead of waiting, you made the first move.',
    "You didn't wait around. You reached out.",
    'You closed the distance instead of waiting for someone else to.',
    'You made the move instead of waiting on theirs.',
  ],
};

const TWO_TO_SIX_FEEDBACK = [
  'Today was a genuinely good day for you.',
  "That wasn't just a routine day — you made it count.",
  'You did right by yourself today.',
  'Today, you gave yourself more than the bare minimum.',
  'That was a meaningful day, not just a busy one.',
  'You put in real effort for yourself today.',
  'Today, you took care of things that actually mattered.',
  "That's a day you can be glad you had.",
  'You made today matter, in your own way.',
  'That was a solid day, and not by accident.',
] as const;

const SEVEN_TO_TEN_FEEDBACK = [
  'You touched a lot of different parts of your life today.',
  'A lot of different pieces of your day went right.',
  'Today reached into more corners of your life than usual.',
  'You covered a lot of ground today.',
  'A wide day — a lot of different things came together.',
  'Today touched more parts of your life than most days do.',
  'You showed up in a lot of different ways today.',
  'A lot of different sides of you showed up today.',
] as const;

const ELEVEN_TO_SIXTEEN_FEEDBACK = [
  "You showed up for almost every part of yourself today. That's worth sitting with for a second.",
  'Almost everything went right today. Let that land for a moment.',
  "That's nearly the whole picture today. Take a second with that.",
  "You showed up, again and again, today. That's worth noticing.",
  'Today, you showed up for almost all of it. Sit with that for a second.',
] as const;

function versionAt(pool: readonly string[], sequenceIndex: number): string {
  const index = Number.isFinite(sequenceIndex) ? Math.max(0, Math.floor(sequenceIndex)) : 0;
  return pool[index % pool.length] ?? pool[0] ?? '';
}

/**
 * Feedback for a set of checked wins. `sequenceIndex` advances once each time
 * feedback is shown, so every size-specific version bank is presented in order
 * and loops after its final entry. Unknown ids are ignored.
 */
export function quietWinsFeedback(checkedIds: string[], sequenceIndex = 0): QuietWinsFeedback {
  const wins = checkedIds.map((id) => QUIET_WINS_BY_ID[id]).filter(Boolean) as QuietWin[];
  const n = wins.length;

  if (n === 0) {
    return { tier: 0, lines: [versionAt(ZERO_FEEDBACK, sequenceIndex)] };
  }

  if (n === 1) {
    const pool = SINGLE_FEEDBACK[wins[0].id] ?? ZERO_FEEDBACK;
    return { tier: 1, lines: [versionAt(pool, sequenceIndex)] };
  }

  if (n <= 6) {
    return { tier: 2, lines: [versionAt(TWO_TO_SIX_FEEDBACK, sequenceIndex)] };
  }

  if (n <= 10) {
    return { tier: 3, lines: [versionAt(SEVEN_TO_TEN_FEEDBACK, sequenceIndex)] };
  }

  return { tier: 4, lines: [versionAt(ELEVEN_TO_SIXTEEN_FEEDBACK, sequenceIndex)] };
}
