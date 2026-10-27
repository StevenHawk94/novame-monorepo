import type { MajorUpdateCatalogItem } from "@/lib/app-major-update-api";
import { AdventureRewardScreen } from "./adventure-reward-screen";

export function AdventureTreasure({ title, item, coins=0, busy, onClaim, hasFriend = false }: {
  title: string; item?: MajorUpdateCatalogItem | null; coins?:number; busy: boolean;
  onClaim: () => Promise<void>; hasFriend?: boolean;
}) {
  return <AdventureRewardScreen variant="treasure" title={title} item={item} coins={coins} busy={busy} onClaim={onClaim} hasFriend={hasFriend}/>;
}
