import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Supabase client singleton for @novame/mobile.
 *
 * Auth storage: AsyncStorage (D6 decision A — simplest, no encryption).
 * Migration path: replace storage adapter without touching call sites
 * if encryption becomes required.
 *
 * Required side effect: react-native-url-polyfill must load before
 * createClient — Supabase v2 uses URL APIs not present in Hermes.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Set them in apps/mobile/.env or via your shell before running expo start.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
