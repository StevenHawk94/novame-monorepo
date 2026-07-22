import { describe, expect, it } from 'vitest';
import { SKILL_LIBRARY, SKILL_LIBRARY_SIZE, CARDS_PER_GROUP } from '@novame/domain';
import { matchSkillCards } from './card-matcher';

describe('SKILL_LIBRARY shape (Q13 ruling: 9 groups × 9 = 81)', () => {
  it('holds exactly 81 cards', () => {
    expect(SKILL_LIBRARY_SIZE).toBe(81);
    expect(SKILL_LIBRARY.length).toBe(81);
  });

  it('has 9 cards in each of 9 groups', () => {
    const byGroup = new Map<string, number>();
    for (const c of SKILL_LIBRARY) byGroup.set(c.group, (byGroup.get(c.group) ?? 0) + 1);
    expect(byGroup.size).toBe(9);
    for (const n of byGroup.values()) expect(n).toBe(CARDS_PER_GROUP);
  });

  it('ids are unique and keywords lower-cased', () => {
    const ids = new Set(SKILL_LIBRARY.map((c) => c.id));
    expect(ids.size).toBe(81);
    for (const c of SKILL_LIBRARY) {
      for (const k of c.keywords) expect(k).toBe(k.toLowerCase());
    }
  });

  it('each group runs 5 normal / 3 intermediate / 1 advanced', () => {
    const tally = new Map<string, Record<string, number>>();
    for (const c of SKILL_LIBRARY) {
      const t = tally.get(c.group) ?? { normal: 0, intermediate: 0, advanced: 0 };
      t[c.tier]++;
      tally.set(c.group, t);
    }
    for (const t of tally.values()) {
      expect(t).toEqual({ normal: 5, intermediate: 3, advanced: 1 });
    }
  });
});

describe('matchSkillCards', () => {
  it('acquires a card on a keyword hit', () => {
    const out = matchSkillCards('Today I finally started the project.', []);
    expect(out.some((c) => c.id === 'momentum-01')).toBe(true);
  });

  it('never re-acquires owned cards', () => {
    const first = matchSkillCards('I started something.', []);
    expect(first.length).toBeGreaterThan(0);
    const again = matchSkillCards('I started something.', first.map((c) => c.id));
    expect(again.some((c) => c.id === first[0].id)).toBe(false);
  });

  it('respects word boundaries (no mid-word hits)', () => {
    // "restarted" must not trigger the "started" keyword.
    const out = matchSkillCards('The server restarted twice.', []);
    expect(out.some((c) => c.id === 'momentum-01')).toBe(false);
  });

  it('matches case-insensitively', () => {
    const out = matchSkillCards('I STARTED!', []);
    expect(out.some((c) => c.id === 'momentum-01')).toBe(true);
  });
});
