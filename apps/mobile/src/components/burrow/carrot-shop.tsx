import { useEffect,useState } from 'react';
import { Pressable,StyleSheet,Text,View,useWindowDimensions } from 'react-native';
import { Image } from './burrow-image';
import { BURROW_COIN_ART } from '@/lib/burrow-ui-assets';
import { CARROT_PRODUCTS,fetchCarrotProducts,purchaseCarrots,useCarrotPurchase } from '@/lib/carrot-iap';
import { initIAP,reconcileAvailablePurchases,isSubscriptionPurchaseBusy } from '@/lib/iap';
const PRICE_CACHE_MS = 5 * 60_000;
let cachedPrices: Record<string,string> = {};
let pricesFetchedAt = 0;
export function CarrotShop({balance}:{balance:number}) {
  const {height}=useWindowDimensions();
  const purchase=useCarrotPurchase();
  const [prices,setPrices]=useState<Record<string,string>>(cachedPrices);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  async function load(force=false){
    if(!force&&pricesFetchedAt&&Date.now()-pricesFetchedAt<PRICE_CACHE_MS)return;
    const hasPrices=Object.keys(cachedPrices).length>0;
    if(!hasPrices)setLoading(true);
    setError(null);
    try{
      await initIAP();
      const products=await fetchCarrotProducts();
      const next=Object.fromEntries(products.filter(p=>p.displayPrice).map(p=>[p.id,p.displayPrice]));
      if (Object.keys(next).length > 0) {
        cachedPrices=next;pricesFetchedAt=Date.now();setPrices(next);
      } else if (!hasPrices) {
        setError('Store products could not be loaded. Please retry.');
      }
    }catch(e){if(!hasPrices)setError(e instanceof Error?e.message:'Store products could not be loaded. Please retry.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  const busy=loading||purchase.busy;
  return <View style={s.list}><View style={{height:Math.min(height*.34,320)}}/><Text style={[s.heading,{color:'#FFF8EC',textAlign:'center'}]}>More carrots for your burrow</Text><Text style={[s.copy,{textAlign:'center'}]}>Choose a pack. Your store shows the final price before you confirm.</Text>
    {balance<0&&<Text style={s.copy}>A refunded purchase included carrots already spent. New carrots first cover the remaining balance of {Math.abs(balance)}.</Text>}
    {CARROT_PRODUCTS.map(id=>{const amount=Number(id.split('.').pop()) as keyof typeof BURROW_COIN_ART;return <View style={s.card} key={id}><Image source={BURROW_COIN_ART[amount]} contentFit="contain" style={s.packArt}/><View style={s.packInfo}><Text style={s.heading}>{amount.toLocaleString()}</Text><Text style={s.packCopy}>carrots</Text><Pressable accessibilityRole="button" accessibilityLabel={`Buy ${amount} carrots for ${prices[id]??'store price'}`} disabled={busy||!prices[id]} style={[s.button,(busy||!prices[id])&&s.disabled]} onPress={()=>{if(isSubscriptionPurchaseBusy()){setError('Please finish your subscription purchase first.');return;}setError(null);void purchaseCarrots(id).catch(e=>setError(e instanceof Error?e.message:'Purchase unavailable.'));}}><Text style={s.buttonText}>{prices[id]??(loading?'Loading…':'Unavailable in this store')}</Text></Pressable></View></View>;})}
    {(error||purchase.message)&&<Text accessibilityLiveRegion="polite" style={s.copy}>{error||purchase.message}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void load(true)} style={s.button}><Text style={s.buttonText}>Reload store prices</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setLoading(true);setError(null);void reconcileAvailablePurchases().then(()=>setError('Pending purchases checked. Completed consumable purchases are already included in your account balance.')).finally(()=>setLoading(false));}} style={s.button}><Text style={s.buttonText}>Check pending purchases</Text></Pressable>
  </View>;
}
const s=StyleSheet.create({list:{gap:16},card:{backgroundColor:'#FFF4E1',padding:16,borderRadius:24,gap:12,flexDirection:'row',alignItems:'center'},heading:{fontSize:23,fontWeight:'800',color:'#553521'},copy:{fontSize:16,lineHeight:24,color:'#553521',backgroundColor:'#FFF4E1',padding:12,borderRadius:14},packArt:{width:118,height:118},packInfo:{flex:1,gap:4},packCopy:{fontSize:16,fontWeight:'700',color:'#66442C'},button:{padding:14,borderRadius:20,backgroundColor:'#168460'},buttonText:{fontSize:17,fontWeight:'700',color:'#FFF4E1',textAlign:'center'},disabled:{opacity:0.5}});
