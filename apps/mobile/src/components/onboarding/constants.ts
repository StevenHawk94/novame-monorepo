/**
 * Constants used across multiple onboarding screens.
 *
 * Lifted verbatim from old Capacitor OnboardingFlow.js (visual
 * contract preservation — D3 "皮囊一样底层不一样").
 */

// Stage 6: ASPIRE_WORDS is a re-export of @novame/core's ASPIRE_POOL
// so server (generate-card.js AI prompt) and mobile (this onboarding
// picker) share a single source of truth. Adding a new aspire word in
// @novame/core flows here automatically with zero code change here.
// Name retained for visual-contract continuity with the Capacitor
// codebase (the onboarding-picker UI files import { ASPIRE_WORDS }).
export { ASPIRE_POOL as ASPIRE_WORDS } from '@novame/core/constants/aspire-pool';

export const S4_OPTS = [
  { key: 'A' as const, label: 'Closer than I think — I just need clarity.' },
  { key: 'B' as const, label: 'Like a real journey. Some days closer, some days not.' },
  { key: 'C' as const, label: "Far. And that's exactly why I'm here." },
];

export const S4_RESP: Record<'A' | 'B' | 'C', string> = {
  A: "You already know what you need.\nLet's help you hear it clearly.",
  B: "Up some days, not others.\nThat's not a setback. That's what real growth actually looks like.",
  C: "Noted. And respected.\nKnowing exactly where you stand is more honest than most people ever get.",
};

export const S7_OPTS = [
  { key: 'A' as const, label: "I'm ready to stop guessing and start knowing myself." },
  { key: 'B' as const, label: "I'm carrying a lot. I just need somewhere to put it." },
  { key: 'C' as const, label: "I know there's a version of me I haven't met yet." },
  { key: 'D' as const, label: "Honestly? I'm not sure. I just felt like something needed to change." },
];

export const REVIEWS = [
  {
    name: 'Sarah T.',
    avatarFile: 'ob-9-user1.webp',
    text: "I'm the person who used to lie awake rewriting conversations in my head at 2am. Now I just open NovaMe and let it out. Somehow it turns that whole mess into something I can actually work with. I don't know how it does that, but it does.",
  },
  {
    name: 'Michael R.',
    avatarFile: 'ob-9-user2.webp',
    text: "I started using it on a bad day. But then I kept opening it on the normal days too — random thoughts, something that made me laugh, a work thing I couldn't shake. I didn't expect it to matter. But looking back at my cards now, I can actually see myself changing. That's wild.",
  },
  {
    name: 'Elena K.',
    avatarFile: 'ob-9-user3.webp',
    text: "I've read a lot of self-help. Listened to a lot of podcasts. Followed a lot of people who seemed to have it figured out. None of it really stuck. This is different because it's literally made from things I said. It's not someone else's framework. It's just — me, but clearer. I didn't expect that to hit as hard as it did.",
  },
];

export const INITIATIVE_CARD = {
  keywordId: 'action-initiative',
  cardNumber: 1,
  quoteShort:
    "You showed up before you felt ready. That's not small. That's how it always starts.",
  insightFull:
    "Something made you open this app today. Maybe you couldn't name it. Maybe it was just a quiet pull—a feeling that things could be different. That pull is real. And it's been there longer than you think. Most people feel it and scroll past, burying it under noise. But you stopped. You chose to look closer. You don't need to know where this is going yet, nor do you need to have the answers figured out. You just need to stay curious about yourself. That's all this takes. Listen to the quiet.",
};
