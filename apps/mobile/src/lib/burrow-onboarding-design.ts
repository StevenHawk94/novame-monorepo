export const ONBOARDING_CREAM = '#FCF4E8';
export const ONBOARDING_INK = '#49270F';
export const ONBOARDING_SOIL = '#572B1A';
export const BURROW_LAUNCH_BACKGROUND = '#3D160B';
export const BURROW_LAUNCH_LOGO = require('../../assets/icon.png');
export const ONBOARDING_ART = {
  welcome: require('../../assets/burrow-webp/onboarding-pages/ob1.webp'),
  wordmark: require('../../assets/burrow-webp/onboarding-pages/ob1-1.webp'),
  invite: require('../../assets/burrow-webp/onboarding-pages/ob7.webp'),
  landscape: require('../../assets/burrow-webp/burrow-page/autumn-day.webp'),
};
export const ONBOARDING_FEATURES = [
  { id: 'decorate', image: require('../../assets/burrow-webp/onboarding-pages/ob2.webp'), title: 'Decorate Your Room', description: 'Make a cozy burrow for each of you, your way.' },
  { id: 'toy', image: require('../../assets/burrow-webp/onboarding-pages/ob3.webp'), title: 'Keep Them Close', description: 'A plush of your partner to squeeze and play with in your room.' },
  { id: 'affection', image: require('../../assets/burrow-webp/onboarding-pages/ob4.webp'), title: 'Show Your Love', description: 'Send hugs, kisses & more your partner can see.' },
  { id: 'games', image: require('../../assets/burrow-webp/onboarding-pages/ob5.webp'), title: 'Play and Feel Closer', description: 'Fun couple games to get to know each other better.' },
  { id: 'explore', image: require('../../assets/burrow-webp/onboarding-pages/ob6.webp'), title: 'Explore The Burrow', description: 'Go on adventures underground and discover gifts and treasures.' },
] as const;
export type OnboardingStep = 'start' | (typeof ONBOARDING_FEATURES)[number]['id'] | 'self-info' | 'profile-photo' | 'pairing' | 'pairing-success' | 'paywall' | 'plans' | 'connect';
export const ONBOARDING_FLOW: OnboardingStep[] = ['start', ...ONBOARDING_FEATURES.map(page => page.id), 'self-info', 'profile-photo', 'pairing', 'pairing-success', 'paywall', 'plans'];

/** Width governs reference proportions; short screens shrink artwork before copy/controls. */
export function onboardingMetrics(width: number, height: number, top: number, bottom: number) {
  const scale = Math.min(width / 900, 0.7);
  const footer = Math.max(82, 220 * scale + bottom);
  const heroHeight = Math.min(width * 1.16, Math.max(200, (height - footer - top) * 0.78));
  return { scale, footer, heroHeight, title: Math.min(38, 78 * scale), body: Math.min(21, 44 * scale),
    padding: Math.max(20, width * .066), buttonHeight: Math.max(50, 125 * scale) };
}
