import { describe, it, expect } from 'vitest';
import { applyItemRules } from './item-rules';
import { matchItems, type ItemDictionary } from './item-matcher';
import { cleanCustomTapItem } from './custom-tap-items';
import { tapYourDaySelectionLimit } from './tap-your-day';
const base: ItemDictionary = { items: { a: { displayName:'Running', rarity:'common', category:'Activity' }, b: { displayName:'Business',rarity:'common',category:'Activity' } }, synonyms:{ jog:'a' } };
describe('reviewed matching rules', () => {
  it('adds phrases, disables exact rules, resets safely without mutating the catalog', () => {
    const added = applyItemRules(base,[{ keyword:'running on the track',item_id:'a',action:'enable',revision:1 }]);
    expect(matchItems('running on the track',added)[0]?.itemId).toBe('a');
    expect(matchItems('running a business',added)).toEqual([]);
    expect(base.synonyms['running on the track']).toBeUndefined();
    expect(applyItemRules(base,[{keyword:'jog',item_id:'a',action:'disable',revision:2}]).synonyms.jog).toBeUndefined();
    expect(applyItemRules(base,[{keyword:'jog',item_id:'a',action:'reset',revision:3}]).synonyms.jog).toBe('a');
    expect(applyItemRules(base,[{keyword:'running',item_id:'a',action:'enable',revision:4}]).synonyms.running).toBeUndefined();
  });
  it('records all accepted keyword rules, never a negated match', () => {
    const dict = {...base,synonyms:{jog:'a',jogging:'a'}};
    expect(matchItems('jog and jogging',dict)[0].matchedKeywords).toEqual(['jog','jogging']);
    expect(matchItems('never jog',dict)).toEqual([]);
  });
  it('validates custom selections and keeps legacy limits', () => {
    expect(cleanCustomTapItem({itemId:'a',label:'  Track training ',group:'Movement',kind:'activity',custom:true},base)?.label).toBe('Track training');
    expect(cleanCustomTapItem({itemId:'unknown',label:'x',group:'x',kind:'activity'},base)).toBeNull();
    expect(tapYourDaySelectionLimit('tap-your-day-v2')).toBe(30);
    expect(tapYourDaySelectionLimit('tap-your-day-v3')).toBe(30);
  });
});
