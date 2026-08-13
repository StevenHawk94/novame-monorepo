import { kConnInsights } from '../shared/storage/keys';
import { storage } from './storage';

/** One backwards-compatible envelope for the two connection analysis pages. */
interface AnalysisCacheEnvelope {
  version: 2;
  insights?: unknown;
  dashboardDate?: string;
  dashboardFetchedAt?: number;
  patterns?: unknown;
  patternsFetchedAt?: number;
}

function empty(): AnalysisCacheEnvelope {
  return { version: 2 };
}

export function readAnalysisCache(): AnalysisCacheEnvelope {
  const raw = storage.getString(kConnInsights.name);
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as AnalysisCacheEnvelope | unknown;
    if (parsed && typeof parsed === 'object' && (parsed as AnalysisCacheEnvelope).version === 2) {
      return parsed as AnalysisCacheEnvelope;
    }
    // v1 stored InsightsResult directly. Preserve it during the migration.
    return { version: 2, insights: parsed };
  } catch {
    return empty();
  }
}

export function patchAnalysisCache(patch: Partial<AnalysisCacheEnvelope>): void {
  storage.set(kConnInsights.name, JSON.stringify({ ...readAnalysisCache(), ...patch, version: 2 }));
}

export function localDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
