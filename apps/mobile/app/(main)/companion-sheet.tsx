import { CompanionSheet } from '../../src/components/main/companion-sheet';

/**
 * Router-owned companion layer. Keeping this in the same native stack as the
 * Kit pages lets a Kit slide over the sheet and reveal the unchanged sheet
 * again when it closes.
 */
export default function CompanionSheetRoute() {
  return <CompanionSheet />;
}
