import { kConnInsights } from '../shared/storage/keys';
import { storage } from './storage';

/** Backwards-compatible envelope for the cache-first Connection dashboard. */
interface AnalysisCacheEnvelope {
  version: 4;
  insights?: unknown;
  history?: unknown;
  historyFetchedAt?: number;
  dashboardDate?: string;
  dashboardFetchedAt?: number;
}

// Connection History can grow to hundreds of cards. MMKV returns the JSON
// synchronously, so reparsing the whole envelope during every dashboard render
// can block the JS thread exactly when a tab press is trying to paint. Keep a
// raw-value keyed in-memory snapshot: external clears still invalidate it
// because the raw MMKV value changes, while normal renders reuse the parse.
let memoizedRaw: string | undefined;
let memoizedEnvelope: AnalysisCacheEnvelope | undefined;

function empty(): AnalysisCacheEnvelope {
  return { version: 4 };
}

export function readAnalysisCache(): AnalysisCacheEnvelope {
  const raw = storage.getString(kConnInsights.name);
  if (!raw) {
    memoizedRaw = undefined;
    memoizedEnvelope = undefined;
    return empty();
  }
  if (raw === memoizedRaw && memoizedEnvelope) return memoizedEnvelope;
  try {
    const parsed = JSON.parse(raw) as AnalysisCacheEnvelope | unknown;
    if (parsed && typeof parsed === 'object' && (parsed as AnalysisCacheEnvelope).version === 4) {
      memoizedRaw = raw;
      memoizedEnvelope = parsed as AnalysisCacheEnvelope;
      return memoizedEnvelope;
    }
    // The former five-field payload cannot be safely mapped into v2's seven
    // evidence-backed modules. Drop it and let the server rebuild naturally.
    return empty();
  } catch {
    memoizedRaw = undefined;
    memoizedEnvelope = undefined;
    return empty();
  }
}

export function patchAnalysisCache(patch: Partial<AnalysisCacheEnvelope>): void {
  const next = { ...readAnalysisCache(), ...patch, version: 4 } satisfies AnalysisCacheEnvelope;
  const raw = JSON.stringify(next);
  storage.set(kConnInsights.name, raw);
  memoizedRaw = raw;
  memoizedEnvelope = next;
}

/** Explicit realtime/foreground invalidation; cached content stays paintable. */
export function invalidateConnectionDashboard(): void {
  patchAnalysisCache({ dashboardDate: '', dashboardFetchedAt: 0 });
}

export function localDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
