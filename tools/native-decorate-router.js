// The isolated host has React Navigation, not Expo Router's filesystem root.
// Exercise actual back/unmount/focus against its real stack, no app transport.
export {useFocusEffect,useIsFocused,useNavigation} from '@react-navigation/native';
export const router={back:()=>global.__decorateBack?.(),canGoBack:()=>true,
 push:()=>{throw Error('Unscoped QA navigation');},navigate:()=>{throw Error('Unscoped QA navigation');}};
