import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { burrowMapEnvironment } from './burrow-map-model';
import { useBurrowStorefront } from './use-burrow-storefront';
import {getBurrowEnvironment,subscribeBurrowEnvironment} from './burrow-environment-state';

/** The map and every room use the same local season, not a purchased loadout.
 * A cached/device region renders immediately; storefront refresh is silent. */
export function useBurrowEnvironment(timeZone?: string | null, now?: number) {
  const country = useBurrowStorefront();
  const shared=useSyncExternalStore(subscribeBurrowEnvironment,getBurrowEnvironment,getBurrowEnvironment);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (now != null||shared.context) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!active) return;
      setClock(Date.now());
      timer = setTimeout(tick, 60000);
    };
    tick();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setClock(Date.now());
    });
    return () => { active = false; clearTimeout(timer); subscription.remove(); };
  }, [now,!!shared.context]);
  // A retained tab's paused clock cannot roll the shared environment back.
  return shared.context&&shared.environment?shared.environment:burrowMapEnvironment(now ?? clock, timeZone ?? undefined, country);
}
