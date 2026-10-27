import { useEffect, useRef, useState } from 'react';
import { localCustomTapItem, TAP_YOUR_DAY_OPTIONAL_CHOICES, type CustomTapItem } from '@novame/engine';
import { storage } from './storage';
import { supabase } from './supabase';
import { kCustomTapItems, kLocalTapItems } from '../shared/storage/keys';

const key = kLocalTapItems.keyFor;
function read(userId: string): CustomTapItem[] {
  try {
    // Import approved optional IDs without erasing legacy names/groups.
    const values = JSON.parse(storage.getString(key(userId)) ?? storage.getString(kCustomTapItems.keyFor(userId)) ?? '[]');
    return Array.isArray(values) ? [...new Map(values.map(localCustomTapItem).filter((v): v is CustomTapItem => !!v).map(v => [v.itemId, v])).values()] : [];
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
    void supabase.auth.getSession().then(({ data }) => { if (!authChanged) apply(data.session?.user.id); }).catch(() => {
      if (!authChanged) apply(undefined);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { authChanged = true; apply(session?.user.id); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const save = (item: CustomTapItem) => {
    if (!owner || owner !== currentOwner.current) throw new Error('Your account is still loading. Please try again.');
    const clean = localCustomTapItem(item);
    if (!clean) throw new Error('Please choose an available activity.');
    const prior = read(owner);
    if (prior.length >= TAP_YOUR_DAY_OPTIONAL_CHOICES.length && !prior.some(v => v.itemId === item.itemId)) {
      throw new Error('All available activities have already been added.');
    }
    // One canonical selection per icon; repeated Add cannot create duplicates.
    const next = [...prior.filter(v => v.itemId !== clean.itemId), clean];
    storage.set(key(owner), JSON.stringify(next));
    setItems(next);
  };
  return { items, save, ready: !!owner };
}
