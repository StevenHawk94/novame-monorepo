import { TAP_YOUR_DAY_QUESTIONS, TAP_YOUR_DAY_OPTIONAL_CHOICES } from '@novame/engine';

// Use the picker's question → category → icon order, not API/storage order.
// Optional icons follow the defaults in their own category. Historical IDs
// remain visible at the end in a deterministic order, without changing labels.
const rank = new Map<string, number>();
for (const question of TAP_YOUR_DAY_QUESTIONS) {
  for (const group of question.groups) {
    for (const choice of group.choices) rank.set(choice.itemId, rank.size);
    for (const choice of TAP_YOUR_DAY_OPTIONAL_CHOICES) {
      if (choice.kind === question.kind && choice.group === group.title && !rank.has(choice.itemId)) {
        rank.set(choice.itemId, rank.size);
      }
    }
  }
}

export function orderedTapDayItems<T extends { itemId: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (rank.get(a.itemId) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(b.itemId) ?? Number.MAX_SAFE_INTEGER)
    || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}
