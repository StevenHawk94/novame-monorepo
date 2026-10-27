type Node=Record<string,unknown>;
type Frame={old:Node;fresh:Node;keys:string[];index:number;result:Node;unchanged:boolean;freshChildren:boolean;parentKey?:string};
const comparable=(before:unknown,next:unknown)=>!!before&&!!next&&typeof before==='object'&&typeof next==='object'
  &&Array.isArray(before)===Array.isArray(next);

/** Split display-only remote reconciliation into bounded slices. Local intents
 * and final publication stay synchronous/atomic; callers recheck their epoch
 * and reapply pending projections against the latest state before publishing. */
export async function shareSnapshotWhenIdle<T extends object>(previous:T|null,next:T,options:{
  yield:()=>Promise<void>;valid:()=>boolean;now?:()=>number;maxNodes?:number;
}):Promise<T|null>{
  if(!options.valid())return null;
  if(Object.is(previous,next)||!comparable(previous,next))return next;
  const now=options.now??Date.now,maxNodes=options.maxNodes??2048;
  const frame=(before:unknown,value:unknown,parentKey?:string):Frame=>{
    const old=before as Node,fresh=value as Node,keys=Object.keys(fresh);
    return {old,fresh,keys,index:0,result:Array.isArray(value)?[] as unknown as Node:{},
      unchanged:keys.length===Object.keys(old).length,freshChildren:true,parentKey};
  };
  const stack=[frame(previous,next)];let nodes=0,started=now();
  const accept=(own:Frame,key:string,value:unknown)=>{
    own.result[key]=value;
    if(value!==own.fresh[key])own.freshChildren=false;
    if(!Object.prototype.hasOwnProperty.call(own.old,key)||value!==own.old[key])own.unchanged=false;
  };
  while(stack.length){
    const own=stack[stack.length-1];
    if(own.index===own.keys.length){
      const value=own.unchanged?own.old:own.freshChildren?own.fresh:own.result;
      stack.pop();if(!stack.length)return options.valid()?value as T:null;
      accept(stack[stack.length-1],own.parentKey!,value);
    }else{
      const key=own.keys[own.index++],before=own.old[key],value=own.fresh[key];
      if(!Object.is(before,value)&&comparable(before,value))stack.push(frame(before,value,key));
      else accept(own,key,value);
    }
    nodes++;
    if(nodes>=maxNodes||(nodes%32===0&&now()-started>=3)){
      await options.yield();if(!options.valid())return null;
      nodes=0;started=now();
    }
  }
  return next;
}
