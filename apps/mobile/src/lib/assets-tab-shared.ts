/**
 * Shared state contract between the Assets tab parent and its
 * sub-views (CollectionView + AssetsView). Lifted to lib/ so
 * sub-components can import the type without crossing the
 * app/ vs src/ boundary that the TS path alias targets.
 */
import type { WisdomLog } from './wisdoms-api';

export type AssetsTabSharedState = {
  wisdoms: WisdomLog[];
  counts: Record<string, number>;
  totalWords: number;
  collectedKw: number;
  loading: boolean;
};
