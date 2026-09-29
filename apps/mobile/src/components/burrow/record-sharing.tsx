import {Switch,Text,View} from 'react-native';
export function RecordSharing({shared,onChange,disabled=false}:{shared:boolean;onChange:(value:boolean)=>void;disabled?:boolean}) {
 return <View style={{padding:12,flexDirection:'row',gap:12,alignItems:'center'}}><View style={{flex:1}}><Text style={{color:'#553521',fontWeight:'700'}}>Share this day with my partner</Text><Text style={{color:'#79563E',fontSize:13}}>{shared?'Your words and visible Memories will appear in Moments.':'Only you can see this day in Moments.'}</Text></View><Switch accessibilityLabel="Share this day with my partner" value={shared} onValueChange={onChange} disabled={disabled}/></View>;
}
