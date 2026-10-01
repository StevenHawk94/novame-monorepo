import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RoomPhoto } from './room-photo';

type Photo = { id: string; updatedAt: string };

export function PhotoFrameSheet({photo,onClose,onChoose,onRemove}:{photo?:Photo;onClose:()=>void;onChoose:(source:'camera'|'library')=>void;onRemove:()=>Promise<void>}){
  const {height}=useWindowDimensions();
  const [busy,setBusy]=useState(false);
  const frameSize=Math.min(270,Math.max(195,height*.27));
  async function remove(){
    setBusy(true);
    try{await onRemove();onClose();}
    catch{Alert.alert('Could not remove photo','Please check your connection and try again.');}
    finally{setBusy(false);}
  }
  return <Modal transparent presentationStyle="overFullScreen" animationType="slide" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="Close Photo Frame"/>
      <View style={[styles.sheet,{minHeight:Math.min(height*.69,650)}]} accessibilityViewIsModal>
        <View style={styles.handle}/>
        <View style={styles.header}><Text style={styles.title}>Photo Frame</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><Feather name="x" size={27} color="#4A291F"/></Pressable></View>
        <View style={[styles.frameArea,{height:frameSize+65}]}>
          <View style={styles.hanger}><View style={styles.cordLeft}/><View style={styles.cordRight}/><View style={styles.pin}/></View>
          <View style={[styles.frame,{width:frameSize*.82,height:frameSize}]}>
            <View style={styles.mat}>{photo?<RoomPhoto photo={photo}/>:<View style={styles.placeholder}><Feather name="image" size={68} color="#B7A396"/><View style={styles.plus}><Feather name="plus" size={26} color="#FFF"/></View></View>}</View>
          </View>
        </View>
        <Text style={styles.caption}>{photo?'Your photo is in the room':'Add a photo to this frame'}</Text>
        <Pressable accessibilityRole="button" onPress={()=>onChoose('library')} style={styles.primary}><Feather name={photo?'camera':'upload'} size={23} color="#FFF"/><Text style={styles.primaryText}>{photo?'Change Photo':'Upload Photo'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={()=>photo?Alert.alert('Remove Photo?','Your photo will disappear from the room.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void remove()}]):onChoose('camera')} style={styles.secondary}><Text style={styles.secondaryText}>{photo?'Remove Photo':'Take Photo'}</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

const styles=StyleSheet.create({
  overlay:{flex:1,backgroundColor:'#1D100ABB',justifyContent:'flex-end'},
  sheet:{backgroundColor:'#FFFCF7',borderTopLeftRadius:34,borderTopRightRadius:34,paddingHorizontal:24,paddingBottom:36,alignItems:'center',gap:17},
  handle:{width:48,height:6,borderRadius:6,backgroundColor:'#DBD2CA',marginTop:14},
  header:{width:'100%',flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:2},
  title:{color:'#4C2B22',fontSize:27,fontWeight:'800'},close:{width:43,height:43,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:'#F1EDE7'},
  frameArea:{width:'100%',alignItems:'center',justifyContent:'flex-end'},hanger:{position:'absolute',top:3,width:145,height:80,alignItems:'center'},
  cordLeft:{position:'absolute',top:6,left:28,width:3,height:90,backgroundColor:'#C99B70',transform:[{rotate:'42deg'}]},
  cordRight:{position:'absolute',top:6,right:28,width:3,height:90,backgroundColor:'#C99B70',transform:[{rotate:'-42deg'}]},
  pin:{position:'absolute',top:0,width:12,height:12,borderRadius:6,backgroundColor:'#4B3734'},
  frame:{backgroundColor:'#947159',padding:12,borderRadius:5,shadowColor:'#513325',shadowOpacity:.16,shadowRadius:6,elevation:3},
  mat:{flex:1,borderWidth:8,borderColor:'#FFF3DC',backgroundColor:'#FFF9ED',overflow:'hidden'},
  placeholder:{flex:1,alignItems:'center',justifyContent:'center'},plus:{position:'absolute',right:'17%',bottom:'25%',width:30,height:30,borderRadius:15,backgroundColor:'#B09B8D',alignItems:'center',justifyContent:'center'},
  caption:{color:'#4C2B22',fontSize:19,fontWeight:'700',textAlign:'center',marginBottom:5},
  primary:{width:'100%',minHeight:62,borderRadius:36,backgroundColor:'#4C2B22',flexDirection:'row',gap:12,alignItems:'center',justifyContent:'center'},
  primaryText:{fontSize:20,fontWeight:'800',color:'#FFF9F2'},secondary:{minHeight:44,alignItems:'center',justifyContent:'center'},secondaryText:{color:'#D76444',fontSize:17,fontWeight:'700'},
});
