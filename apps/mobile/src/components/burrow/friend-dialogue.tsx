import {FriendTextPanel} from './friend-text-panel';

/** The same prose column as invitations, questions and waiting messages. */
export function FriendDialogue({children,onPress,disabled=false,onVisible,error}:{children:string;onPress:()=>void;disabled?:boolean;onVisible?:()=>void;error?:string|null}) {
  return <FriendTextPanel page={{body:children,hint:true}} onAdvance={onPress} disabled={disabled} onVisible={onVisible} error={error}/>;
}
