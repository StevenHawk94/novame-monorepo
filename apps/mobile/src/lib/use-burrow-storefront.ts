import { useEffect, useState } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { getStorefront } from 'expo-iap';
import { storage } from './storage';
import { kBurrowStorefrontCountry } from '../shared/storage/keys';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';
import { burrowLocaleCountry } from './burrow-map-model';

function deviceCountry() {
  const settings = NativeModules.SettingsManager?.settings;
  const locale = settings?.AppleLocale ?? settings?.AppleLanguages?.[0]
    ?? NativeModules.I18nManager?.localeIdentifier ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return burrowLocaleCountry(locale);
}

let request: { epoch: number; promise: Promise<string | undefined> } | undefined;
let visualEpoch=-1,visualCountry:string|undefined;
export function countryForVisit(){
  if(visualEpoch!==sessionEpoch()){
    visualEpoch=sessionEpoch();visualCountry=storage.getString(kBurrowStorefrontCountry.name)??deviceCountry();
  }
  return visualCountry;
}
function refreshCountry() {
  const epoch = sessionEpoch();
  if (request?.epoch === epoch) return request.promise;
  const pending = { epoch, promise: Promise.resolve(undefined) as Promise<string | undefined> };
  request = pending;
  pending.promise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') return undefined;
      // IAP is initialized by RootLayout. Never disconnect it from this screen.
      const country = await Promise.race([
        getStorefront(),
        new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 5000); }),
      ]);
      const code = country?.trim().toUpperCase();
      if (!code || !/^[A-Z]{2,3}$/.test(code) || sessionEpoch() !== epoch) return undefined;
      storage.set(kBurrowStorefrontCountry.name, code);
      return code;
    } catch { return undefined; }
    finally {
      if (timer) clearTimeout(timer);
      if (request === pending) request = undefined;
    }
  })();
  return pending.promise;
}

/** Cache first, storefront first, explicit device region as the offline fallback. */
export function useBurrowStorefront() {
  const [country, setCountry] = useState(countryForVisit);
  useEffect(() => {
    // Persist the authoritative storefront for the NEXT foreground visit.
    // All rooms in this visit share one region, including newly mounted rooms.
    const refresh = () => refreshCountry();
    void refresh();
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') { visualCountry=storage.getString(kBurrowStorefrontCountry.name)??deviceCountry();visualEpoch=sessionEpoch();setCountry(countryForVisit());void refresh(); }
    });
    const unsubscribe = subscribeSessionIdentity(() => {
      setCountry(countryForVisit());
      void refresh();
    });
    return () => { foreground.remove(); unsubscribe(); };
  }, []);
  return country;
}
