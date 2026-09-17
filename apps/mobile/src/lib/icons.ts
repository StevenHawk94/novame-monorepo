/**
 * Illustrated icon set (assets/Icons). React Native require() needs literal
 * paths, so every icon is listed here and referenced by key elsewhere.
 */
import type { ImageSourcePropType } from 'react-native';

export const ICONS: Record<string, ImageSourcePropType> = {
  // Tab bar
  Home: require('../../assets/Icons/Home.png'),
  Bags: require('../../assets/Icons/Bags.png'),
  Memories: require('../../assets/Icons/Memories.png'),
  Quests: require('../../assets/Icons/Quests.png'),
  Friends: require('../../assets/Icons/Friends.png'),
  Me: require('../../assets/Icons/Me.png'),
  // Home top bar
  Menu: require('../../assets/Icons/Menu.png'),
  Outfits: require('../../assets/Icons/Outfits.png'),
  Maps: require('../../assets/Icons/Maps.png'),
  // Kits (companion sheet)
  NewLens: require('../../assets/Icons/NewLens.png'),
  TrueNorth: require('../../assets/Icons/TrueNorth.png'),
  SmallWins: require('../../assets/Icons/SmallWins.png'),
  TameEnemy: require('../../assets/Icons/TameEnemy.png'),
  VisitMaster: require('../../assets/Icons/VisitMaster.png'),
  // Quest themes
  ThemeCustom: require('../../assets/Icons/ai-robot.png'),
  ThemeFitness: require('../../assets/Icons/fitness.png'),
  ThemeWeightLoss: require('../../assets/Icons/weightloss.png'),
  ThemeStudy: require('../../assets/Icons/study.png'),
  ThemeWork: require('../../assets/Icons/work.png'),
  ThemeParenting: require('../../assets/Icons/parenting.png'),
  ThemeWater: require('../../assets/Icons/water.png'),
  ThemeMindfulness: require('../../assets/Icons/mindfulness.png'),
  ThemeWriteOwn: require('../../assets/Icons/custom.png'),
  // Misc
  interact: require('../../assets/Icons/interact.png'),
  Clover: require('../../assets/Icons/clovers.png'),
  Clovers: require('../../assets/Icons/clovers.png'),
  Plus: require('../../assets/Icons/plus.png'),
  send: require('../../assets/Icons/send.png'),
  visitMasterHistory: require('../../assets/Icons/visit-master-history.png'),
  // Reflect entry (three ways in)
  reflectEntry1: require('../../assets/Icons/reflect-entry1.png'),
  reflectEntry2: require('../../assets/Icons/reflect-entry2.png'),
  reflectEntry3: require('../../assets/Icons/reflect-entry3.png'),
  guidePaired: require('../../assets/Icons/friend-list.png'),
  guideConnection: require('../../assets/Icons/reflect-someone.png'),
  guideMemories: require('../../assets/Icons/Memories.png'),
  guideBunny: require('../../assets/Icons/bunny.png'),
  guideQuests: require('../../assets/Icons/Week-Plan.png'),
  // Connection Dashboard (unpaired teaser cards + relationship surfaces)
  friendList: require('../../assets/Icons/friend-list.png'),
  connect1: require('../../assets/Icons/connect-1.png'),
  connect2: require('../../assets/Icons/connect-2.png'),
  connect3: require('../../assets/Icons/connect-3.png'),
  connect4: require('../../assets/Icons/connect-4.png'),
  // Shared with Memories Cave
  calendar: require('../../assets/Icons/calendar.png'),
  history: require('../../assets/Icons/history.png'),
  connectionNew: require('../../assets/Icons/connection-new.png'),
  personalVibe: require('../../assets/Icons/personal-vibe.png'),
  weekPlan: require('../../assets/Icons/Week-Plan.png'),
  setting: require('../../assets/Icons/setting.png'),
  privacy: require('../../assets/Icons/privacy.png'),
  memory: require('../../assets/Icons/memory.png'),
  add: require('../../assets/Icons/add.png'),
  sharedMemories: require('../../assets/Icons/shared-memories.png'),
  // Onboarding v3 (grid background + screen art)
  obWhoPartner: require('../../assets/Icons/ob2-partner.png'),
  obWhoFriends: require('../../assets/Icons/ob2-friends.png'),
  obWhoMomDad: require('../../assets/Icons/Mom-Dad.png'),
  obWhoSonDaughter: require('../../assets/Icons/Son-Daughter.png'),
  obWhoSpecial: require('../../assets/Icons/ob2-special.png'),
  obCreatorBubble: require('../../assets/Icons/ob-12.png'),
  obPaywallUnlock: require('../../assets/Icons/paywall-unlock.png'),
  obIcons: require('../../assets/onboarding/onboarding-icons.webp'),
  obRelationship: require('../../assets/onboarding/page-3.webp'),
  obCloseness: require('../../assets/onboarding/page-5.webp'),
  obShareMoments: require('../../assets/onboarding/page-6.webp'),
  obInsightQuestion: require('../../assets/onboarding/page-10.webp'),
  // Compatibility aliases used by the loading/privacy surfaces and the
  // unmounted pre-redesign onboarding definitions.
  obQuestion: require('../../assets/onboarding/page-3.webp'),
  obWidgetPhone: require('../../assets/onboarding/page-6.webp'),
  obBunnyHead: require('../../assets/characters/Default.webp'),
  obCourtLove: require('../../assets/bunny-court/love court.webp'),
  obCourtLife: require('../../assets/bunny-court/life court.webp'),
  obCourtConflict: require('../../assets/bunny-court/conflict court.webp'),
  obCourtJudge: require('../../assets/bunny-court/judge-bunny.webp'),
  reflectJournalling: require('../../assets/Icons/reflect-journalling.png'),
};

/** Reflect prompt illustrations, keyed by prompt id (domain REFLECT_PROMPTS). */
export const REFLECT_PROMPT_ICONS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/Icons/reflect-journalling.png'),
  2: require('../../assets/Icons/reflect-someone.png'),
  3: require('../../assets/Icons/reflect-feeling.png'),
  4: require('../../assets/Icons/reflect-learning.png'),
  5: require('../../assets/Icons/reflect-proud.png'),
  6: require('../../assets/Icons/reflect-realization.png'),
  7: require('../../assets/Icons/reflect-challenge.png'),
  8: require('../../assets/Icons/reflect-appreciation.png'),
  9: require('../../assets/Icons/reflect-open-reflection.png'),
};

/** Friends Cave art set (design: friends mocks). */
export const FRIEND_ICONS = {
  friendList: require('../../assets/Icons/friend-list.png'),
  sharedMemories: ICONS.sharedMemories,
  memory: ICONS.memory,
  calendar: ICONS.calendar,
  setting: ICONS.setting,
  privacy: ICONS.privacy,
} as const;

/** Full-bleed screen backgrounds (assets/Background). */
export const BACKGROUNDS = {
  court: require('../../assets/bunny-court/forest-court.webp'),
  reflect: require('../../assets/Background/reflection.webp'),
  friends: require('../../assets/Background/friends.webp'),
  tameEnemy: require('../../assets/monsters/monster-bg.webp'),
  visitMaster: require('../../assets/Background/visit-master.webp'),
} as const;

/** Good Vibes artwork, index-aligned with GOOD_VIBE_MESSAGES. */
export const GOOD_VIBE_ART: readonly ImageSourcePropType[] = [
  require('../../assets/Good Vibes/love you to bits.webp'),
  require('../../assets/Good Vibes/so grateful for you.webp'),
  require('../../assets/Good Vibes/always by your side.webp'),
  require('../../assets/Good Vibes/you mean the world.webp'),
  require('../../assets/Good Vibes/rooting for you always.webp'),
  require('../../assets/Good Vibes/good things are coming.webp'),
  require('../../assets/Good Vibes/you\'ve got this.webp'),
  require('../../assets/Good Vibes/keep shinning your light.webp'),
  require('../../assets/Good Vibes/ride or die, no cap.webp'),
  require('../../assets/Good Vibes/proud of you always.webp'),
  require('../../assets/Good Vibes/sending a big hug.webp'),
  require('../../assets/Good Vibes/thinking of you today.webp'),
  require('../../assets/Good Vibes/tomorrow\'s a fresh start.webp'),
  require('../../assets/Good Vibes/delulu is the solulu.webp'),
  require('../../assets/Good Vibes/don\'t let idiots ruin your day.webp'),
  require('../../assets/Good Vibes/main character energy only.webp'),
  require('../../assets/Good Vibes/more expresso,less depresso.webp'),
  require('../../assets/Good Vibes/in my rest, healing era.webp'),
  require('../../assets/Good Vibes/slay the day then take a nap.webp'),
  require('../../assets/Good Vibes/kindness is cool, drama is not.webp'),
  require('../../assets/Good Vibes/overthining, but make it cute.webp'),
  require('../../assets/Good Vibes/everyday counts, truly.webp'),
  require('../../assets/Good Vibes/big wins ahead today.webp'),
  require('../../assets/Good Vibes/forever on your team.webp'),
  require('../../assets/Good Vibes/my favorite notification is you.webp'),
];
