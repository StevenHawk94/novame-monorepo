import legacyChoices from './tap-your-day-v1.json';
import legacyQuestions from './tap-your-day-v2.json';
import localGroups from './tap-your-day-local.json';
import v4Groups from './tap-your-day-v4.json';

/** v5 is the 391-icon workbook; older versions retain their original meanings. */
export const TAP_YOUR_DAY_VERSION = 'tap-your-day-v5';
export const MAX_TAP_YOUR_DAY_SELECTIONS = 30;
export const MAX_REFLECT_ITEMS = 6000;
export type TapYourDayKind = 'activity' | 'food' | 'person' | 'feeling';
export interface TapYourDayChoice { label: string; itemId: string }
export interface TapYourDayGroup { title: string; choices: TapYourDayChoice[] }
export interface TapYourDayQuestion { kind: TapYourDayKind; title: string; groups: TapYourDayGroup[] }

export const TAP_YOUR_DAY_QUESTIONS: TapYourDayQuestion[] = legacyQuestions.map(question => ({
  kind: question.kind as TapYourDayKind, title: question.title,
  groups: localGroups.filter(group => group.kind === question.kind).map(group => ({
    title: question.kind === 'person' || question.kind === 'feeling' ? '' : group.title,
    choices: group.defaults,
  })),
}));
export const TAP_YOUR_DAY_CHOICES = TAP_YOUR_DAY_QUESTIONS.flatMap(question =>
  question.groups.flatMap(section => section.choices.map(choice => ({ ...choice, kind: question.kind }))),
);
export const TAP_YOUR_DAY_OPTIONAL_CHOICES = localGroups.flatMap(group =>
  group.optional.map(choice => ({ ...choice, kind: group.kind as TapYourDayKind, group: group.title, custom: true as const })),
);
export const TAP_YOUR_DAY_LOCAL_CHOICES = [...TAP_YOUR_DAY_CHOICES, ...TAP_YOUR_DAY_OPTIONAL_CHOICES];
const choicesById = new Map(TAP_YOUR_DAY_LOCAL_CHOICES.map(choice => [choice.itemId, choice]));
const v4ById = new Map(v4Groups.flatMap(group => [
  ...group.defaults.map(choice => ({ ...choice, kind: group.kind as TapYourDayKind })),
  ...group.optional.map(choice => ({ ...choice, kind: group.kind as TapYourDayKind, group: group.title, custom: true as const })),
]).map(choice => [choice.itemId, choice]));
const legacyV2ById = new Map(legacyQuestions.flatMap(question => question.groups.flatMap(group =>
  group.choices.map(choice => [choice.itemId, { ...choice, kind: question.kind }] as const),
)));
const legacyById = new Map(legacyChoices.map(choice => [choice.itemId, choice]));
export function tapYourDaySelectionLimit(version: unknown) {
  return typeof version === 'string' && [TAP_YOUR_DAY_VERSION, 'tap-your-day-v4', 'tap-your-day-v3', 'tap-your-day-v2', 'tap-your-day-v1'].includes(version)
    ? MAX_TAP_YOUR_DAY_SELECTIONS : 0;
}
export function tapYourDayChoice(itemId: string, version: string = TAP_YOUR_DAY_VERSION) {
  if (version === TAP_YOUR_DAY_VERSION) return choicesById.get(itemId);
  if (version === 'tap-your-day-v4') return v4ById.get(itemId);
  if (version === 'tap-your-day-v2' || version === 'tap-your-day-v3') return legacyV2ById.get(itemId);
  if (version === 'tap-your-day-v1') return legacyById.get(itemId);
  return undefined;
}
/** Canonical optional labels/groups cannot be reclassified or supplied by a remote catalogue. */
export function localCustomTapItem(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.custom !== true || typeof v.itemId !== 'string') return null;
  return TAP_YOUR_DAY_OPTIONAL_CHOICES.find(choice => choice.itemId === v.itemId) ?? null;
}
