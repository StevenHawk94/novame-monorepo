/**
 * Companion speech-bubble lines. The bubble cycles through a set of gentle,
 * ambient lines by default (day set + night set), and after a reflection the
 * companion shows a one-off AI line instead (see the bubble store). These are
 * first-draft copy, to be tuned.
 */
export const BUBBLE_LINES_DAY: string[] = [
  "I'm flowing through your shared moments.",
  'The light is good today. What will you notice?',
  "I've been thinking about something you said.",
  'Every small thing you gather adds up.',
  "You're further along than you feel.",
];

export const BUBBLE_LINES_NIGHT: string[] = [
  "It's quiet now. A good time to look inward.",
  'The day is settling. So can you.',
  "Whatever today held, you're still here.",
  'Rest is part of the growing too.',
  'I like these still hours with you.',
];

/** Pick a rotating line by an index (e.g. minute-based) so it changes over time. */
export function bubbleLineFor(day: boolean, rotation: number): string {
  const set = day ? BUBBLE_LINES_DAY : BUBBLE_LINES_NIGHT;
  return set[rotation % set.length];
}
