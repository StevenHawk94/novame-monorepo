import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {AdventureReveal} from './adventure-reveal';
import {BackIcon} from './burrow-back-button';

/** One visual-novel panel for Adventure and Friends Room. Center the text
 * block and hint together, while the actual prose remains left aligned. */
export function FriendDialogue({children,onPress,disabled=false,onVisible}:{children:string;onPress:()=>void;disabled?:boolean;onVisible?:()=>void}) {
  return <AdventureReveal delay={90} style={s.fill} onVisible={onVisible}>
    <Pressable accessibilityRole="button" accessibilityLabel="Tap to continue" disabled={disabled} onPress={onPress} style={s.fill}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={s.fill} contentContainerStyle={s.content}>
        <View testID="friend-dialogue-block" style={s.block}>
          <Text style={s.copy}>{children}</Text>
          <AdventureReveal delay={300} style={s.hint}>
            <View style={s.chevron}><BackIcon color="#C45A37"/></View>
            <Text style={s.note}>Tap to continue</Text>
          </AdventureReveal>
        </View>
      </ScrollView>
    </Pressable>
  </AdventureReveal>;
}
const s=StyleSheet.create({
  fill:{flex:1},content:{flexGrow:1,justifyContent:'center',paddingVertical:28},
  block:{width:'80%',maxWidth:560,alignSelf:'center'},
  copy:{fontSize:22,lineHeight:30,fontWeight:'700',color:'#4F2C19',textAlign:'left'},
  hint:{marginTop:34,alignItems:'center',gap:5},chevron:{transform:[{rotate:'-90deg'}]},
  note:{fontSize:16,lineHeight:23,color:'#997A63',textAlign:'center'},
});
