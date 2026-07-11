/**
 * Quiet Wins -- the preset "small wins" checklist (C5).
 *
 * The user checks whatever's true from a mixed list; the app credits a flat
 * +20 xp once a day regardless of how many are checked. Unlike Reflect and True
 * North, Quiet Wins does NOT award gems -- it's a light daily nudge toward
 * noticing, not a dimension measurement -- so `dimension` here is backstage
 * only: it groups the feedback ("you showed up across Expression, Momentum"),
 * never a gem source.
 *
 * Two per dimension, sixteen total, shown shuffled and ungrouped (the user
 * never sees the dimension label). Each carries a bespoke evidence-style line
 * used when one or two are checked. Copy is first-draft and will be revised;
 * the ids are stable and load-bearing (stored in kit_completions.payload).
 */
import type { DimensionId } from './dimensions';

export interface QuietWin {
  /** Stable id, stored in kit_completions.payload. Never reuse or renumber. */
  id: string;
  text: string;
  /** Backstage only -- groups the tier-3 feedback, never a gem source. */
  dimension: DimensionId;
  /** Bespoke evidence line, shown when 1-2 wins are checked. */
  feedback: string;
}

export const QUIET_WINS: readonly QuietWin[] = [
  {
    id: 'qw_expression_1',
    dimension: 'expression',
    text: "Said what I actually thought, even though staying quiet was easier",
    feedback: "Saying it out loud when silence was right there \u2014 that took something.",
  },
  {
    id: 'qw_expression_2',
    dimension: 'expression',
    text: "Told someone how I really felt instead of brushing it off",
    feedback: "You let yourself be seen a little. That's not the easy path.",
  },
  {
    id: 'qw_awareness_1',
    dimension: 'awareness',
    text: "Caught myself mid-spiral and actually paused",
    feedback: "Noticing it while it's happening is the hard part \u2014 and you did.",
  },
  {
    id: 'qw_awareness_2',
    dimension: 'awareness',
    text: "Sat with a hard feeling instead of scrolling it away",
    feedback: "You stayed with something uncomfortable. Most people reach for the phone.",
  },
  {
    id: 'qw_momentum_1',
    dimension: 'momentum',
    text: "Started the thing I'd been putting off",
    feedback: "The starting is the whole battle. You're past it now.",
  },
  {
    id: 'qw_momentum_2',
    dimension: 'momentum',
    text: "Sent the message I'd been avoiding",
    feedback: "That one had weight, and you sent it anyway. Done is done.",
  },
  {
    id: 'qw_direction_1',
    dimension: 'direction',
    text: "Said no to a plan that didn't feel right",
    feedback: "Protecting your own time is harder than it looks. You did it.",
  },
  {
    id: 'qw_direction_2',
    dimension: 'direction',
    text: "Got a little clearer on what I actually want",
    feedback: "A bit less fog today. That clarity is yours to keep.",
  },
  {
    id: 'qw_steadiness_1',
    dimension: 'steadiness',
    text: "Handled something that threw me off, and stayed standing",
    feedback: "It knocked you sideways and you didn't fall. That's steadiness.",
  },
  {
    id: 'qw_steadiness_2',
    dimension: 'steadiness',
    text: "Took a break without guilt",
    feedback: "Resting without earning it first \u2014 that's a quiet kind of strength.",
  },
  {
    id: 'qw_confidence_1',
    dimension: 'confidence',
    text: "Trusted my gut on something I wasn't sure about",
    feedback: "You backed yourself without a guarantee. That's the whole thing.",
  },
  {
    id: 'qw_confidence_2',
    dimension: 'confidence',
    text: "Did the thing before I felt fully ready",
    feedback: "Ready rarely shows up first. You went anyway.",
  },
  {
    id: 'qw_gratitude_1',
    dimension: 'gratitude',
    text: "Noticed a small thing that was better than I expected",
    feedback: "Catching the good ones as they pass \u2014 that's a skill, not luck.",
  },
  {
    id: 'qw_gratitude_2',
    dimension: 'gratitude',
    text: "Thanked someone and meant it",
    feedback: "A real thank-you lands differently. You gave someone that.",
  },
  {
    id: 'qw_connection_1',
    dimension: 'connection',
    text: "Told someone the truth, gently",
    feedback: "Honest and kind at once is a hard balance. You held it.",
  },
  {
    id: 'qw_connection_2',
    dimension: 'connection',
    text: "Reached out to someone instead of waiting for them",
    feedback: "You closed the distance first. That takes more than it looks.",
  },
];

const QUIET_WINS_BY_ID: Record<string, QuietWin> = Object.fromEntries(
  QUIET_WINS.map((w) => [w.id, w]),
);

export interface QuietWinsFeedback {
  /** 0 = none checked, 1 = 1-2, 2 = 3-5, 3 = 6+. */
  tier: 0 | 1 | 2 | 3;
  /** Lines to show on the feedback screen, in order. */
  lines: string[];
}

const DIMENSION_LABEL: Record<DimensionId, string> = {
  expression: 'Expression',
  awareness: 'Awareness',
  momentum: 'Momentum',
  direction: 'Direction',
  steadiness: 'Steadiness',
  confidence: 'Confidence',
  gratitude: 'Gratitude',
  connection: 'Connection',
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * The layered feedback for a set of checked wins. Pure -- a display mapping over
 * the checklist, computed client-side; the server only records that Quiet Wins
 * ran and credits the flat xp. Unknown ids are ignored (copy can be revised
 * without breaking an old cached payload).
 */
export function quietWinsFeedback(checkedIds: string[]): QuietWinsFeedback {
  const wins = checkedIds.map((id) => QUIET_WINS_BY_ID[id]).filter(Boolean) as QuietWin[];
  const n = wins.length;

  if (n === 0) {
    return {
      tier: 0,
      lines: ["Nothing today? That's alright. Maybe New Lens has something for you."],
    };
  }

  if (n <= 2) {
    return { tier: 1, lines: wins.map((w) => w.feedback) };
  }

  if (n <= 5) {
    const highlight = wins[0].feedback;
    const rest = n - 1;
    return {
      tier: 2,
      lines: [
        highlight,
        `Along with the other ${rest} ${rest === 1 ? 'thing' : 'things'} you checked, today held more than it looked like.`,
      ],
    };
  }

  // 6+ : group by the dimensions the checked wins touched.
  const dims: DimensionId[] = [];
  for (const w of wins) if (!dims.includes(w.dimension)) dims.push(w.dimension);
  const labels = dims.map((d) => DIMENSION_LABEL[d]);
  return {
    tier: 3,
    lines: [`Today you showed up across ${joinList(labels)}.`],
  };
}
