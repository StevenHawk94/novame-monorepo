import { useEffect,useState } from 'react';
import { Pressable,StyleSheet,Text,View } from 'react-native';
import { CARROT_PRODUCTS,fetchCarrotProducts,purchaseCarrots,useCarrotPurchase } from '@/lib/carrot-iap';
import { initIAP,reconcileAvailablePurchases,isSubscriptionPurchaseBusy } from '@/lib/iap';
export function CarrotShop({balance}:{balance:number}) {
  const purchase=useCarrotPurchase();
  const [prices,setPrices]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  async function load(){setLoading(true);setError(null);setPrices({});try{await initIAP();const products=await fetchCarrotProducts();setPrices(Object.fromEntries(products.filter(p=>p.displayPrice).map(p=>[p.id,p.displayPrice])));}catch(e){setError(e instanceof Error?e.message:'Store products could not be loaded. Please retry.');}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  const busy=loading||purchase.busy;
  return <View style={s.list}><Text style={s.heading}>More carrots for your burrow</Text><Text style={s.copy}>Choose a pack. Your store shows the final price before you confirm.</Text>
    {balance<0&&<Text style={s.copy}>A refunded purchase included carrots already spent. New carrots first cover the remaining balance of {Math.abs(balance)}.</Text>}
    {CARROT_PRODUCTS.map(id=><View style={s.card} key={id}><Text style={s.heading}>🥕 {Number(id.split('.').pop()).toLocaleString()} carrots</Text><Pressable accessibilityRole="button" disabled={busy||!prices[id]} style={[s.button,(busy||!prices[id])&&s.disabled]} onPress={()=>{if(isSubscriptionPurchaseBusy()){setError('Please finish your subscription purchase first.');return;}setError(null);void purchaseCarrots(id).catch(e=>setError(e instanceof Error?e.message:'Purchase unavailable.'));}}><Text style={s.buttonText}>{prices[id]??(loading?'Loading…':'Unavailable in this store')}</Text></Pressable></View>)}
    {(error||purchase.message)&&<Text accessibilityLiveRegion="polite" style={s.copy}>{error||purchase.message}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void load()} style={s.button}><Text style={s.buttonText}>Reload store prices</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setLoading(true);setError(null);void reconcileAvailablePurchases().then(()=>setError('Pending purchases checked. Completed consumable purchases are already included in your account balance.')).finally(()=>setLoading(false));}} style={s.button}><Text style={s.buttonText}>Check pending purchases</Text></Pressable>
  </View>;
}
const s=StyleSheet.create({list:{gap:16},card:{backgroundColor:'#FFF4E1',padding:22,borderRadius:24,gap:16},heading:{fontSize:23,fontWeight:'700',color:'#553521'},copy:{fontSize:16,lineHeight:24,color:'#553521',backgroundColor:'#FFF4E1',padding:12,borderRadius:14},button:{padding:16,borderRadius:20,backgroundColor:'#2F8D72'},buttonText:{fontSize:17,fontWeight:'700',color:'#FFF4E1',textAlign:'center'},disabled:{opacity:0.5}});
