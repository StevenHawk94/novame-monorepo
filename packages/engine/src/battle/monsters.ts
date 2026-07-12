/**
 * The eight monsters of Tame Enemy -- one per growth dimension. The user picks
 * which to face; the monster's skill pool is that dimension's unlocked skills.
 *
 * The three taxonomies (New Lens topics, these monsters, the 8 dimensions) are
 * deliberately independent (PRD): dimensions are the hidden scoring frame,
 * monsters are pure game flavor. Only the monster<->dimension link matters here.
 *
 * prep = Screen 2 entrance line; tamed = Screen 4 closing line, which avoids
 * "beat/destroy" language (you tame it, it stays, it listens). Overthinking and
 * The Wall are the PRD's own copy; the other six are first-draft, to be tuned.
 */
export interface MonsterDef {
  id: string;
  dimension: string;
  name: string;
  prep: string;
  tamed: string;
}

export const MONSTERS: MonsterDef[] = [
  {
    id: 'the_swallower',
    dimension: 'expression',
    name: 'The Swallower',
    prep: "The Swallower is here, holding your words down.\nYou've found some ways to let them out.",
    tamed: "Tamed. The Swallower isn't gone — but it's yours now, and your voice gets through.",
  },
  {
    id: 'overthinking',
    dimension: 'awareness',
    name: 'Overthinking',
    prep: "Overthinking showed up again.\nLet's see what you've learned about handling it.",
    tamed: "Tamed. Overthinking isn't gone — but it's yours now, and it listens.",
  },
  {
    id: 'procrastination',
    dimension: 'momentum',
    name: 'Procrastination',
    prep: "Procrastination's back, whispering 'later.'\nYou know a few ways to start anyway.",
    tamed: "Tamed. Procrastination isn't gone — but it's yours now, and you move first.",
  },
  {
    id: 'the_fog',
    dimension: 'direction',
    name: 'The Fog',
    prep: "The Fog rolled in again.\nYou've been finding your own footing lately.",
    tamed: "Tamed. The Fog isn't gone — but it's yours now, and you can see a step ahead.",
  },
  {
    id: 'the_spiral',
    dimension: 'steadiness',
    name: 'The Spiral',
    prep: "The Spiral is pulling again.\nYou've learned how to steady yourself.",
    tamed: "Tamed. The Spiral isn't gone — but it's yours now, and you hold your ground.",
  },
  {
    id: 'the_hollow',
    dimension: 'confidence',
    name: 'The Hollow',
    prep: "The Hollow opened up again.\nYou've found what actually fills it.",
    tamed: "Tamed. The Hollow isn't gone — but it's yours now, and you stand on your own.",
  },
  {
    id: 'the_comparer',
    dimension: 'gratitude',
    name: 'The Comparer',
    prep: "The Comparer is measuring again.\nYou've been noticing what's already yours.",
    tamed: "Tamed. The Comparer isn't gone — but it's yours now, and you look to your own path.",
  },
  {
    id: 'the_wall',
    dimension: 'connection',
    name: 'The Wall',
    prep: "The Wall is back, arms crossed.\nYou've got a few ways to reach past it now.",
    tamed: "Tamed. The Wall isn't gone — but it's yours now, and you let people in.",
  },
];

export const MONSTER_BY_DIMENSION: Record<string, MonsterDef> = Object.fromEntries(
  MONSTERS.map((m) => [m.dimension, m]),
);
