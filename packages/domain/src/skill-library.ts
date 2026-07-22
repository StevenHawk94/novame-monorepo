/**
 * The fixed 81-card skill library (2026-07 product ruling, Q13).
 *
 * Nine groups of nine: the eight dimensions plus MEGA — universal cards whose
 * damage applies to every monster. Cards are acquired by KEYWORD MATCHING
 * against the user's reflect text (rule engine, never AI), each card exactly
 * once (a matched card that's already owned simply doesn't re-trigger).
 *
 * PLACEHOLDER CONTENT: every title/keyword/body below is a stand-in written
 * to exercise the pipeline; the product will supply the real 81-card sheet.
 * The SHAPE is the contract — swap content freely, keep the fields.
 *
 * Tiers map to battle damage (PRD §2.4): normal 20 / intermediate 30 /
 * advanced 50. ("default" damage 10 belongs to Just Breathe, which is not a
 * library card.) Per group: 5 normal, 3 intermediate, 1 advanced.
 *
 * Note the open product question (plan doc): the Skill List mock counts n/8
 * per group (72 total) while the ruling says 9×9=81. Built to the ruling.
 */
import type { DimensionId } from './dimensions';

export type SkillGroup = DimensionId | 'mega';
export type SkillTier = 'normal' | 'intermediate' | 'advanced';

export interface SkillCard {
  /** Stable id, `<group>-<n>`; persisted once acquired — never renumber. */
  id: string;
  group: SkillGroup;
  tier: SkillTier;
  title: string;
  /** Lower-cased trigger phrases; any hit in the reflect text acquires the card. */
  keywords: string[];
  body: string;
}

/** 5 normal, 3 intermediate, 1 advanced — applied to each group's 9 slots. */
const TIER_BY_SLOT: SkillTier[] = [
  'normal', 'normal', 'normal', 'normal', 'normal',
  'intermediate', 'intermediate', 'intermediate',
  'advanced',
];

/** Compact per-group seed: [title, keywords, body] × 9. Placeholder copy. */
type Seed = [string, string[], string];

const GROUP_SEEDS: Record<SkillGroup, Seed[]> = {
  expression: [
    ['Say It Anyway', ['i said', 'spoke up', 'told them'], 'You said the thing instead of swallowing it.'],
    ['Small Honesty', ['honest', 'truth', 'admitted'], 'A gentle truth beats a comfortable silence.'],
    ['Name the Feeling', ['i felt', 'i feel', 'feeling'], 'Putting a word on it takes half its weight.'],
    ['Ask Out Loud', ['asked', 'question', 'wondering'], 'Questions are doors — you opened one.'],
    ['Draw the Line', ['said no', 'boundary', 'refused'], 'A clean no protects a true yes.'],
    ['Hard Conversation', ['confronted', 'argued', 'difficult talk'], 'You walked toward the talk you wanted to skip.'],
    ['Own the Room', ['presented', 'meeting', 'spoke in front'], 'Your voice held the room, and you let it.'],
    ['Tender Truth', ['gently told', 'kindly', 'soft truth'], 'Honesty landed softly because you carried it with care.'],
    ['Unmistakable Voice', ['my opinion', 'i believe', 'i disagree'], 'You disagreed without disappearing.'],
  ],
  awareness: [
    ['Catch the Loop', ['overthinking', 'spiraling', 'loop'], 'You saw the spiral while standing outside it.'],
    ['Name the Pattern', ['pattern', 'again', 'always do'], 'Seeing the repeat is the first exit from it.'],
    ['Pause Button', ['paused', 'stepped back', 'took a moment'], 'The pause is where choice lives.'],
    ['Honest Mirror', ['realized', 'noticed about myself', 'i saw that'], 'You looked, and did not look away.'],
    ['Untangle One Thread', ['sorted out', 'figured out', 'made sense of'], 'One clear thread pulled from a messy knot.'],
    ['Feelings Have Names', ['anxious because', 'sad because', 'angry because'], 'You traced the feeling to its root.'],
    ['Watch the Weather', ['mood', 'shifted', 'passing'], 'Moods are weather — you watched one pass.'],
    ['Question the Story', ['maybe i was wrong', 'another way to see', 'reframe'], 'You put your own story on trial, kindly.'],
    ['Clear Water Mind', ['clarity', 'clear now', 'understand myself'], 'Still water shows the bottom. So did you.'],
  ],
  momentum: [
    ['Just Started', ['started', 'began', 'first step'], 'Starting badly beats waiting perfectly.'],
    ['Ten-Minute Push', ['kept going', 'pushed through', 'a bit more'], 'Ten more minutes is a superpower in disguise.'],
    ['Finish the Thing', ['finished', 'completed', 'done with'], 'Done. The most beautiful word in the language.'],
    ['Tiny Habit', ['every day', 'daily', 'routine'], 'Small and daily outruns big and someday.'],
    ['Un-stick Yourself', ['procrastinat', 'putting off', 'finally did'], 'You did the thing you were circling.'],
    ['Eat the Frog', ['hardest task', 'worst first', 'got it over with'], 'Hardest first — the rest of the day thanks you.'],
    ['Chain of Days', ['streak', 'in a row', 'kept the'], 'Days link into chains; chains pull you forward.'],
    ['Course Correct', ['adjusted', 'changed approach', 'tried differently'], 'You steered instead of stopping.'],
    ['Unstoppable Hour', ['deep work', 'focused for', 'flow'], 'One protected hour moved more than a scattered day.'],
  ],
  direction: [
    ['Tiny Compass', ['what i want', 'i want to', 'my goal'], 'You said what you want out loud. That is a heading.'],
    ['One Priority', ['priority', 'most important', 'matters most'], 'Choosing one thing quietly declines a hundred.'],
    ['Future Postcard', ['someday', 'dream', 'imagine myself'], 'You wrote to your future self and meant it.'],
    ['Not This Way', ['not for me', "doesn't fit", 'wrong direction'], 'Knowing what you don’t want is also a map.'],
    ['Next Right Step', ['next step', 'plan to', 'going to'], 'You only ever need the next step, and you have it.'],
    ['Values Check', ['what matters', 'important to me', 'my values'], 'You measured the day against what matters.'],
    ['Say No to Drift', ['drifting', 'aimless', 'back on track'], 'You caught the drift and turned the wheel.'],
    ['Long Game', ['long term', 'years from now', 'investing in'], 'You traded a small now for a large later.'],
    ['True North Found', ['purpose', 'why i', 'meant to'], 'For a moment, the needle held still. You saw it.'],
  ],
  steadiness: [
    ['One Deep Breath', ['breathed', 'deep breath', 'calmed down'], 'One breath is a doorway out of the storm.'],
    ['Storm Watcher', ['anxious', 'panic', 'worried'], 'You stood in the wind and did not become it.'],
    ['Ground Touch', ['grounded', 'present', 'here and now'], 'Feet on the floor, mind in the room.'],
    ['Slow the Scroll', ['put my phone down', 'stopped scrolling', 'logged off'], 'You chose stillness over stimulus.'],
    ['Steady Hands', ['stayed calm', 'kept it together', 'held steady'], 'Calm is contagious — you were the source.'],
    ['Ride the Wave', ['let it pass', 'wave', 'temporary'], 'You let the feeling crest and fall without fighting it.'],
    ['Unshakeable Hour', ['under pressure', 'deadline', 'chaos'], 'Pressure rose; your floor held.'],
    ['Soft Landing', ['comforted myself', 'self compassion', 'kind to myself'], 'You caught yourself the way you’d catch a friend.'],
    ['Eye of the Storm', ['crisis', 'emergency', 'everything went wrong'], 'Everything moved except your center.'],
  ],
  confidence: [
    ['Tried Anyway', ['tried', 'attempted', 'gave it a shot'], 'Courage is trying with the outcome unknown.'],
    ['Own the Win', ['proud of', 'accomplished', 'did well'], 'You let yourself feel the win. Keep that.'],
    ['Enough Already', ['good enough', 'enough for today', 'accepted'], '"Enough" said with a full heart is power.'],
    ['Borrowed Belief', ['believed in me', 'encouraged', 'support'], 'Someone lent you belief — you invested it.'],
    ['Stand Your Ground', ['stood my ground', 'defended', 'held my position'], 'You stayed standing where you used to shrink.'],
    ['Imposter Unmasked', ['imposter', 'not good enough', 'doubt myself'], 'You heard the doubt and acted anyway.'],
    ['Ask For More', ['asked for a raise', 'negotiated', 'asked for more'], 'You priced yourself at your worth.'],
    ['Rejection Bounce', ['rejected', 'turned down', 'no but'], 'It bounced off — you kept your shape.'],
    ['Quiet Certainty', ['i know i can', 'certain', 'trust myself'], 'No noise, no show. Just knowing.'],
  ],
  gratitude: [
    ['Small Sweetness', ['delicious', 'tasty', 'enjoyed eating'], 'You caught a small pleasure in flight.'],
    ['Golden Hour', ['sunset', 'sunlight', 'beautiful sky'], 'The sky did something and you were there for it.'],
    ['Thank You Said', ['thanked', 'grateful for', 'appreciate'], 'Gratitude spoken doubles in size.'],
    ['Cozy Corner', ['cozy', 'comfortable', 'warm blanket'], 'You noticed comfort while inside it — rare skill.'],
    ['Little Luck', ['lucky', 'just in time', 'worked out'], 'A small mercy noticed is a small joy kept.'],
    ['Ordinary Magic', ['ordinary', 'simple moment', 'everyday'], 'Nothing happened, and it was wonderful.'],
    ['Savor Mode', ['savored', 'slowly enjoyed', 'took it in'], 'You stretched a good moment like taffy.'],
    ['Count the Good', ['three good things', 'went well today', 'good day'], 'You counted, and the day counted back.'],
    ['Overflowing Cup', ['so grateful', 'blessed', 'full heart'], 'The cup ran over and you let it.'],
  ],
  connection: [
    ['Reached Out', ['messaged', 'called', 'texted'], 'You closed a distance with one small message.'],
    ['Really Listened', ['listened', 'heard them', 'let them talk'], 'You gave the rarest gift: full attention.'],
    ['Small Kindness', ['helped', 'kind to', 'did something for'], 'A small kindness is never small to the receiver.'],
    ['Shared the Load', ['together', 'we did', 'with a friend'], 'Halved burden, doubled joy — teamwork math.'],
    ['Checked In', ['checked on', 'how are you', 'thinking of you'], 'You knocked gently on someone’s day.'],
    ['Repair Attempt', ['apologized', 'made up', 'sorry'], 'You chose the relationship over being right.'],
    ['Show Up', ['showed up', 'was there for', 'attended'], 'Presence is the whole present.'],
    ['Let Them In', ['opened up', 'vulnerable', 'shared with'], 'You showed the unpolished part. That builds bridges.'],
    ['Deep Roots', ['old friend', 'family time', 'reconnected'], 'You watered a root that holds you up.'],
  ],
  mega: [
    ['Fresh Morning', ['morning', 'woke up early', 'sunrise'], 'A day opened and you walked in on purpose.'],
    ['Good Sleep', ['slept well', 'early night', 'rested'], 'Rest is a move, not a pause.'],
    ['Moved My Body', ['walked', 'exercise', 'stretched'], 'The body led and the mind followed.'],
    ['Touched Grass', ['outside', 'nature', 'fresh air'], 'Outside air resets inside weather.'],
    ['Made Something', ['made', 'created', 'built'], 'Something exists now because you do.'],
    ['Learned a Thing', ['learned', 'read about', 'studied'], 'Your map of the world grew a new road.'],
    ['Laughed Hard', ['laughed', 'funny', 'hilarious'], 'A real laugh cleans the whole machine.'],
    ['Let It Go', ['let go', 'moved on', 'released'], 'You put the heavy thing down and left it there.'],
    ['Full Reset', ['fresh start', 'new chapter', 'begin again'], 'All monsters flinch before a person who can begin again.'],
  ],
};

function buildLibrary(): SkillCard[] {
  const cards: SkillCard[] = [];
  for (const group of Object.keys(GROUP_SEEDS) as SkillGroup[]) {
    GROUP_SEEDS[group].forEach(([title, keywords, body], i) => {
      cards.push({
        id: `${group}-${String(i + 1).padStart(2, '0')}`,
        group,
        tier: TIER_BY_SLOT[i],
        title,
        keywords: keywords.map((k) => k.toLowerCase()),
        body,
      });
    });
  }
  return cards;
}

export const SKILL_LIBRARY: readonly SkillCard[] = buildLibrary();
export const SKILL_LIBRARY_SIZE = SKILL_LIBRARY.length; // 81
export const SKILL_CARD_BY_ID: Record<string, SkillCard> = Object.fromEntries(
  SKILL_LIBRARY.map((c) => [c.id, c]),
);
export const CARDS_PER_GROUP = 9;
