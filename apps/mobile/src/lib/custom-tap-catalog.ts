import { TAP_YOUR_DAY_OPTIONAL_CHOICES, localCustomTapItem, type CustomTapItem, type TapYourDayChoice, type TapYourDayQuestion } from '@novame/engine';

export const CUSTOM_TAP_GROUPS = [...new Map(TAP_YOUR_DAY_OPTIONAL_CHOICES.map(choice =>
  [choice.group, { title: choice.group, kind: choice.kind }],
)).values()];
export function canAddCustomTapItem(question: TapYourDayQuestion) {
  return TAP_YOUR_DAY_OPTIONAL_CHOICES.some(choice => choice.kind === question.kind);
}
export function customTapGroupsForQuestion(question: TapYourDayQuestion, items: CustomTapItem[]) {
  const rows = question.groups.map(group => ({ ...group, choices: [...group.choices] as (TapYourDayChoice & Partial<CustomTapItem>)[] }));
  const seen = new Set(rows.flatMap(group => group.choices.map(choice => choice.itemId)));
  for (const value of items) {
    const item = localCustomTapItem(value);
    if (!item || item.kind !== question.kind || seen.has(item.itemId)) continue;
    rows.find(group => group.title === item.group)?.choices.push(item);
    seen.add(item.itemId);
  }
  return rows.filter(group => group.choices.length);
}
