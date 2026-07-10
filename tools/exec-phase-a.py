#!/usr/bin/env python3
"""Phase A -- delete v1, leave the v2.0 route tree standing. One commit.

Three primitives:

    DELETE    git rm, driven by tools/v2-classification.txt (72 files)
    WRITE     whole-file content. Used for new screens, and for rewrites of
              files small enough that patching them is more fragile than
              replacing them.
    ACTIONS   surgical edits to files too large to rewrite:
                DELETE_LINE(substr)     drop the whole line containing substr
                REPLACE(old, new, n)    old must appear exactly n times

Why every anchor is checked before anything is written
-----------------------------------------------------
The alternative -- assert, write, assert, write -- leaves the fifteenth
failure sitting on top of fourteen applied edits, with `git checkout` the only
way back. Anchors go stale when a comment is reworded or indentation shifts,
so this is not hypothetical.

DELETE_LINE matches a substring and removes the whole line. Indentation is
never part of the anchor, because indentation is exactly what you cannot read
reliably out of a terminal.

Usage:
    python3 tools/exec-phase-a.py            # pre-check, writes nothing
    python3 tools/exec-phase-a.py --apply
"""
import subprocess
import sys
from pathlib import Path

DELETE_LINE = 'DELETE_LINE'
REPLACE = 'REPLACE'

BG = '#0F0B2E'


def read_deletes():
    out = []
    for line in Path('tools/v2-classification.txt').read_text(encoding='utf-8').splitlines():
        line = line.split('#')[0].strip()
        if line and line.split(None, 1)[0] == 'DELETE':
            out.append(line.split(None, 1)[1])
    return out


def tab_stub(title, note):
    return (
        "import { StyleSheet, Text, View } from 'react-native';\n"
        "import { SafeAreaView } from 'react-native-safe-area-context';\n\n"
        "/**\n"
        " * " + title + " tab -- Phase A placeholder.\n"
        " *\n"
        " * Phase A deleted v1 and left the route tree standing. Nothing here is a\n"
        " * design decision: the screen exists so expo-router has a file to resolve\n"
        " * and so the five-tab bar is walkable.\n"
        " *\n"
        " * " + note + "\n"
        " */\n"
        "export default function " + title + "Screen() {\n"
        "  return (\n"
        "    <SafeAreaView style={styles.root} edges={['top']}>\n"
        "      <View style={styles.center}>\n"
        "        <Text style={styles.title}>" + title + "</Text>\n"
        "      </View>\n"
        "    </SafeAreaView>\n"
        "  );\n"
        "}\n\n"
        "const styles = StyleSheet.create({\n"
        "  root: { flex: 1, backgroundColor: '" + BG + "' },\n"
        "  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },\n"
        "  title: {\n"
        "    color: 'rgba(255,255,255,0.35)',\n"
        "    fontSize: 15,\n"
        "    fontFamily: 'Inter_600SemiBold',\n"
        "  },\n"
        "});\n"
    )


def modal_stub(title, comp, note):
    return (
        "import { Pressable, StyleSheet, Text, View } from 'react-native';\n"
        "import { useSafeAreaInsets } from 'react-native-safe-area-context';\n"
        "import { useRouter } from 'expo-router';\n\n"
        "/**\n"
        " * " + title + " -- Phase A placeholder.\n"
        " *\n"
        " * " + note + "\n"
        " */\n"
        "export default function " + comp + "() {\n"
        "  const insets = useSafeAreaInsets();\n"
        "  const router = useRouter();\n"
        "  return (\n"
        "    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>\n"
        "      <Pressable onPress={() => router.back()} style={styles.close}>\n"
        "        <Text style={styles.closeText}>Close</Text>\n"
        "      </Pressable>\n"
        "      <View style={styles.center}>\n"
        "        <Text style={styles.title}>" + title + "</Text>\n"
        "      </View>\n"
        "    </View>\n"
        "  );\n"
        "}\n\n"
        "const styles = StyleSheet.create({\n"
        "  root: { flex: 1, backgroundColor: '" + BG + "', paddingHorizontal: 20 },\n"
        "  close: { alignSelf: 'flex-start', padding: 8 },\n"
        "  closeText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },\n"
        "  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },\n"
        "  title: {\n"
        "    color: 'rgba(255,255,255,0.35)',\n"
        "    fontSize: 15,\n"
        "    fontFamily: 'Inter_600SemiBold',\n"
        "  },\n"
        "});\n"
    )


WRITES = {}

WRITES['apps/mobile/app/(main)/(tabs)/bags.tsx'] = tab_stub(
    'Bags',
    'The object grid, object detail, and memory feed land in Phase C, once the\n'
    ' * item dictionary and the matcher engine exist.')
WRITES['apps/mobile/app/(main)/(tabs)/skills.tsx'] = tab_stub(
    'Skills',
    'The eight dimension decks and the card flip land in Phase C.')
WRITES['apps/mobile/app/(main)/(tabs)/friends.tsx'] = tab_stub(
    'Friends',
    'Friend codes, the item summary row, and Guess Their Day land in Phase C.')
WRITES['apps/mobile/app/(main)/(tabs)/status.tsx'] = tab_stub(
    'Status',
    'The five-stage portrait and the eight gem counters land in Phase C.\n'
    ' * Account settings stay where they are, in (modals)/me.tsx.')

WRITES['apps/mobile/app/(main)/(modals)/me.tsx'] = modal_stub(
    'Me', 'MeScreen',
    'Gutted in Phase A: every number it displayed came from character-state,\n'
    ' * me-stats, or the aspire gauges, and the first two are being replaced\n'
    ' * while the third is gone. Rebuilt in Phase C against companions and gems.')
WRITES['apps/mobile/app/(main)/(modals)/skin-select.tsx'] = modal_stub(
    'Skins', 'SkinSelectScreen',
    'Six outfits on one character, unlocked by level. Phase C: three companions,\n'
    ' * six forms each (none + five costumes), unlocked by XP.')
WRITES['apps/mobile/app/(main)/(modals)/product-detail.tsx'] = modal_stub(
    'Product', 'ProductDetailScreen',
    'The unlock gate read uniqueKeywords >= 48. v2.0 sells an object codex and a\n'
    ' * printed skill deck, gated on objects collected. Rebuilt in Phase C.')

WRITES['apps/mobile/src/components/modals/skin-unlock-modal.tsx'] = (
    "/**\n"
    " * Phase A placeholder.\n"
    " *\n"
    " * The v1 modal statically require()'d six char-1 outfit images and read the\n"
    " * unlocked set from character-state. Both are gone. (tabs)/_layout.tsx no\n"
    " * longer mounts this; Phase C rewires it against companion skins and the XP\n"
    " * thresholds in @novame/domain.\n"
    " */\n"
    "export function SkinUnlockModal(): null {\n"
    "  return null;\n"
    "}\n"
)

WRITES['apps/mobile/app/(main)/reflect.tsx'] = (
    "import { Pressable, StyleSheet, Text, View } from 'react-native';\n"
    "import { useSafeAreaInsets } from 'react-native-safe-area-context';\n"
    "import { useRouter } from 'expo-router';\n\n"
    "/**\n"
    " * Reflect -- Phase A placeholder.\n"
    " *\n"
    " * Replaces (main)/record.tsx, whose 3,028 lines were half audio capture\n"
    " * (removed by decision D2) and half a publish pipeline against tables that\n"
    " * no longer exist. Phase C: prompt selection, typed input capped at 5,000\n"
    " * characters, object matching, and the skill roll.\n"
    " *\n"
    " * fullScreenModal is inherited from (main)/_layout.tsx and is deliberate: it\n"
    " * is the only presentation on iOS that disables the downward dismiss gesture,\n"
    " * which would otherwise discard an unpublished entry.\n"
    " */\n"
    "export default function ReflectScreen() {\n"
    "  const insets = useSafeAreaInsets();\n"
    "  const router = useRouter();\n"
    "  return (\n"
    "    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>\n"
    "      <Pressable onPress={() => router.back()} style={styles.close}>\n"
    "        <Text style={styles.closeText}>Close</Text>\n"
    "      </Pressable>\n"
    "      <View style={styles.center}>\n"
    "        <Text style={styles.title}>Reflect</Text>\n"
    "      </View>\n"
    "    </View>\n"
    "  );\n"
    "}\n\n"
    "const styles = StyleSheet.create({\n"
    "  root: { flex: 1, backgroundColor: '" + BG + "', paddingHorizontal: 20 },\n"
    "  close: { alignSelf: 'flex-start', padding: 8 },\n"
    "  closeText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },\n"
    "  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },\n"
    "  title: { color: 'rgba(255,255,255,0.35)', fontSize: 15, fontFamily: 'Inter_600SemiBold' },\n"
    "});\n"
)

WRITES['apps/mobile/app/(main)/focus.tsx'] = (
    "import { Pressable, StyleSheet, Text, View } from 'react-native';\n"
    "import { useSafeAreaInsets } from 'react-native-safe-area-context';\n"
    "import { useRouter } from 'expo-router';\n\n"
    "/**\n"
    " * Focus -- Phase A placeholder.\n"
    " *\n"
    " * New in v2.0. Home carries two entries, Focus and Reflect (PRD 12). Phase C:\n"
    " * scene picker, sequential audio playback with the next track prefetched on\n"
    " * play, and XP only on a full listen.\n"
    " */\n"
    "export default function FocusScreen() {\n"
    "  const insets = useSafeAreaInsets();\n"
    "  const router = useRouter();\n"
    "  return (\n"
    "    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>\n"
    "      <Pressable onPress={() => router.back()} style={styles.close}>\n"
    "        <Text style={styles.closeText}>Close</Text>\n"
    "      </Pressable>\n"
    "      <View style={styles.center}>\n"
    "        <Text style={styles.title}>Focus</Text>\n"
    "      </View>\n"
    "    </View>\n"
    "  );\n"
    "}\n\n"
    "const styles = StyleSheet.create({\n"
    "  root: { flex: 1, backgroundColor: '" + BG + "', paddingHorizontal: 20 },\n"
    "  close: { alignSelf: 'flex-start', padding: 8 },\n"
    "  closeText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },\n"
    "  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },\n"
    "  title: { color: 'rgba(255,255,255,0.35)', fontSize: 15, fontFamily: 'Inter_600SemiBold' },\n"
    "});\n"
)


# ---------------------------------------------------------------------------
# Whole-file rewrites. Every one of these was small enough that patching it
# around a dozen removed imports would be more fragile than replacing it.
# ---------------------------------------------------------------------------

WRITES['apps/mobile/app/index.tsx'] = (
    "import { useEffect, useState } from 'react';\n"
    "import { Redirect } from 'expo-router';\n\n"
    "import { AssetGateError } from '@/components/main/asset-gate-error';\n"
    "import { getSession } from '@/lib/auth';\n"
    "import { ensureP0Ready } from '@/lib/download-queue';\n\n"
    "/**\n"
    " * Entry gate. Blocks on P0 assets, then routes on session.\n"
    " *\n"
    " * Phase A dropped the onboarding branch. The eleven-step v1 flow is gone and\n"
    " * the six-step v2.0 flow does not exist yet, so there is nowhere to send a\n"
    " * user who has not finished it. Routing to a screen that is not there is\n"
    " * worse than not routing: a stub `isOnboardingDone()` returning false would\n"
    " * have been a lie the compiler happily accepts. Phase C restores the branch.\n"
    " *\n"
    " * ensureP0Ready() takes an optional filename -- v1 passed the home video so it\n"
    " * would be on disk before the first frame. That filename came from\n"
    " * character-state, and the v2.0 P0 set is companion videos anyway. Passing\n"
    " * nothing still downloads every bucket-root asset; only the extra hint is lost.\n"
    " */\n"
    "type Gate = 'loading' | 'ready' | 'failed';\n\n"
    "export default function Index() {\n"
    "  const [gate, setGate] = useState<Gate>('loading');\n"
    "  const [hasSession, setHasSession] = useState<boolean | null>(null);\n\n"
    "  useEffect(() => {\n"
    "    let cancelled = false;\n"
    "    void (async () => {\n"
    "      const session = await getSession();\n"
    "      if (cancelled) return;\n"
    "      setHasSession(Boolean(session));\n"
    "      try {\n"
    "        await ensureP0Ready();\n"
    "        if (!cancelled) setGate('ready');\n"
    "      } catch {\n"
    "        if (!cancelled) setGate('failed');\n"
    "      }\n"
    "    })();\n"
    "    return () => {\n"
    "      cancelled = true;\n"
    "    };\n"
    "  }, []);\n\n"
    "  if (gate === 'failed') return <AssetGateError onRetry={() => setGate('loading')} />;\n"
    "  if (gate === 'loading' || hasSession === null) return null;\n"
    "  return <Redirect href={hasSession ? '/(main)/(tabs)' : '/(auth)/sign-in'} />;\n"
    "}\n"
)


WRITES['apps/mobile/app/(main)/_layout.tsx'] = 'import { Stack } from \'expo-router\';\n\n/**\n * Authenticated app layout.\n *\n * useStudyClaimDetector() went with the willpower system (D5).\n *\n * reflect and focus inherit the fullScreenModal presentation that record had,\n * for the reason record had it: it is the only iOS presentation that actually\n * disables the downward dismiss gesture. `gestureEnabled: false` on a plain\n * \'modal\' yields a rubber-band bounce (react-native-screens #1410), and\n * expo-router ignores `presentation` on a screen inside a nested layout\n * (#37680) -- which is why these two files sit directly under (main)/ rather\n * than in (modals)/. Losing an unpublished reflection to a stray swipe is not\n * a recoverable error.\n */\nexport default function MainLayout() {\n  return (\n    <Stack\n      screenOptions={{\n        headerShown: false,\n        contentStyle: { backgroundColor: \'#0F0B2E\' },\n      }}\n    >\n      <Stack.Screen name="(tabs)" />\n      <Stack.Screen name="(modals)" options={{ presentation: \'modal\' }} />\n      <Stack.Screen\n        name="ai-consent"\n        options={{ presentation: \'transparentModal\', animation: \'fade\' }}\n      />\n      <Stack.Screen name="reflect" options={{ presentation: \'fullScreenModal\' }} />\n      <Stack.Screen name="focus" options={{ presentation: \'fullScreenModal\' }} />\n    </Stack>\n  );\n}\n'

WRITES['apps/mobile/app/(main)/(tabs)/_layout.tsx'] = 'import { useEffect, useRef } from \'react\';\n\nimport { Tabs } from \'expo-router\';\nimport { BottomSheetModalProvider } from \'@gorhom/bottom-sheet\';\n\nimport { BottomTabBar } from \'@/components/main/bottom-tab-bar\';\nimport {\n  RatingPromptSheet,\n  type RatingPromptSheetRef,\n} from \'@/components/rating/rating-prompt-sheet\';\nimport { subscribeRatingPromptRequest } from \'@/lib/rating-prompt\';\n\n/**\n * Five tabs: Home / Bags / Skills / Friends / Status.\n *\n * SkinUnlockModal and StudyClaimModal are no longer mounted. The first read\n * its unlocked set from character-state and statically require()\'d six char-1\n * images; the second belongs to the willpower system. Both re-enter in Phase C\n * -- skins against companions, and nothing against study.\n *\n * The rating sheet stays: it carries no domain concept, it listens on a\n * module-level channel and presents. modal-coordinator likewise survives,\n * arbitrating only announcement-gate until Phase C gives it slots to order.\n */\nexport default function TabsLayout() {\n  const ratingSheetRef = useRef<RatingPromptSheetRef>(null);\n  useEffect(() => {\n    return subscribeRatingPromptRequest(() => {\n      ratingSheetRef.current?.present();\n    });\n  }, []);\n\n  return (\n    <BottomSheetModalProvider>\n      <Tabs\n        tabBar={(props) => <BottomTabBar {...props} />}\n        screenOptions={{ headerShown: false }}\n      >\n        <Tabs.Screen name="index" options={{ title: \'Home\' }} />\n        <Tabs.Screen name="bags" options={{ title: \'Bags\' }} />\n        <Tabs.Screen name="skills" options={{ title: \'Skills\' }} />\n        <Tabs.Screen name="friends" options={{ title: \'Friends\' }} />\n        <Tabs.Screen name="status" options={{ title: \'Status\' }} />\n      </Tabs>\n      <RatingPromptSheet ref={ratingSheetRef} />\n    </BottomSheetModalProvider>\n  );\n}\n'

WRITES['apps/mobile/src/components/main/bottom-tab-bar.tsx'] = "import { ReactNode } from 'react';\nimport { Pressable, StyleSheet, Text, View } from 'react-native';\nimport { useSafeAreaInsets } from 'react-native-safe-area-context';\nimport type { BottomTabBarProps } from '@react-navigation/bottom-tabs';\nimport { CommonActions } from '@react-navigation/native';\nimport { MaterialIcons } from '@expo/vector-icons';\n\nimport { haptics } from '@/lib/haptics';\n\n/**\n * Bottom tab bar for (main)/(tabs).\n *\n * v1 drew four tabs around a raised mic button, held centred by a '__mic__'\n * sentinel in the order array so that space-around split the row two and two.\n * Five real tabs leave no centre slot, so the sentinel, the mic styles, and\n * the AI-consent gate all go. Reflect is entered from Home now, next to Focus.\n *\n * Icons are placeholders; Phase C swaps in the illustrated set.\n */\n\ntype IconName = keyof typeof MaterialIcons.glyphMap;\n\nconst TABS: ReadonlyArray<{ name: string; icon: IconName; label: string }> = [\n  { name: 'index', icon: 'home', label: 'Home' },\n  { name: 'bags', icon: 'work', label: 'Bags' },\n  { name: 'skills', icon: 'auto-awesome', label: 'Skills' },\n  { name: 'friends', icon: 'people', label: 'Friends' },\n  { name: 'status', icon: 'show-chart', label: 'Status' },\n];\n\nexport function BottomTabBar({ state, navigation }: BottomTabBarProps) {\n  const insets = useSafeAreaInsets();\n\n  const routesByName = new Map<string, (typeof state.routes)[number]>();\n  state.routes.forEach((r) => routesByName.set(r.name, r));\n\n  const handleTabPress = (routeName: string, isFocused: boolean) => {\n    void haptics.light();\n    const route = routesByName.get(routeName);\n    if (!route) return;\n    const event = navigation.emit({\n      type: 'tabPress',\n      target: route.key,\n      canPreventDefault: true,\n    });\n    if (!isFocused && !event.defaultPrevented) {\n      navigation.dispatch({\n        ...CommonActions.navigate(route.name, route.params),\n        target: state.key,\n      });\n    }\n  };\n\n  return (\n    <View style={[styles.container, { paddingBottom: insets.bottom }]}>\n      <View style={styles.row}>\n        {TABS.map((tab) => {\n          const route = routesByName.get(tab.name);\n          if (!route) return null;\n          const isFocused =\n            state.index === state.routes.findIndex((r) => r.name === tab.name);\n          return (\n            <TabButton\n              key={route.key}\n              icon={tab.icon}\n              label={tab.label}\n              isFocused={isFocused}\n              onPress={() => handleTabPress(tab.name, isFocused)}\n            />\n          );\n        })}\n      </View>\n    </View>\n  );\n}\n\ntype TabButtonProps = {\n  icon: IconName;\n  label: string;\n  isFocused: boolean;\n  onPress: () => void;\n};\n\nfunction TabButton({ icon, label, isFocused, onPress }: TabButtonProps): ReactNode {\n  const color = isFocused ? '#C084FC' : 'rgba(255,255,255,0.3)';\n  return (\n    <Pressable onPress={onPress} style={styles.tabBtn}>\n      <MaterialIcons name={icon} size={22} color={color} />\n      <Text style={[styles.tabLabel, { color }]}>{label}</Text>\n    </Pressable>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { backgroundColor: '#0A0A0F' },\n  row: {\n    flexDirection: 'row',\n    alignItems: 'flex-end',\n    justifyContent: 'space-around',\n    height: 56,\n  },\n  tabBtn: { width: 64, height: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },\n  tabLabel: { fontSize: 9, lineHeight: 11, fontFamily: 'Inter_600SemiBold' },\n});\n"

WRITES['apps/mobile/src/components/main/background-resume-overlay.tsx'] = 'import { useEffect, useRef } from \'react\';\nimport { Image, Modal, StyleSheet, View } from \'react-native\';\n\nimport { getCurrentSession } from \'@/lib/auth\';\nimport { refreshAllCaches } from \'@/lib/cache-refresh-all\';\nimport { hideResumeOverlay } from \'@/lib/background-resume-store\';\n\n/**\n * Full-screen overlay shown when the app returns from a long background.\n *\n * Two thirds of this file used to be study-claim pre-settlement: an ownership\n * flag handed to the in-session detector so its 30s poll could not fire a\n * second POST and double-settle into a flashed "+0 XP". The willpower system\n * is gone (D5) and so is all of it. What remains is what the overlay was\n * always for: hold the launch screen while the caches warm.\n *\n * The 8s cap stays. It does not stop the work -- refreshAllCaches keeps going\n * -- it caps how long a bad network may strand the user behind a purple\n * rectangle.\n */\nconst SPLASH = require(\'../../../assets/splash.png\');\nconst RESUME_TIMEOUT_MS = 8000;\n\nexport function BackgroundResumeOverlay() {\n  const hiddenRef = useRef(false);\n\n  useEffect(() => {\n    const hideOverlay = () => {\n      if (hiddenRef.current) return;\n      hiddenRef.current = true;\n      hideResumeOverlay();\n    };\n\n    const timer = setTimeout(hideOverlay, RESUME_TIMEOUT_MS);\n\n    void (async () => {\n      try {\n        const session = await getCurrentSession();\n        const userId = session?.user?.id;\n        if (userId) await refreshAllCaches(userId);\n      } catch (e) {\n        console.warn(\'[resume-overlay] refresh failed (non-fatal):\', e);\n      } finally {\n        clearTimeout(timer);\n        hideOverlay();\n      }\n    })();\n\n    return () => {\n      clearTimeout(timer);\n    };\n  }, []);\n\n  return (\n    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>\n      <View style={styles.root}>\n        <Image source={SPLASH} style={styles.splashImage} resizeMode="contain" />\n      </View>\n    </Modal>\n  );\n}\n\nconst styles = StyleSheet.create({\n  // Mirrors the native splash exactly -- same #7C3AED, same full-bleed image --\n  // so the iOS launch-screen flash on resume reads as one continuous screen.\n  root: { flex: 1, backgroundColor: \'#7C3AED\' },\n  splashImage: { width: \'100%\', height: \'100%\' },\n});\n'

WRITES['apps/mobile/src/lib/cache-refresh-all.ts'] = "import { storage } from './storage';\nimport { refreshMeStats } from './me-stats';\nimport { refreshLeaderboard } from './leaderboard-api';\n\n/**\n * Foreground refresh after a long background.\n *\n * v1 fanned out to eight caches. Six of them -- wisdoms, user-stats,\n * daily-tasks, character-state, wisdom-center, seek-questions -- described a\n * product that no longer exists. Two remain, and Phase B replaces this module\n * wholesale: createResource() declares its own invalidation triggers, so\n * nobody has to remember to add a line here when a cache is born.\n *\n * The 30-minute threshold is the concurrency lock. Two foreground transitions\n * inside that window cannot both pass shouldRefreshAll(), so there is nothing\n * left for a mutex to guard.\n *\n * The timestamp is stamped even when a refresh fails, or a user on a bad train\n * connection re-fires the whole batch on every background/foreground flicker.\n */\nconst LAST_REFRESH_KEY = 'novame_last_global_refresh_ms';\nconst STALE_THRESHOLD_MS = 30 * 60 * 1000;\n\n/** Synchronous -- MMKV reads are sync, so this is safe inside an AppState handler. */\nexport function shouldRefreshAll(): boolean {\n  const raw = storage.getString(LAST_REFRESH_KEY);\n  const last = raw ? Number(raw) : 0;\n  if (!Number.isFinite(last) || last <= 0) return true;\n  return Date.now() - last > STALE_THRESHOLD_MS;\n}\n\n/** Also called at the end of cold-start prewarm, so the first foreground tick skips. */\nexport function markRefreshedNow(): void {\n  storage.set(LAST_REFRESH_KEY, String(Date.now()));\n}\n\n/** Fire-and-forget safe: never throws. */\nexport async function refreshAllCaches(userId: string): Promise<void> {\n  await Promise.allSettled([refreshMeStats(userId), refreshLeaderboard()]);\n  markRefreshedNow();\n}\n"

WRITES['apps/mobile/app/(auth)/signing-in.tsx'] = 'import { useEffect, useState } from \'react\';\nimport { ActivityIndicator, Image, StyleSheet, View } from \'react-native\';\nimport { router } from \'expo-router\';\n\nimport { getCurrentSession } from \'@/lib/auth\';\nimport {\n  fetchSubscriptionTier,\n  getCachedSubscription,\n  setCachedSubscription,\n} from \'@/lib/subscription\';\nimport { fetchMeStats } from \'@/lib/me-stats\';\nimport { ensureP0Ready } from \'@/lib/download-queue\';\nimport { AssetGateError } from \'@/components/main/asset-gate-error\';\n\n/**\n * P0 asset gate on the login path.\n *\n * Signing in is an in-app navigation that never re-runs app/index.tsx, so\n * without a gate here the user lands on Home before its assets are local.\n *\n * What changed\n * ------------\n * v1 awaited fetchCharacterState() first, purely so it could compute WHICH\n * video to gate: the clip depends on the user\'s willpower and mode, and the\n * SIGNED_IN handler had just cleared that cache. character-state is gone, and\n * so is the argument -- ensureP0Ready() still downloads every bucket-root\n * asset, it just no longer receives a hint about one extra file.\n *\n * This is harmless today (Phase A\'s Home is a placeholder with no video) and\n * NOT harmless in Phase C. When the companion returns, the first-frame video\n * depends on its sleep/fly state, and this gate has to be rebuilt around it.\n *\n * Also gone: the tab warm. It prefetched Growth, Discover and Assets, three\n * tabs that no longer exist.\n *\n * The gateFailed latch stays, and it is subtle enough to be worth stating: a\n * P0 download that completes AFTER the retry screen has appeared must not\n * silently navigate the user into Home. Only an explicit Retry, which re-runs\n * this effect, may do that.\n */\n\nconst LOGO = require(\'../../assets/images/logo.png\');\n\nconst MIN_DISPLAY_MS = 600;\n\n/**\n * How long we WAIT before offering Retry -- not a hard stop. The download queue\n * never stops retrying in the background, and P0 is well under 1MB.\n */\nconst P0_ASSET_TIMEOUT_MS = 30000;\n\nexport default function SigningInScreen() {\n  const [gateState, setGateState] = useState<\'pending\' | \'failed\'>(\'pending\');\n  const [retryNonce, setRetryNonce] = useState(0);\n\n  useEffect(() => {\n    const start = Date.now();\n    let cancelled = false;\n    let navigated = false;\n    let gateFailed = false;\n\n    const goHome = () => {\n      if (navigated || cancelled || gateFailed) return;\n      navigated = true;\n      const elapsed = Date.now() - start;\n      setTimeout(() => {\n        if (!cancelled) router.replace(\'/(main)/(tabs)\');\n      }, Math.max(0, MIN_DISPLAY_MS - elapsed));\n    };\n\n    const timer = setTimeout(() => {\n      if (!cancelled && !navigated) {\n        gateFailed = true;\n        setGateState(\'failed\');\n      }\n    }, P0_ASSET_TIMEOUT_MS);\n\n    void (async () => {\n      const session = await getCurrentSession();\n      const userId = session?.user?.id;\n      if (!userId) {\n        navigated = true;\n        clearTimeout(timer);\n        router.replace(\'/(auth)/sign-in\');\n        return;\n      }\n\n      if (!getCachedSubscription()) {\n        setCachedSubscription({ tier: \'free\', lastFetchedAtMs: Date.now() });\n      }\n\n      void fetchSubscriptionTier(userId).catch((e) => {\n        console.warn(\'[signing-in] subscription fetch failed:\', (e as Error)?.message || e);\n      });\n      void fetchMeStats(userId).catch((e) => {\n        console.warn(\'[signing-in] me-stats fetch failed:\', (e as Error)?.message || e);\n      });\n\n      await ensureP0Ready();\n      if (cancelled) return;\n\n      clearTimeout(timer);\n      goHome();\n    })();\n\n    return () => {\n      cancelled = true;\n      clearTimeout(timer);\n    };\n  }, [retryNonce]);\n\n  if (gateState === \'failed\') {\n    return <AssetGateError onRetry={() => setRetryNonce((n) => n + 1)} />;\n  }\n\n  return (\n    <View style={styles.root}>\n      <Image source={LOGO} style={styles.logo} resizeMode="contain" />\n      <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" style={styles.spinner} />\n    </View>\n  );\n}\n\nconst styles = StyleSheet.create({\n  root: { flex: 1, backgroundColor: \'#7C3AED\', alignItems: \'center\', justifyContent: \'center\' },\n  logo: { width: 96, height: 96, marginBottom: 24 },\n  spinner: { marginTop: 4 },\n});\n'

WRITES['apps/mobile/app/(main)/(tabs)/index.tsx'] = "import { useCallback } from 'react';\nimport { Pressable, StyleSheet, Text, View } from 'react-native';\nimport { SafeAreaView } from 'react-native-safe-area-context';\nimport { useRouter } from 'expo-router';\n\nimport { requireAiConsent } from '@/lib/ai-consent';\nimport { haptics } from '@/lib/haptics';\nimport { hideSplashOnce } from '@/lib/splash';\n\n/**\n * Home -- Phase A placeholder.\n *\n * v1 was 697 lines: a companion video, a willpower bar, a speech bubble on a\n * 60s tick, three MMKV polls at 2s each, and four round header buttons. All of\n * it read from character-state or wisdom-center. Phase C rebuilds it around\n * the companion's sleep/fly state and the day/night scene.\n *\n * The two entries survive because they are the product (PRD 12): Focus and\n * Reflect both start here. The AI-consent gate stays on Reflect: it pushes the\n * consent modal and returns false, and the modal replaces to `next` on Agree,\n * so pushing again here would double-navigate.\n *\n * hideSplashOnce() must be called by whatever screen renders first, or the\n * native splash never lifts.\n */\nexport default function HomeScreen() {\n  const router = useRouter();\n\n  const onLayout = useCallback(() => {\n    hideSplashOnce();\n  }, []);\n\n  const onReflect = () => {\n    void haptics.medium();\n    if (!requireAiConsent('/(main)/reflect')) return;\n    router.push('/(main)/reflect');\n  };\n\n  const onFocus = () => {\n    void haptics.medium();\n    router.push('/(main)/focus');\n  };\n\n  return (\n    <SafeAreaView style={styles.root} edges={['top']} onLayout={onLayout}>\n      <View style={styles.center}>\n        <Text style={styles.title}>Home</Text>\n        <View style={styles.actions}>\n          <Pressable onPress={onFocus} style={styles.btn}>\n            <Text style={styles.btnText}>Focus</Text>\n          </Pressable>\n          <Pressable onPress={onReflect} style={styles.btn}>\n            <Text style={styles.btnText}>Reflect</Text>\n          </Pressable>\n        </View>\n      </View>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  root: { flex: 1, backgroundColor: '#0F0B2E' },\n  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 },\n  title: { color: 'rgba(255,255,255,0.35)', fontSize: 15, fontFamily: 'Inter_600SemiBold' },\n  actions: { flexDirection: 'row', gap: 16 },\n  btn: {\n    paddingHorizontal: 28,\n    paddingVertical: 14,\n    borderRadius: 24,\n    backgroundColor: '#A855F7',\n  },\n  btnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },\n});\n"

# --------------------------------------------------------------------------
# Surgical edits. DELETE_LINE matches a substring and drops the whole line, so
# indentation is never part of an anchor -- indentation is exactly what you
# cannot read reliably out of a terminal.
# --------------------------------------------------------------------------
ACTIONS = {'apps/mobile/app/(main)/(modals)/account-management.tsx': [('DELETE_LINE',
                                                             'import { '
                                                             'clearCachedCharacterState } '
                                                             "from '@/lib/character-state';"),
                                                            ('DELETE_LINE',
                                                             'clearCachedCharacterState();')],
 'apps/mobile/app/(main)/(modals)/notification-settings.tsx': [('DELETE_LINE',
                                                                'import { '
                                                                'getCachedCharacterState } '
                                                                'from '
                                                                "'@/lib/character-state';"),
                                                               ('REPLACE',
                                                                'getCachedCharacterState()?.charName?.trim() '
                                                                "|| 'your companion'",
                                                                "'your companion'",
                                                                1)],
 'apps/mobile/app/(main)/(modals)/order-detail.tsx': [('REPLACE',
                                                       'else '
                                                       "router.replace('/(main)/(tabs)/assets');",
                                                       'else '
                                                       "router.replace('/(main)/(tabs)/bags');",
                                                       1),
                                                      ('REPLACE',
                                                       '  const onContinueSelection = () => '
                                                       '{\n    void haptics.light();\n    '
                                                       '// Stage 5.AIR.2: route to the '
                                                       'cards-select modal carrying '
                                                       'the\n    // current orderId. '
                                                       'cards-select handles the deck '
                                                       'composition\n    // and PATCHes the '
                                                       "order to status='paid' on "
                                                       'submit.\n    router.push({\n      '
                                                       'pathname: '
                                                       "'/(main)/(modals)/cards-select',\n      "
                                                       "params: { orderId: order?.id ?? '' "
                                                       '},\n    });\n  };',
                                                       '  const onContinueSelection = () => '
                                                       '{\n    void haptics.light();\n    '
                                                       '// Phase A: cards-select composed a '
                                                       'deck of 48 keyword cards, and both '
                                                       'the\n    // cards and the modal are '
                                                       'gone. v2.0 prints an object codex '
                                                       'and a skill\n    // deck instead; '
                                                       'their composer lands in Phase C. The '
                                                       'button stays so the\n    // order '
                                                       "flow's shape stays legible, but it "
                                                       'navigates nowhere yet.\n  };',
                                                       1)],
 'apps/mobile/app/(main)/(modals)/order-history.tsx': [('REPLACE',
                                                        'else '
                                                        "router.replace('/(main)/(tabs)/assets');",
                                                        'else '
                                                        "router.replace('/(main)/(tabs)/bags');",
                                                        2)],
 'apps/mobile/app/(main)/(modals)/payment-stub.tsx': [('REPLACE',
                                                       'else '
                                                       "router.replace('/(main)/(tabs)/assets');",
                                                       'else '
                                                       "router.replace('/(main)/(tabs)/bags');",
                                                       1)],
 'apps/mobile/app/(main)/(modals)/shipping-form.tsx': [('REPLACE',
                                                        'else '
                                                        "router.replace('/(main)/(tabs)/assets');",
                                                        'else '
                                                        "router.replace('/(main)/(tabs)/bags');",
                                                        1)],
 'apps/mobile/app/_layout.tsx': [('DELETE_LINE',
                                  'import { syncOnboardingIfPending } from '
                                  "'@/lib/onboarding';"),
                                 ('DELETE_LINE',
                                  'import { fetchCharacterState } from '
                                  "'@/lib/character-state';"),
                                 ('DELETE_LINE', 'fetchCharacterState(userId),'),
                                 ('DELETE_LINE',
                                  'void syncOnboardingIfPending(session.user.id);')],
 'apps/mobile/src/components/main/video-character.tsx': [('REPLACE',
                                                          'import type { CharacterState } '
                                                          "from '@/lib/constants';",
                                                          '/**\n * Phase A: @/lib/constants '
                                                          'died with the willpower system '
                                                          '(D5). The three v1\n * states '
                                                          'are inlined so this component '
                                                          'still compiles. Phase C replaces '
                                                          "them\n * with the companion's "
                                                          "'sleep' | 'fly'.\n */\ntype "
                                                          "CharacterState = 'hungry' | "
                                                          "'study' | 'chill';",
                                                          1)],
 'apps/mobile/src/lib/notification-settings.ts': [('DELETE_LINE',
                                                   'import { getCachedCharacterState } from '
                                                   "'./character-state';"),
                                                  ('REPLACE',
                                                   'getCachedCharacterState()?.charName?.trim() '
                                                   "|| 'your companion'",
                                                   "'your companion'",
                                                   1)]}


def main():
    apply = '--apply' in sys.argv
    deletes = read_deletes()
    errs = []

    for path in deletes:
        if not Path(path).exists():
            errs.append('DELETE target missing: ' + path)
    for path in WRITES:
        parent = Path(path).parent
        if not parent.exists():
            errs.append('WRITE parent missing: ' + str(parent))

    for path, ops in ACTIONS.items():
        for op in ops:
            for field in op[1:]:
                if isinstance(field, str) and '\\' in field:
                    errs.append(
                        '%s: backslash in an anchor or replacement -> %r' % (path, field[:60]))
                    errs.append(
                        '        A lost escape level. pformat renders a real newline as two '
                        'source characters;\n        doubling it produces the literal sequence '
                        'instead. The pre-check only matches `old`,\n        so a mangled `new` '
                        'writes garbage into a real file and nothing notices until tsc.')

    for path, ops in ACTIONS.items():
        f = Path(path)
        if not f.exists():
            errs.append('ACTIONS target missing: ' + path)
            continue
        src = f.read_text(encoding='utf-8')
        for op in ops:
            if op[0] == DELETE_LINE:
                n = sum(1 for line in src.splitlines() if op[1] in line)
                if n != 1:
                    errs.append('%s: DELETE_LINE hit %d times -> %r' % (path, n, op[1][:60]))
            elif op[0] == REPLACE:
                want = op[3] if len(op) > 3 else 1
                n = src.count(op[1])
                if n != want:
                    errs.append('%s: REPLACE hit %d times, want %d -> %r'
                                % (path, n, want, op[1][:60]))

    if errs:
        print('PRE-CHECK FAILED. Nothing written.\n')
        for e in errs:
            print('  ' + e)
        return 1

    print('pre-check OK')
    print('  DELETE   %3d files' % len(deletes))
    print('  WRITE    %3d files' % len(WRITES))
    print('  ACTIONS  %3d files, %d edits' % (len(ACTIONS), sum(len(v) for v in ACTIONS.values())))

    if not apply:
        print('\ndry run. nothing written.')
        return 0

    subprocess.run(['git', 'rm', '-q'] + deletes, check=True)
    print('\ngit rm  %d files' % len(deletes))

    for path, content in WRITES.items():
        Path(path).write_text(content, encoding='utf-8')
    print('write   %d files' % len(WRITES))

    for path, ops in ACTIONS.items():
        f = Path(path)
        src = f.read_text(encoding='utf-8')
        for op in ops:
            if op[0] == DELETE_LINE:
                src = '\n'.join(l for l in src.split('\n') if op[1] not in l)
            else:
                src = src.replace(op[1], op[2])
        f.write_text(src, encoding='utf-8')
    print('patch   %d files' % len(ACTIONS))

    subprocess.run(['git', 'add', '-A', 'apps/mobile'], check=True)
    print('\nNext, in order:')
    print('  1. cd apps/mobile && npx expo start --clear   (regenerates .expo/types/router.d.ts)')
    print('  2. Ctrl-C once Metro reports the bundle')
    print('  3. pnpm --filter @novame/mobile type-check')
    print()
    print('Step 1 is not optional. typedRoutes is on, and tsc reads the router.d.ts')
    print('on disk. The current one predates /(main)/reflect, /(main)/focus, and the')
    print('four new tabs, so tsc would reject every push to them. It would also')
    print('happily accept a push to /(main)/(tabs)/discover, which no longer exists:')
    print('tsc is blind in the deletion direction. That is what plan-delete.py is for.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
