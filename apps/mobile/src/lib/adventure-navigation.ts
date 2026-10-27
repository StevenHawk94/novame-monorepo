type AdventureStack = {index:number;routes:readonly {name:string;params?:object}[]};
type AdventureStartRouter = {
  dismiss:(count:number)=>void;
  replace:(href:{pathname:'/(main)/burrow-detail';params:{section:'adventure';adventureFade:'1'}})=>void;
};

/** Home → Adventure → journal must return to the EXISTING Adventure route.
 * Replacing just the journal leaves two live ongoing pages; the first swipe
 * then uncovers the duplicate instead of leaving Adventure. Other entry paths
 * still replace the input once, preserving their actual previous screen. */
export function openStartedAdventure(router:AdventureStartRouter,state:AdventureStack|undefined){
  if(state){
    const ancestor=state.routes.findIndex((route,index)=>index<state.index&&route.name==='burrow-detail'
      &&route.params&&'section' in route.params&&route.params.section==='adventure');
    if(ancestor>=0){router.dismiss(state.index-ancestor);return;}
  }
  router.replace({pathname:'/(main)/burrow-detail',params:{section:'adventure',adventureFade:'1'}});
}
