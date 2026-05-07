import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { PRICING_TIERS, type PricingTierKey } from '@novame/core';

import { haptics } from '@/lib/haptics';
import { getCachedSubscription } from '@/lib/subscription';

/**
 * Plan & Billing bottom sheet -- Stage 3.10.4.
 *
 * Rendered inline on the Me page rather than as a router modal route.
 * The Me page holds a ref to this component and calls present() when
 * the user taps "Plan and Billing" in the menu (or the View button on
 * the Plan card).
 *
 * Why @gorhom/bottom-sheet (not native-stack formSheet):
 *   - The native UISheetPresentationController dimming behavior on
 *     iOS 18 did not render even after a clean rebuild (likely related
 *     to nested modal-stack presentation in this app's layout). gorhom
 *     gives explicit control over the backdrop, snap points, grabber,
 *     and corner radius -- and works the same on iOS / Android.
 *
 * Behavior (matches the original design spec):
 *   - Two snap points: 55% and 95% of screen height.
 *   - Dimmed backdrop (60% black) over the Me page; tap-outside
 *     dismisses.
 *   - Visible grabber on top + 28px corner radius.
 *   - Upgrade Plan dismisses the sheet, then pushes /subscription-
 *     paywall as a fresh modal (closing the paywall returns straight
 *     to the Me page rather than re-presenting this sheet).
 *   - Billing History is a stub Alert; real history lands with Stage
 *     5 IAP integration (B58).
 */

export type PlanBillingSheetRef = {
  present: () => void;
  dismiss: () => void;
};

export const PlanBillingSheet = forwardRef<PlanBillingSheetRef>((_, ref) => {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [tier, setTier] = useState<PricingTierKey>('free');

  // Refresh tier from MMKV cache every time the sheet is presented so
  // the user sees their current plan even after upgrading in another
  // session. Stage 5 IAP will additionally invalidate the cache on
  // successful purchase, so no extra wiring needed here.
  const refreshTier = useCallback(() => {
    const cached = getCachedSubscription();
    setTier(cached?.tier ?? 'free');
  }, []);

  useEffect(() => {
    refreshTier();
  }, [refreshTier]);

  useImperativeHandle(ref, () => ({
    present: () => {
      refreshTier();
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const snapPoints = useMemo(() => ['55%', '95%'], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
      />
    ),
    [],
  );

  const tierInfo = PRICING_TIERS[tier];
  const isFree = tier === 'free';

  const handleClose = () => {
    void haptics.light();
    sheetRef.current?.dismiss();
  };

  const handleUpgrade = () => {
    void haptics.medium();
    sheetRef.current?.dismiss();
    // Wait for the sheet's dismiss animation (~250ms) before pushing
    // the paywall so navigation doesn't race with the animation.
    setTimeout(() => {
      router.push('/(main)/(modals)/subscription-paywall');
    }, 280);
  };

  const handleHistory = () => {
    void haptics.light();
    Alert.alert(
      'No Billing History',
      'Your billing history will appear here once you subscribe.',
    );
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.grabber}
      enableDynamicSizing={false}
    >
      <BottomSheetView
        style={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Plan & Billing</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </View>

        {/* Current Plan card */}
        <View style={styles.planCard}>
          <View style={styles.planCardHeader}>
            <View>
              <Text style={styles.currentPlanLabel}>CURRENT PLAN</Text>
              <Text style={styles.tierName}>{tierInfo.name}</Text>
            </View>
            <MaterialIcons
              name="workspace-premium"
              size={32}
              color="rgba(192,132,252,0.5)"
            />
          </View>
          <View style={styles.planCardStats}>
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>Monthly Insights</Text>
              <Text style={styles.statValue}>{tierInfo.monthlyAnalyses}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>Status</Text>
              <Text style={styles.statValue}>Active</Text>
            </View>
          </View>
        </View>

        {/* Upgrade Plan */}
        <Pressable
          onPress={handleUpgrade}
          style={({ pressed }) => [
            styles.primaryBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons name="upgrade" size={20} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>
            {isFree ? 'Upgrade Plan' : 'Change Plan'}
          </Text>
        </Pressable>

        {/* Billing History */}
        <Pressable
          onPress={handleHistory}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons
            name="receipt-long"
            size={20}
            color="rgba(255,255,255,0.6)"
          />
          <Text style={styles.secondaryBtnText}>Billing History</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

PlanBillingSheet.displayName = 'PlanBillingSheet';

// ---- styles ----

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: '#0F0B2E',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  grabber: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    width: 40,
    height: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCard: {
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.3)',
    padding: 20,
    marginBottom: 20,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  currentPlanLabel: {
    color: 'rgba(192,132,252,0.7)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  tierName: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
  },
  planCardStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: '#A855F7',
    borderRadius: 16,
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
  },
  secondaryBtnText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '700',
  },
});
