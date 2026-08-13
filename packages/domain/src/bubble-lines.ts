/**
 * Companion speech-bubble lines. Home selects one line per app launch from the
 * local-time day/night set. The persisted cursor lives in the mobile bubble
 * store; this package only owns the copy and deterministic index lookup.
 */
export const BUBBLE_LINES_DAY: string[] = [
  'Hey, what’s on your mind for today?',
  'Got anything you’re hoping to get done today?',
  'How are you feeling about the day ahead?',
  'What would make today feel like a good day?',
  'Is there anything you’re looking forward to today?',
  'What’s the main thing you want to focus on today?',
  'Busy day ahead, or are we taking it nice and easy?',
  'What kind of energy are you bringing into today?',
  'Is there something you’d really like to make time for today?',
  'What’s one small thing you’d feel good about finishing?',
  'How’s your heart feeling as you step into today?',
  'Anything exciting, difficult, or unexpected coming up?',
  'What could use a little more of your attention today?',
  'Are you feeling ready for today, or still easing into it?',
  'Is there someone or something on your mind this morning?',
  'What’s one thing you’d like to do just for yourself today?',
  'How can I help you feel a little more ready for today?',
  'If today goes well, what will have happened?',
  'So, what kind of day are we making today?',
];

export const BUBBLE_LINES_NIGHT: string[] = [
  'Hey, how did today treat you?',
  'What’s the first moment from today that comes to mind?',
  'Was there anything today you’d like to remember?',
  'What felt good today, even if it was something small?',
  'Did anything happen today that you’re still thinking about?',
  'What took most of your energy today?',
  'Was there a moment today that surprised you?',
  'What was the best part of your day?',
  'Was there a difficult moment you’d like to let out?',
  'Did anyone make you smile or cross your mind today?',
  'What’s one little thing from today worth keeping?',
  'How are you feeling now that the day is winding down?',
  'Did anything feel different today?',
  'What did you enjoy most about today?',
  'Was there a moment when you felt especially like yourself?',
  'Is there anything from today you don’t want to carry into tomorrow?',
  'Did you learn or realize anything about yourself today?',
  'What would you tell a close friend about your day?',
  'If today became one memory, which moment would you choose?',
  'Before we call it a day, is there anything you’d like to leave here?',
];

/** Pick a line by persisted sequence index. Daytime is 06:00–17:59 local. */
export function bubbleLineFor(day: boolean, rotation: number): string {
  const set = day ? BUBBLE_LINES_DAY : BUBBLE_LINES_NIGHT;
  return set[rotation % set.length];
}
