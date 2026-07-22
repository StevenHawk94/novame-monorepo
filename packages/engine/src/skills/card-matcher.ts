/**
 * Fixed-library skill acquisition (2026-07 ruling, Q13): reflect text is
 * matched against SKILL_LIBRARY keywords — a pure rule engine, no AI. A card
 * triggers on any keyword substring hit at a word boundary; already-owned
 * cards never re-trigger (PRD §1.4 "已生成的技能不重复匹配").
 *
 * Matching is deliberately simpler than the item matcher: no negation guard
 * (skills reward the theme of what was written, and "didn't overthink" still
 * belongs in Awareness), no per-text cap beyond the library itself. Both are
 * documented choices — revisit with real-corpus tuning before launch.
 */
import { SKILL_LIBRARY, type SkillCard } from '@novame/domain';

/** True when `phrase` occurs in `text` bounded by non-letters on both sides. */
function hasPhrase(text: string, phrase: string): boolean {
  let from = 0;
  while (true) {
    const at = text.indexOf(phrase, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : text[at - 1];
    const afterIdx = at + phrase.length;
    const after = afterIdx >= text.length ? '' : text[afterIdx];
    const boundary = (ch: string) => ch === '' || !/[a-z0-9]/.test(ch);
    if (boundary(before) && boundary(after)) return true;
    from = at + 1;
  }
}

/**
 * Cards newly acquired by this text. `ownedIds` filters out everything the
 * user already holds, so the return value can be inserted verbatim.
 */
export function matchSkillCards(
  text: string,
  ownedIds: ReadonlySet<string> | string[],
): SkillCard[] {
  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds);
  const hay = text.toLowerCase();
  const out: SkillCard[] = [];
  for (const card of SKILL_LIBRARY) {
    if (owned.has(card.id)) continue;
    if (card.keywords.some((k) => hasPhrase(hay, k))) out.push(card);
  }
  return out;
}
