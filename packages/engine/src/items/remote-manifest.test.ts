import { describe, expect, it } from 'vitest';
import { applyRemoteItemManifest, type RemoteItemManifest } from './remote-manifest';
import type { ItemDictionary } from './item-matcher';

const base: ItemDictionary = {
  items: {
    run: { displayName:'Running', rarity:'common', category:'Activity', keywords:['running'] },
    tea: { displayName:'Tea', rarity:'common', category:'Drink', keywords:['tea'] },
  },
  synonyms: { running:'run', tea:'tea' },
  exclusions: {},
};
const manifest: RemoteItemManifest = {
  schemaVersion:1, version:'123-aabbccdd', baseCatalogVersion:'v1', publishedAt:'2026-08-30T00:00:00Z',
  items:[{
    itemId:'run', iconName:'Running', imageKey:'Items/icons/run/v.webp', assetVersion:'v',
    rarity:'common', category:'Activity', bagsCategory:'Myself', promptCategory:'Exercise & Movement',
    keywordsMapping:['running on the track','running'], replacesBundled:true,
    keywordSafety:[
      {keyword:'running on the track',triggerMode:'AUTO',keywordType:'Phrase'},
      {keyword:'running',triggerMode:'NEVER_AUTO',keywordType:'Word'},
    ],
  },{
    itemId:'remote.air_123',iconName:'Air Conditioner',imageKey:'Items/icons/remote.air_123/v.webp',assetVersion:'v',
    rarity:'common',category:'Object',bagsCategory:'Stuff',promptCategory:'Chores & Home Care',
    keywordsMapping:['air conditioner'],replacesBundled:false,
    keywordSafety:[{keyword:'air conditioner',triggerMode:'AUTO_UNLESS_EXCLUDED',keywordType:'Phrase',exclusions:['air conditioner filter']}],
  }],
};

describe('remote item manifest', () => {
  it('replaces one bundled rule set without changing its stable id', () => {
    const next = applyRemoteItemManifest(base, manifest);
    expect(next.items.run.displayName).toBe('Running');
    expect(next.synonyms.running).toBeUndefined();
    expect(next.synonyms['running on the track']).toBe('run');
    expect(next.synonyms.tea).toBe('tea');
  });
  it('adds reviewed items and exclusions', () => {
    const next = applyRemoteItemManifest(base, manifest);
    expect(next.items['remote.air_123'].displayName).toBe('Air Conditioner');
    expect(next.synonyms['air conditioner']).toBe('remote.air_123');
    expect(next.exclusions?.['air conditioner']).toEqual(['air conditioner filter']);
  });
});
