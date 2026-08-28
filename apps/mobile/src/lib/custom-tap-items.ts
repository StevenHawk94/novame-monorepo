import { useEffect, useRef, useState } from 'react';
import { cleanCustomTapItem, ITEM_DICTIONARY, MAX_CUSTOM_TAP_ITEMS, type CustomTapItem } from '@novame/engine';
import { storage } from './storage';
import { supabase } from './supabase';
import { kCustomTapItems } from '../shared/storage/keys';

const key = kCustomTapItems.keyFor;
function read(userId: string): CustomTapItem[] {
  try {
    const values = JSON.parse(storage.getString(key(userId)) || '[]');
    return Array.isArray(values) ? values.map(v => cleanCustomTapItem(v, ITEM_DICTIONARY)).filter((v): v is CustomTapItem => !!v).slice(0, MAX_CUSTOM_TAP_ITEMS) : [];
  } catch { return []; }
}

/** Account-scoped local preferences, never part of a page's TTL cache. */
export function useCustomTapItems() {
  const [owner, setOwner] = useState<string | null>(null);
  const currentOwner = useRef<string | null>(null);
  const [items, setItems] = useState<CustomTapItem[]>([]);
  useEffect(() => {
    let active = true;
    let authChanged = false;
    const apply = (id: string | undefined) => {
      if (!active) return;
      currentOwner.current = id || null;
      setOwner(id || null);
      setItems(id ? read(id) : []);
    };
    void supabase.auth.getSession().then(({ data }) => { if (!authChanged) apply(data.session?.user.id); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { authChanged = true; apply(session?.user.id); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const save = (item: CustomTapItem) => {
    if (!owner || owner !== currentOwner.current) throw new Error('Your account is still loading. Please try again.');
    const clean = cleanCustomTapItem(item, ITEM_DICTIONARY);
    if (!clean) throw new Error('Please enter a name and choose an item.');
    const prior = read(owner);
    if (prior.length >= MAX_CUSTOM_TAP_ITEMS && !prior.some(v => v.itemId === item.itemId)) {
      throw new Error(`You can keep up to ${MAX_CUSTOM_TAP_ITEMS} custom items.`);
    }
    // One selection per icon: editing its name/group cannot create duplicate memories.
    const next = [...prior.filter(v => v.itemId !== clean.itemId), clean];
    storage.set(key(owner), JSON.stringify(next));
    setItems(next);
  };
  return { items, save, ready: !!owner };
}
