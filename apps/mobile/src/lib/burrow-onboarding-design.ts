export const ONBOARDING_CREAM = '#FCF4E8';
export const ONBOARDING_INK = '#49270F';
export const ONBOARDING_SOIL = '#572B1A';
export const BURROW_LAUNCH_BACKGROUND = '#3f150b';
export const BURROW_LAUNCH_LOGO = require('../../assets/branding/splash-logo.png');
export const ONBOARDING_ART = {
  welcome: require('../../assets/burrow-webp/onboarding-pages/ob1.webp'),
  wordmark: require('../../assets/burrow-webp/onboarding-pages/ob1-1.webp'),
  landscape: require('../../assets/burrow-webp/burrow-page/autumn-day.webp'),
};
export const ONBOARDING_FEATURES = [
  { id: 'decorate', image: require('../../assets/burrow-webp/onboarding-pages/ob2.webp'), title: 'Decorate Your Room', description: 'Make a cozy burrow for each of you, your way.' },
  { id: 'toy', image: require('../../assets/burrow-webp/onboarding-pages/ob3.webp'), title: 'Keep Them Close', description: 'A plush of your partner to squeeze and play with in your room.' },
  { id: 'affection', image: require('../../assets/burrow-webp/onboarding-pages/ob4.webp'), title: 'Show Your Love', description: 'Send hugs, kisses & more your partner can see.' },
  { id: 'surprise', image: require('../../assets/burrow-webp/onboarding-pages/ob5.webp'), title: 'Make Their Day', description: 'Send a silly face and a sweet voice message, and make them smile.' },
  { id: 'games', image: require('../../assets/burrow-webp/onboarding-pages/ob6.webp'), title: 'Play and Feel Closer', description: 'Fun couple games to get to know each other better.' },
  { id: 'explore', image: require('../../assets/burrow-webp/onboarding-pages/ob7.webp'), title: 'Explore The Burrow', description: 'Let your bunny explore the burrow, find gifts and meet new friends!' },
] as const;
export type OnboardingStep = 'start' | (typeof ONBOARDING_FEATURES)[number]['id'] | 'self-info' | 'profile-photo' | 'relationship-date' | 'choose-bunny' | 'pairing' | 'pairing-success' | 'paywall' | 'plans' | 'connect';
export const ONBOARDING_FLOW: OnboardingStep[] = ['start', ...ONBOARDING_FEATURES.map(page => page.id), 'self-info', 'profile-photo', 'relationship-date', 'choose-bunny', 'pairing', 'pairing-success', 'paywall', 'plans'];

/** Width governs reference proportions; short screens shrink artwork before copy/controls. */
export function onboardingMetrics(width: number, height: number, top: number, bottom: number) {
  const scale = Math.min(width / 900, 0.7);
  const footer = Math.max(82, 220 * scale + bottom);
  const heroHeight = Math.min(width * 1.16, Math.max(200, (height - footer - top) * 0.78));
  return { scale, footer, heroHeight, title: Math.min(38, 78 * scale), body: Math.min(21, 44 * scale),
    padding: Math.max(20, width * .066), buttonHeight: Math.max(50, 125 * scale) };
}

/** All six updated illustrations share an 800×800 canvas. Reserve the same
 * art/copy slots on every page; shrink art first on short screens, never crop it. */
export function onboardingFeatureMetrics(width: number, height: number, top: number, bottom: number) {
  const m = onboardingMetrics(width, height, top, bottom);
  // Include the real button/dots/safe-area stack, not just its minimum height.
  const footer = Math.max(m.footer, 10 + Math.max(50, width * 125 / 900) + 20 + 9 + Math.max(18, bottom + 12));
  const contentHeight = height - footer;
  // Inter ExtraBold's widest feature title is ~10.22 em. Use one size for all
  // titles rather than letting each page independently shrink its text.
  const title = Math.min(m.title, (width - 2 * m.padding) / 10.3);
  const copyGap = width * .045;
  const copyHeight = title * 1.2 + copyGap + m.body * 1.35 * 3 + 24;
  const artTop = Math.max(top, height * .115);
  const artCopyGap = width * .145;
  const titleTop = Math.max(artTop + artCopyGap, Math.min(height * .61, contentHeight - copyHeight));
  const artHeight = Math.max(0, Math.min(width * .92, titleTop - artTop - artCopyGap));
  return { artTop, artHeight, artWidth: artHeight, titleTop, title, copyGap, footer };
}

/** Welcome has its own reference composition; profile forms keep their layout. */
export function onboardingWelcomeMetrics(width:number,height:number) {
  return {wordmarkTop:height*.245,wordmarkWidth:width*.74,wordmarkHeight:width*.37,
    bunnyTop:height*.42,bunnyWidth:width*.38,bunnyHeight:width*.456,copyTop:height*.68};
}
