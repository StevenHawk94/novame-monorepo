import { describe, expect, it } from 'vitest';

import { QUIET_WINS, quietWinsFeedback } from './quiet-wins';

describe('QUIET_WINS', () => {
  it('contains no growth-dimension metadata', () => {
    expect(QUIET_WINS).toHaveLength(16);
    for (const win of QUIET_WINS) {
      expect(Object.keys(win).sort()).toEqual(['id', 'text']);
      expect(win).not.toHaveProperty('dimension');
    }
  });
});

describe('quietWinsFeedback', () => {
  it('cycles zero-selection feedback in order', () => {
    expect(quietWinsFeedback([], 0)).toEqual({
      tier: 0,
      lines: ["Some days there's just nothing to check, and that's real too."],
    });
    expect(quietWinsFeedback([], 5)).toEqual({
      tier: 0,
      lines: ["Some days there's just nothing to check, and that's real too."],
    });
  });

  it('uses the selected event bank when exactly one item is checked', () => {
    expect(quietWinsFeedback(['qw_momentum_2'], 1)).toEqual({
      tier: 1,
      lines: ['You stopped avoiding it and just sent it.'],
    });
  });

  it.each([
    [2, 2, 'Today was a genuinely good day for you.'],
    [6, 2, 'Today was a genuinely good day for you.'],
    [7, 3, 'You touched a lot of different parts of your life today.'],
    [10, 3, 'You touched a lot of different parts of your life today.'],
    [11, 4, "You showed up for almost every part of yourself today. That's worth sitting with for a second."],
    [16, 4, "You showed up for almost every part of yourself today. That's worth sitting with for a second."],
  ])('maps %i checked items to tier %i', (count, tier, line) => {
    const ids = [
      'qw_expression_1',
      'qw_expression_2',
      'qw_awareness_1',
      'qw_awareness_2',
      'qw_momentum_1',
      'qw_momentum_2',
      'qw_direction_1',
      'qw_direction_2',
      'qw_steadiness_1',
      'qw_steadiness_2',
      'qw_confidence_1',
      'qw_confidence_2',
      'qw_gratitude_1',
      'qw_gratitude_2',
      'qw_connection_3',
      'qw_connection_2',
    ].slice(0, count);

    expect(quietWinsFeedback(ids, 0)).toEqual({ tier, lines: [line] });
  });
});
