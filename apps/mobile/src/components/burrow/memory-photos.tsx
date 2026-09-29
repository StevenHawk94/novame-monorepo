import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MajorUpdateBootstrap } from '@/lib/app-major-update-api';
import { registerOverlay } from '@/lib/overlay-presence';
import { RoomPhoto, RoomPhotoEditor } from './room-photo';

type Entry = MajorUpdateBootstrap['memoryEntries'][number];
/** Load signed photos only when the album is open, not for every feed row. */
export function MemoryPhotos({ data, entry }: { data: MajorUpdateBootstrap; entry: Entry }) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<number | null>(null);
  const mine = entry.author_id === data.profile.id;
  useEffect(() => { if (open) return registerOverlay({}); }, [open]);
  return <>
    <Pressable accessibilityRole="button" style={s.button} onPress={() => setOpen(true)}><Text style={s.buttonText}>{mine ? 'Add / view photos' : 'View photos'} · {entry.photos?.length ?? 0}/3</Text></Pressable>
    {open && slot === null && <Modal transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={s.scrim}><ScrollView style={s.sheet} contentContainerStyle={{padding:24,gap:14}}>
        <Text style={s.title}>Little pictures of us</Text>
        <Text>{mine ? 'Up to 3 photos. Tap a photo to replace or delete it.' : 'Your partner’s photos · view only'}</Text>
        {[0,1,2].map(index => {
          const photo = entry.photos?.find(p => p.slot === index);
          return <View key={index} style={s.row}><View style={s.image}><RoomPhoto photo={photo} memory /></View>
            {(mine || photo) && <Pressable accessibilityRole="button" style={s.button} onPress={() => setSlot(index)}><Text style={s.buttonText}>{photo ? mine ? 'Edit photo' : 'View photo' : 'Add photo'} {index+1}</Text></Pressable>}
          </View>;
        })}
        <Pressable accessibilityRole="button" style={s.button} onPress={() => setOpen(false)}><Text style={s.buttonText}>Done</Text></Pressable>
      </ScrollView></View>
    </Modal>}
    {open && slot !== null && <RoomPhotoEditor key={`${entry.id}:${slot}`} data={data} ownerId={entry.author_id} kind="frame"
      memory={{entryId:entry.id,slot,photo:entry.photos?.find(p=>p.slot===slot),canEdit:mine}} onClose={() => setSlot(null)}/>}
  </>;
}
const s=StyleSheet.create({
  button:{backgroundColor:'#2F8D72',padding:14,borderRadius:16,alignItems:'center'},buttonText:{color:'#FFF4E1',fontWeight:'700'},
  scrim:{flex:1,backgroundColor:'#21130CCC',justifyContent:'center',alignItems:'center',padding:20},
  sheet:{width:'100%',maxWidth:520,maxHeight:'88%',backgroundColor:'#FFF4E1',borderRadius:28},
  row:{flexDirection:'row',gap:16,alignItems:'center'},image:{width:110,height:110,borderRadius:16,overflow:'hidden'},title:{fontSize:23,fontWeight:'800',color:'#553521'},
});
