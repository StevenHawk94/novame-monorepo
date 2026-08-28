import { TAP_YOUR_DAY_QUESTIONS, type CustomTapItem, type TapYourDayChoice, type TapYourDayQuestion } from '@novame/engine';
import { PROMPT_CATEGORIES } from './guided-catalog.g';

/** Destinations are the ten visible headings, not the spreadsheet's icon taxonomy. */
export const CUSTOM_TAP_GROUPS = TAP_YOUR_DAY_QUESTIONS.flatMap(question =>
  question.groups.filter(group => !!group.title).map(group => ({ title: group.title, kind: question.kind })),
);

/** The generated subcategory map has ten Main_Category parents. Parent itemIds are empty. */
export const CUSTOM_TAP_ICON_CATEGORIES = PROMPT_CATEGORIES.filter(category => category.subcategories.length > 0)
  .map(category => ({
    key: category.key,
    label: category.label,
    itemIds: [...new Set(category.subcategories.flatMap(group => group.itemIds))],
  }));

export function canAddCustomTapItem(question: TapYourDayQuestion) {
  return question.groups.some(group => !!group.title);
}

export function customTapDestination(title: string) {
  return CUSTOM_TAP_GROUPS.find(group => group.title === title);
}

export function customTapGroupsForQuestion(question: TapYourDayQuestion, items: CustomTapItem[]) {
  const rows = question.groups.map(group => ({ ...group, choices: [...group.choices] as (TapYourDayChoice & Partial<CustomTapItem>)[] }));
  for (const item of items) {
    const destination = customTapDestination(item.group);
    const kind = destination?.kind ?? item.kind;
    if (kind !== question.kind) continue;
    // Older clients allowed arbitrary groups (including people/feelings).
    // Keep those choices visible in the first existing group; never erase or
    // rewrite the user's account-scoped cache just to change the picker UI.
    const target = rows.find(group => group.title === destination?.title) ?? rows[0];
    target?.choices.push({ ...item, kind, group: target.title });
  }
  return rows.filter(group => group.choices.length);
}
