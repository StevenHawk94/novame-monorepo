import { kConnInsights } from '../shared/storage/keys';
import { storage } from './storage';

/** One backwards-compatible envelope for the two connection analysis pages. */
interface AnalysisCacheEnvelope {
  version: 3;
  insights?: unknown;
  dashboardDate?: string;
  dashboardFetchedAt?: number;
  patterns?: unknown;
  patternsFetchedAt?: number;
}

function empty(): AnalysisCacheEnvelope {
  return { version: 3 };
}

export function readAnalysisCache(): AnalysisCacheEnvelope {
  const raw = storage.getString(kConnInsights.name);
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as AnalysisCacheEnvelope | unknown;
    if (parsed && typeof parsed === 'object' && (parsed as AnalysisCacheEnvelope).version === 3) {
      return parsed as AnalysisCacheEnvelope;
    }
    // The former five-field payload cannot be safely mapped into v2's seven
    // evidence-backed modules. Drop it and let the server rebuild naturally.
    return empty();
  } catch {
    return empty();
  }
}

export function patchAnalysisCache(patch: Partial<AnalysisCacheEnvelope>): void {
  storage.set(kConnInsights.name, JSON.stringify({ ...readAnalysisCache(), ...patch, version: 3 }));
}

/** Explicit realtime/foreground invalidation; cached content stays paintable. */
export function invalidateConnectionDashboard(): void {
  patchAnalysisCache({ dashboardDate: '', dashboardFetchedAt: 0 });
}

export function localDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
