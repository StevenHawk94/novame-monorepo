// Isolated QA App only. Never opens the production MMKV ID or Keychain.
import {createMMKV} from 'react-native-mmkv';
export const storage=createMMKV({id:'burrow-touch-resume-qa-only',encryptionKey:'fixture-only-key-32-characters!!!'});
export const mmkv=storage;
