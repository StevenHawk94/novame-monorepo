import { describe, expect, it } from 'vitest';

import { LENS_THEMES, LENS_THEME_KEYS } from './lens-themes';

describe('New Lens themes', () => {
  it('keeps the 11 stable content-library keys', () => {
    expect(LENS_THEME_KEYS).toEqual([
      'expression',
      'awareness',
      'momentum',
      'direction',
      'steadiness',
      'confidence',
      'gratitude',
      'connection',
      'comparison',
      'fear_of_wrong',
      'running_empty',
    ]);
  });

  it('does not attach retired growth dimensions to New Lens themes', () => {
    expect(LENS_THEMES.every((theme) => !('dimension' in theme))).toBe(true);
  });
});
