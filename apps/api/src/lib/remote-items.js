/**
 * Item matching is bundle-owned. The retired R2 Items manifest no longer
 * exists; retain this async compatibility boundary for API call sites without
 * introducing a network request on every reflection.
 */
import { ITEM_DICTIONARY } from '@novame/engine'

export async function getMergedDictionary() {
  return ITEM_DICTIONARY
}
