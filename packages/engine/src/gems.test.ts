import { describe, expect, it } from 'vitest';
import { gemStage } from './gems';

describe('gemStage', () => {
  it.each([[0, 1], [500, 1], [501, 2], [2000, 2], [2001, 3], [4000, 3], [4001, 4], [6000, 4], [6001, 5], [9999, 5], [10000, 6], [50000, 6]])(
    '%i gems -> stage %i',
    (g, s) => expect(gemStage(g)).toBe(s),
  );
});
