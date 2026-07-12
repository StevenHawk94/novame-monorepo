import { describe, expect, it } from 'vitest';

import { findDuplicateSkill } from './skill-dedup';

const existing = [
  { id: '1', text: 'Rest is not laziness, it is recovery' },
  { id: '2', text: 'Speaking up early prevents bigger problems later' },
  { id: '3', text: 'Small steps build momentum over time' },
];

describe('findDuplicateSkill: keyword-overlap dedup', () => {
  it('catches a reworded lesson that shares vocabulary', () => {
    const d = findDuplicateSkill('Recovery comes from proper rest', existing);
    expect(d?.skill.id).toBe('1');
  });
  it('catches a speaking-up variant', () => {
    const d = findDuplicateSkill('Speaking up early saved me from problems', existing);
    expect(d?.skill.id).toBe('2');
  });
  it('catches a reordered momentum lesson', () => {
    const d = findDuplicateSkill('Momentum builds from small steps', existing);
    expect(d?.skill.id).toBe('3');
  });
  it('passes a genuinely new lesson', () => {
    expect(findDuplicateSkill('Trusting my gut led to a good outcome', existing)).toBeNull();
  });
  it('known limit: disjoint-wording synonym slips through (needs embedding)', () => {
    // "slowing down when tired" is the same lesson as "rest is recovery" but
    // shares no keywords, so keyword dedup can't catch it. Documented gap.
    expect(findDuplicateSkill('Slowing down when tired helps me', existing)).toBeNull();
  });
  it('treats an empty existing set as all-novel', () => {
    expect(findDuplicateSkill('Any lesson at all', [])).toBeNull();
  });
});
