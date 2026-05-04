/**
 * Constants used across multiple onboarding screens.
 *
 * Lifted verbatim from old Capacitor OnboardingFlow.js (visual
 * contract preservation — D3 "皮囊一样底层不一样").
 */

export const ASPIRE_WORDS = [
  'Clear-minded',
  'Present',
  'Peaceful',
  'Focused',
  'Driven',
  'Disciplined',
  'Unbothered',
  'Authentic',
  'Confident',
  'Compassionate',
  'Resilient',
  'Self-Aware',
  'Intentional',
  'Grounded',
  'Radiant',
] as const;

export const S4_OPTS = [
  { key: 'A' as const, label: "I'm almost there." },
  { key: 'B' as const, label: 'It feels like a journey.' },
  { key: 'C' as const, label: 'Honestly? Miles away.' },
];

export const S4_RESP: Record<'A' | 'B' | 'C', string> = {
  A: "Love that energy. Let's close that final gap together.",
  B: "Every great journey starts exactly where you are. You're in the right place.",
  C: "That's completely okay. The biggest transformations often start from the hardest places.",
};

export const S7_OPTS = [
  { key: 'A' as const, label: "I'm ready to discover who I really am." },
  { key: 'B' as const, label: "I'm carrying a lot and need to let it go." },
  { key: 'C' as const, label: 'I just want to become a better version of myself.' },
  { key: 'D' as const, label: "Honestly, I'm just looking for a spark of inspiration." },
];

export const REVIEWS = [
  {
    name: 'Sarah T.',
    avatarFile: 'ob-9-user1.webp',
    text: "I used to overthink everything. Now, instead of spiraling, I just hit 'Release' and talk to my companion. It takes my messy, midnight thoughts and {transforms them into real clarity}. It literally feels like magic.",
  },
  {
    name: 'Michael R.',
    avatarFile: 'ob-9-user2.webp',
    text: "It's not just for the hard days. I record my sudden sparks of inspiration and random daily thoughts here too. Seeing my own life decoded into these {beautiful Wisdom Cards} completely changed how I view myself.",
  },
  {
    name: 'Elena K.',
    avatarFile: 'ob-9-user3.webp',
    text: "I spent years looking for advice from others, but this completely shifted my perspective. It takes my messy, everyday thoughts and reflects back a quiet wisdom I didn't even know I possessed, showing me the answers were already inside me. I'm not trying to become someone else anymore — I'm finally meeting the {best version of myself}.",
  },
];

export const INITIATIVE_CARD = {
  keywordId: 'action-initiative',
  cardNumber: 1,
  quoteShort:
    'The simple act of showing up is the first step of every great awakening.',
  insightFull:
    "The sheer act of showing up is your first profound breakthrough. You are here because a quiet part of you is demanding growth. Many ignore that inner voice, but you chose to listen. This desire to evolve is never just a fleeting thought—it is a grounding strength and the true engine of your transformation. Actively seeking change proves the seeds of your highest self are already taking root. You don't need every answer mapped out today; you only need the courage to begin. Your willingness to change is the magic.",
};
