/**
 * Illustrated icon set (assets/Icons). React Native require() needs literal
 * paths, so every icon is listed here and referenced by key elsewhere.
 */
import type { ImageSourcePropType } from 'react-native';

export const ICONS: Record<string, ImageSourcePropType> = {
  // Tab bar
  Home: require('../../assets/Icons/Home.png'),
  Bags: require('../../assets/Icons/Bags.png'),
  Quests: require('../../assets/Icons/Quests.png'),
  Friends: require('../../assets/Icons/Friends.png'),
  Me: require('../../assets/Icons/Me.png'),
  // Home top bar
  Menu: require('../../assets/Icons/Menu.png'),
  Outfits: require('../../assets/Icons/Outfits.png'),
  Maps: require('../../assets/Icons/Maps.png'),
  Trophy: require('../../assets/Icons/Trophy.png'),
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
};
