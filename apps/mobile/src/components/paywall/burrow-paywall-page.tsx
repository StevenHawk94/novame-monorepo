import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Image, type ImageProps } from 'expo-image';
import type { ComponentType } from 'react';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StoreSubscriptionPricing } from '@/lib/iap';
import { trialDurationText, perUserMonthlyPrice } from '@/lib/paywall-presentation';
import { BackIcon } from '../burrow/burrow-back-button';

export const PAYWALL_BENEFITS = [
  { title: 'Free Plus for your partner', description: 'One subscription unlocks Plus for both of you!', icon: require('../../../assets/burrow-webp/paywall/01_Heart.webp') },
  { title: 'Daily coin rewards', description: 'Earn 50 coins every day you log in', icon: require('../../../assets/burrow-webp/paywall/02_Heart_Coin.webp') },
  { title: 'Share more love', description: 'Send 6x more affection every day.', icon: require('../../../assets/burrow-webp/paywall/03_Kiss.webp') },
  { title: 'Tame more monsters', description: 'Get extra release of negative energy every day', icon: require('../../../assets/burrow-webp/paywall/04_Monster.webp') },
  { title: 'Shorter adventures', description: 'Get back from the burrow faster', icon: require('../../../assets/burrow-webp/paywall/05_Shovel.webp') },
  { title: 'Exclusive items, games and surprises', description: 'Enjoy more ways to get cozy and grow closer', icon: require('../../../assets/burrow-webp/paywall/06_Gift.webp') },
  { title: 'Forever photo storage', description: 'Keep every photo safely stored', icon: require('../../../assets/burrow-webp/paywall/07_Photo.webp') },
  { title: 'More background music', description: 'Unlock extra tunes to set the mood at home', icon: require('../../../assets/burrow-webp/paywall/08_Music.webp') },
  { title: 'Shape your home', description: 'Join the queue and help us bring your favorite furniture into the app', icon: require('../../../assets/burrow-webp/paywall/09_Sofa.webp') },
] as const;
const WORDMARK = require('../../../assets/burrow-webp/onboarding-pages/ob1-1.webp');
const BUNNY = require('../../../assets/burrow-webp/onboarding-pages/ob1.webp');
/** The 800×400 wordmark's visible rows are [101, 300). Clip transparent
 * padding, not the artwork, so its scale stays unchanged while freeing space. */
export function paywallBenefitsHeader(width: number, height: number) {
  const artHeight = width * .245;
  return { width: width * .59, artHeight, cropTop: artHeight * 101 / 400,
    visibleHeight: artHeight * 199 / 400, marginTop: Math.min(height * .017, 20),
    // Previously the visible gap included 100 transparent rows plus 8pt.
    plusGap: (artHeight * 100 / 400 + 8) * .7 };
}
export const PAYWALL_BACKGROUND = '#FFF5E9';
const ink = '#492B16';
export type PaywallPageProps = {
  phase: 'benefits' | 'plans'; pricing: StoreSubscriptionPricing | null; priceError?: boolean;
  plan: 'yearly' | 'monthly'; onSelectPlan: (plan: 'yearly' | 'monthly') => void;
  onClose: () => void; onBack: () => void; onContinue: () => void; onPurchase: () => void;
  onRestore: () => void; onRetry: () => void;
  openingPlans?: boolean; purchasing?: boolean; restoring?: boolean; closing?: boolean; isPaid?: boolean;
  imageComponent?: ComponentType<ImageProps>;
};
function Button({ label, onPress, disabled, busy, color = ink, planStyle=false }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; color?: string; planStyle?:boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
    disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [s.cta, planStyle&&s.planCta, { backgroundColor: color }, (disabled || busy) && { opacity: .6 }, pressed && { opacity: .8 }]}>
    {busy ? <ActivityIndicator color="#FFFFFF"/> : <Text maxFontSizeMultiplier={1.35} style={s.ctaText}>{label}</Text>}
  </Pressable>;
}
/** The sole presentation for onboarding, standard and promotional routes.
 * Callers retain ownership of transactions and their own completion routing. */
export function BurrowPaywallPage(p: PaywallPageProps) {
  const { width, height } = useWindowDimensions(), insets = useSafeAreaInsets();
  const Art = p.imageComponent ?? Image;
  const plans = p.phase === 'plans', scale = Math.min(width / 900, .6);
  const benefitIconSize = Math.max(44, 110 * scale) * .85;
  const benefitHeader = paywallBenefitsHeader(width, height);
  const compact = height - insets.top - insets.bottom < 720;
  const disabled = !!(p.purchasing || p.restoring || p.closing || p.openingPlans);
  const duration = !p.isPaid && p.pricing?.yearlyTrialEligible ? trialDurationText(p.pricing.yearlyTrialDuration) : null;
  const trial = duration ? trialDurationText(p.pricing?.yearlyTrialDuration, true) + ' Free Trial' : null;
  const yearlyTrial = p.plan === 'yearly' && !!trial;
  const titleSize = Math.min(32, Math.max(25, width * .073));
  const yearlyBestDeal = !!p.pricing && p.pricing.yearly.currency === p.pricing.monthly.currency
    && p.pricing.yearly.price < p.pricing.monthly.price * 12;
  const footerPadding = Math.max(12, insets.bottom);
  const store = Platform.OS === 'android' ? 'Google Play' : 'App Store';
  const terms = p.pricing ? (p.plan === 'yearly'
    ? `${duration ? `Free for ${duration}, then ` : 'Burrow Plus Yearly: '}${p.pricing.yearly.displayPrice} per 12 months. `
    : `Burrow Plus Monthly: ${p.pricing.monthly.displayPrice} per month. `)
    + `Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in your ${store} settings.` : '';
  const legal = (label: 'Privacy' | 'Terms') => void Linking.openURL(`https://www.burrow-app.com/${label.toLowerCase()}`);
  return <View style={s.root}>
    <View style={{ height: insets.top + 54 }} />
    <Pressable accessibilityRole="button" accessibilityLabel={plans ? 'Back to Plus offer' : 'Close Plus offer'} disabled={disabled}
      hitSlop={10} onPress={plans ? p.onBack : p.onClose}
      style={[s.nav, plans&&s.planNav, { top: insets.top + 8, ...(plans ? { left: 20 } : { right: 20 }) }, disabled && { opacity: .6 }]}>
      {p.closing ? <ActivityIndicator color="#FFF8EE"/> : plans ? <BackIcon color="#FFF8EE"/> : <Feather name="x" size={29} color="#FFF8EE"/>}
    </Pressable>
    {plans ? <>
      <ScrollView style={s.scroll} removeClippedSubviews={false} bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.plans, { paddingTop: compact ? 6 : Math.max(0, height * .12 - insets.top - 54), paddingHorizontal: 20 }]}>
        <Art accessibilityLabel="Burrow bunny" source={BUNNY} contentFit="contain" style={{ width: compact ? 66 : Math.min(112, width * .27), height: compact ? 76 : Math.min(132, height * .145), alignSelf: 'center' }}/>
        <Text maxFontSizeMultiplier={1.35} style={[s.title, { fontSize: titleSize, marginTop: compact ? 10 : 12 }]}>Choose your plan</Text>
        <Text maxFontSizeMultiplier={1.35} style={[s.subtitle,compact&&{marginTop:12,fontSize:13,lineHeight:18}]}>Link their account to yours in the app, and they’ll get access to all Plus features too.</Text>
        <View style={[s.offers,compact&&{marginTop:20,gap:12}]}>
          {(['yearly', 'monthly'] as const).map(plan => <Pressable key={plan} accessibilityRole="radio" accessibilityLabel={plan === 'yearly' ? 'Yearly' : 'Monthly'}
            accessibilityState={{ selected: p.plan === plan, disabled }} disabled={disabled} onPress={() => p.onSelectPlan(plan)}
            style={[s.plan, p.plan === plan && s.selectedPlan]}>
            <View style={s.planCopy}>
              <View style={s.planHeading}><Text maxFontSizeMultiplier={1.35} style={s.planTitle}>{plan === 'yearly' ? 'Yearly' : 'Monthly'}</Text>
                {plan==='yearly'&&yearlyBestDeal&&<View style={s.bestDeal}><Text maxFontSizeMultiplier={1.25} style={s.bestDealText}>Best Deal</Text></View>}
              </View>
              {p.pricing ? <>
                <Text maxFontSizeMultiplier={1.3} style={s.price}>{`${p.pricing[plan].displayPrice} for 2 Users`}</Text>
                <Text maxFontSizeMultiplier={1.3} style={s.perUser}>{`${perUserMonthlyPrice(p.pricing[plan],plan)} per user/month`}</Text>
              </> : <Text style={s.pending}>{p.priceError ? 'Price unavailable' : 'Preparing store prices…'}</Text>}
            </View>
            {plan === 'yearly' && trial && <View style={s.trial}><Text maxFontSizeMultiplier={1.25} style={s.trialText}>{trial}</Text></View>}
          </Pressable>)}
        </View>
        {p.priceError && <Pressable accessibilityRole="button" onPress={p.onRetry} style={s.retry}><Text style={s.link}>Retry prices</Text></Pressable>}
      </ScrollView>
      <View style={[s.footer, s.plansFooter, { paddingBottom: footerPadding }]}>
        <Button label={p.isPaid ? 'Manage Subscription' : yearlyTrial ? 'Start Free Trial' : 'Start My Plan'}
          color="#4E361E" planStyle disabled={disabled || (!p.isPaid && !p.pricing)} busy={p.purchasing} onPress={p.onPurchase}/>
        {!!terms && <Text maxFontSizeMultiplier={1.25} style={s.disclosure}>{terms}</Text>}
        <View style={s.legal}>
          <Pressable accessibilityRole="link" onPress={() => legal('Privacy')} hitSlop={8}><Text style={s.link}>Privacy</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={p.onRestore} disabled={disabled} hitSlop={8}><Text style={s.restore}>{p.restoring ? 'Restoring…' : 'Restore purchases'}</Text></Pressable>
          <Pressable accessibilityRole="link" onPress={() => legal('Terms')} hitSlop={8}><Text style={s.link}>Terms</Text></Pressable>
        </View>
      </View>
    </> : <>
      <ScrollView style={s.scroll} removeClippedSubviews={false} bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ width: benefitHeader.width, height: benefitHeader.visibleHeight, alignSelf: 'center',
          overflow: 'hidden', marginTop: benefitHeader.marginTop }}>
          <Art accessibilityLabel="Burrow Couple Adventure" source={WORDMARK} contentFit="contain"
            style={{ width: benefitHeader.width, height: benefitHeader.artHeight, position: 'absolute', left: 0, top: -benefitHeader.cropTop }}/>
        </View>
        <View style={[s.plus, { marginTop: benefitHeader.plusGap }]}><Text maxFontSizeMultiplier={1.2} style={s.plusText}>PLUS</Text></View>
        <View style={s.benefits}>
          {PAYWALL_BENEFITS.map((benefit, i) => <View key={benefit.title} style={[s.benefit, i < PAYWALL_BENEFITS.length - 1 && s.divider, { paddingVertical: Math.max(5, 12 * scale) }]}>
            <Art source={benefit.icon} contentFit="contain" style={{ width: benefitIconSize, height: benefitIconSize }}/>
            <View style={s.benefitCopy}><Text maxFontSizeMultiplier={1.35} style={s.benefitTitle}>{benefit.title}</Text>
              <Text maxFontSizeMultiplier={1.35} style={s.benefitDescription}>{benefit.description}</Text></View>
          </View>)}
        </View>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: footerPadding }]}>
        <Button label={trial ? 'Try For Free' : p.priceError && !p.pricing ? 'Retry prices' : 'Continue'} color="#683D35" onPress={p.onContinue}
          disabled={disabled} busy={p.openingPlans}/>
        <Pressable accessibilityRole="button" onPress={p.onRestore} disabled={disabled} style={s.restoreButton}><Text style={s.restore}>{p.restoring ? 'Restoring…' : 'Restore Purchase'}</Text></Pressable>
      </View>
    </>}
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAYWALL_BACKGROUND }, scroll: { flex: 1 },
  nav: { position: 'absolute', zIndex: 3, width: 42, height: 42, borderRadius: 21, backgroundColor: '#583719', justifyContent: 'center', alignItems: 'center' },
  planNav:{width:34,height:34,borderRadius:17},planCta:{borderRadius:9},plansFooter:{paddingHorizontal:20},
  plus: { backgroundColor: '#FFCA4B', borderRadius: 9, paddingHorizontal: 24, paddingVertical: 5, alignSelf: 'center', marginBottom: 22 * .7 },
  plusText: { color: ink, fontSize: 15, fontFamily: 'Inter_700Bold' },
  benefits: { borderRadius: 18, backgroundColor: '#FFFDF8', paddingHorizontal: 12, paddingVertical: 3 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 16 }, divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E8DFD5' },
  benefitCopy: { flex: 1 }, benefitTitle: { color: '#512E22', fontSize: 13, lineHeight: 18, fontFamily: 'Inter_700Bold' },
  benefitDescription: { color: '#8C7F78', fontSize: 12, lineHeight: 16, marginTop: 2, fontFamily: 'Inter_400Regular' },
  footer: { backgroundColor: PAYWALL_BACKGROUND, paddingTop: 10, paddingHorizontal: 22 },
  cta: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 15, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 19, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  restoreButton: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 12 }, restore: { color: '#181310', fontSize: 12, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  plans: { paddingBottom: 24 }, title: { color: ink, fontFamily: 'Inter_900Black', textAlign: 'center' },
  subtitle: { color: '#171310', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 20, fontFamily: 'Inter_400Regular' },
  offers: { gap: 22, marginTop: 26 }, plan: { borderRadius: 10, borderWidth: 1.5, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF', padding: 14, minHeight: 80, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  selectedPlan: { borderColor: '#583724' }, planCopy: { flexGrow: 1, flexShrink: 1, minWidth: 130 }, planTitle: { color: '#111111', fontSize: 16, lineHeight:22, fontFamily: 'Inter_700Bold' },
  planHeading:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:8},
  bestDeal:{backgroundColor:'#FFCA4B',paddingHorizontal:8,paddingVertical:3,borderRadius:2},bestDealText:{color:'#492B16',fontFamily:'Inter_700Bold',fontSize:10},
  price: { color: '#111111', fontSize: 13, lineHeight: 18, marginTop: 3, fontFamily: 'Inter_700Bold' },
  perUser:{color:'#795A42',fontFamily:'Inter_700Bold',fontSize:11,lineHeight:16,marginTop:3},
  pending: { color: '#8C7F78', fontSize: 12, marginTop: 7 }, trial: { backgroundColor: '#50371E', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  trialText: { fontSize: 12, color: '#FFFFFF', fontFamily: 'Inter_700Bold', textAlign: 'center' },
  disclosure: { color: '#211812', fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 14, textAlign: 'center' },
  legal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 17, paddingHorizontal: 16, paddingVertical: 6 },
  link: { color: '#181310', fontFamily: 'Inter_700Bold', fontSize: 12, textDecorationLine: 'underline' }, retry: { padding: 14, alignSelf: 'center' },
});
