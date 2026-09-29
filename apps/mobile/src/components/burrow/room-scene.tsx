import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import type { MajorUpdateCatalogItem, MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { RoomPhoto } from './room-photo';
import { BunnyActor } from './bunny-actor';

/** Code-native placeholder art: each fixed slot can be replaced by a catalog
 * image later without baking controls or text into a full-screen screenshot. */
export function RoomScene({ slots, away, shared = false, sleeping, photos = [], onSlot, partnerOutfit, busy = false, canFeed = true }: {
  slots: Record<string, MajorUpdateCatalogItem>;
  away?: boolean;
  shared?: boolean;
  sleeping?: { mine: boolean; partner: boolean };
  photos?: MajorUpdateBootstrap['roomPhotos'];
  onSlot?: (slot: string) => void;
  partnerOutfit?: MajorUpdateCatalogItem;
  busy?: boolean;
  canFeed?: boolean;
}) {
  const windowItem = shared ? slots.our_window : slots.window;
  const night = windowItem?.stable_id.includes('02');
  const coolWalls = shared && slots.our_wall?.stable_id.endsWith('02');
  return <View style={styles.scene} accessibilityLabel={shared ? 'Our shared burrow' : 'Your bunny’s room'}>
    <Svg viewBox="0 0 360 470" width="100%" height="100%" pointerEvents="none">
      <Rect width="360" height="470" fill={coolWalls ? '#596B82' : '#A4492C'} />
      <Path d="M0 0H360V120Q300 35 236 88Q190 120 140 48Q80 32 0 120Z" fill="#713921" />
      <Path d="M0 190Q50 100 80 200T200 178T360 100V430H0Z" fill={coolWalls ? '#75818E' : '#BA5730'} />
      <Path d="M0 385Q170 335 360 386V470H0Z" fill={coolWalls ? '#AC9890' : '#D87540'} />
      <Path d="M20 55Q180 144 342 52" stroke="#573D2F" strokeWidth="3" fill="none" />
      {[40,80,120,160,200,240,280,320].map((x,i)=><Circle key={x} cx={x} cy={70+Math.sin(i/7*Math.PI)*31} r="5" fill="#FFDF7B" />)}
      <Path d="M26 245V206Q48 174 70 206V245Z" fill="#713B28" />
      <Path d="M40 239Q31 225 48 207Q62 229 54 239Z" fill="#FFD073" />
      {windowItem && <G>
        <Path d="M88 231V155A42 42 0 0 1 172 155V231Z" fill={night?'#273963':'#ACE0DB'} stroke="#DBAC6E" strokeWidth="9" />
        <Path d="M92 226V197L108 181L134 205L160 174L168 196V226Z" fill={night?'#487181':'#80AC6C'} />
        <Circle cx="143" cy="158" r="14" fill="#FFECA7" />
        <Line x1="130" y1="118" x2="130" y2="228" stroke="#AE7847" strokeWidth="6" />
        <Line x1="88" y1="179" x2="172" y2="179" stroke="#AE7847" strokeWidth="6" />
        <Path d="M87 133Q100 169 87 228M172 133Q160 169 172 228" stroke="#FFF0D6" strokeWidth="11" fill="none" />
      </G>}
      {slots.cabinet && <G>
        <Rect x="170" y="280" width="113" height="104" rx="5" fill="#653831" />
        {[288,318,348].map(y=><G key={y}><Rect x="178" y={y} width="96" height="25" rx="2" fill="#79443A" stroke="#AA7160" /><Circle cx="226" cy={y+12} r="3" fill="#D0997A" /></G>)}
      </G>}
      {slots.rug && <Ellipse cx="231" cy="414" rx="95" ry="22" fill={slots.rug.price ? '#D7A04E':'#368A77'} />}
      {slots.table && <G><Path d="M253 365L245 419M294 365L302 419" stroke="#734126" strokeWidth="16" /><Ellipse cx="274" cy="363" rx="46" ry="15" fill="#BF8D54" /></G>}
      {slots.cushion && <Ellipse cx="112" cy="383" rx="69" ry="26" fill={slots.cushion.price?'#CC9964':'#348C78'} />}
      {shared && slots.our_light && <G><Line x1="235" y1="25" x2="235" y2="131" stroke="#563C2C" strokeWidth="4"/><Circle cx="235" cy="143" r="27" fill={slots.our_light.price?'#F7C4C8':'#FFE29A'}/><Circle cx="235" cy="143" r="16" fill="#FFF0C7"/></G>}
      {shared && slots.our_rug && <Ellipse cx="170" cy="418" rx="135" ry="26" fill={slots.our_rug.price?'#738F91':'#B55D50'} stroke="#E6BC8B" strokeWidth="6"/>}
      {shared && <Ellipse cx="150" cy="382" rx="111" ry="37" fill={slots.bed?.price?'#677CB3':'#EFCA93'} stroke="#A96D42" strokeWidth="7" />}
      {shared && sleeping?.mine && sleeping.partner && <Rect width="360" height="470" fill="#182345" opacity="0.35"/>}
    </Svg>
    <BunnyActor outfit={slots.outfit} pose={shared ? sleeping?.mine ? 'sleeping' : 'idle' : away ? 'away' : 'idle'}/>
    {shared && <BunnyActor outfit={partnerOutfit} partner pose={sleeping?.partner ? 'sleeping' : 'idle'}/>}
    {shared && (sleeping?.mine || sleeping?.partner) && <Text pointerEvents="none" style={styles.sleepLabel}>
      {sleeping.mine ? 'z Z' : ''}        {sleeping.partner ? 'z Z' : ''}
    </Text>}
    {onSlot && (shared || !away) && <Pressable accessibilityRole="button" disabled={busy || (!shared && !canFeed)}
      accessibilityState={{disabled:busy || (!shared && !canFeed)}}
      accessibilityLabel={shared ? sleeping?.mine ? 'Wake my bunny' : 'Put my bunny to sleep' : 'Feed bunny'}
      onPress={()=>onSlot(shared?'bed':'bunny')} style={styles.bunnyTarget}/>}
    {(['lamp','vase','decor','poster','music_player','frame','couple_doll'] as const).map(slot => slots[slot] &&
      <Pressable key={slot} disabled={!onSlot} onPress={()=>onSlot?.(slot)}
        accessibilityLabel={slots[slot].title} style={[styles.object, positions[slot]]}>
        {(slot==='frame'||slot==='couple_doll')&&photos.some(photo=>photo.kind===(slot==='frame'?'frame':'doll'))
          ? <View pointerEvents="none" style={[styles.photo,slot==='couple_doll'&&{borderRadius:40}]}><RoomPhoto photo={photos.find(photo=>photo.kind===(slot==='frame'?'frame':'doll'))} circle={slot==='couple_doll'}/></View>
          : <Text style={styles.symbol}>{symbols[slot]}</Text>}
      </Pressable>)}
    <View style={styles.label}><Text style={styles.labelText}>{away ? 'Out collecting today’s stories' : shared ? 'A little closer, together' : 'A little place to call home'}</Text></View>
  </View>;
}

const symbols: Record<string,string> = { lamp:'🍄',vase:'🌼',decor:'🪴',poster:'🍃',music_player:'📻',frame:'🖼️',couple_doll:'🧸' };
const positions = StyleSheet.create({
  lamp:{left:'6%',top:'63%'},vase:{left:'70%',top:'65%'},decor:{left:'51%',top:'52%'},
  poster:{left:'48%',top:'37%'},music_player:{left:'71%',top:'32%'},frame:{left:'74%',top:'46%'},couple_doll:{left:'62%',top:'53%'},
});
const styles=StyleSheet.create({
  scene:{width:'100%',aspectRatio:360/470,borderRadius:32,overflow:'hidden',backgroundColor:'#A4492C'},
  object:{position:'absolute',width:'13%',height:'11%',alignItems:'center',justifyContent:'center'},
  symbol:{fontSize:31},label:{position:'absolute',top:14,alignSelf:'center'},labelText:{color:'#FFE7C3',fontSize:12,fontWeight:'600'},
  photo:{width:'100%',aspectRatio:1,borderWidth:3,borderColor:'#EAC492',borderRadius:5,overflow:'hidden'},
  bunnyTarget:{position:'absolute',left:'14%',top:'59%',width:'49%',height:'26%'},
  sleepLabel:{position:'absolute',left:'22%',top:'51%',color:'#FFF3CF',fontSize:23,fontWeight:'700'},
});
