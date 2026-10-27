import {FriendTextPanel} from './friend-text-panel';

/** The same prose column as invitations, questions and waiting messages. */
export function FriendDialogue({children,onPress,disabled=false,onVisible}:{children:string;onPress:()=>void;disabled?:boolean;onVisible?:()=>void}) {
  return <FriendTextPanel page={{body:children,hint:true}} onAdvance={onPress} disabled={disabled} onVisible={onVisible}/>;
}
