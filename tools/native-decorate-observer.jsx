// QA-only observer around the ACTUAL preview. No substituted renderers.
import React,{useLayoutEffect} from 'react';
import {HomeArtPreview as ActualPreview} from '../apps/mobile/src/components/burrow/home-art-preview';
export function HomeArtPreview(props){
 useLayoutEffect(()=>{
  const slots=Object.fromEntries(Object.entries(props.slots).map(([k,v])=>[k,v.stable_id]));
  global.__decorateCommits?.push({at:performance.now(),slots,ownerId:props.ownerId});
 },[props.slots,props.ownerId]);
 return <ActualPreview {...props}/>;
}
