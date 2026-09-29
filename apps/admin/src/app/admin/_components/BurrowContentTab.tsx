'use client';
import { useEffect, useRef, useState } from 'react';
type Row={stable_id?:string;id?:string;title?:string;name?:string;prompt?:string;status:string};
type Editor={current:Record<string,unknown>;baseHash:string;editable:string[];draft:null|{version:number;payload:Record<string,unknown>}};
export default function BurrowContentTab(){
  const [kind,setKind]=useState('dialogue');const [rows,setRows]=useState<Row[]>([]);const [id,setId]=useState('');
  const [editor,setEditor]=useState<Editor|null>(null);const [copy,setCopy]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const generation=useRef(0);
  async function load(target:string){
    const token=++generation.current;setBusy(true);setEditor(null);setMessage('');setId(target);
    try{const response=await fetch(`/api/admin/burrow-content?kind=${kind}&id=${encodeURIComponent(target)}`,{cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.error);
      if(token!==generation.current)return;
      setEditor(data);setCopy(JSON.stringify(data.draft?.payload??Object.fromEntries(data.editable.map((key:string)=>[key,data.current[key]])),null,2));
    }catch(e){if(token===generation.current)setMessage(String(e));}finally{if(token===generation.current)setBusy(false);}
  }
  useEffect(()=>{const token=++generation.current;setRows([]);setEditor(null);setId('');setMessage('');setBusy(true);
    void fetch(`/api/admin/burrow-content?kind=${kind}`,{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);if(token===generation.current)setRows(data.rows);}).catch(e=>{if(token===generation.current)setMessage(String(e));}).finally(()=>{if(token===generation.current)setBusy(false);});
    return()=>{generation.current++;};
  },[kind]);
  async function submit(action:'stage'|'publish'){
    if(!editor||busy)return;
    if(action==='publish'&&!window.confirm('Publish the saved draft? Existing adventure/visit snapshots will keep their original content.'))return;
    setBusy(true);setMessage('');
    try{const response=await fetch('/api/admin/burrow-content',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,id,action,payload:action==='stage'?JSON.parse(copy):null,version:editor.draft?.version??0,baseHash:editor.baseHash})});
      const data=await response.json();if(!response.ok)throw Error(data.error);await load(id);setMessage(action==='stage'?'Draft saved. Review before publishing.':'Published. Existing in-progress stories remain unchanged.');
    }catch(e){setMessage(`${e}. Your editor text is preserved. Conflicts require reloading.`);}finally{setBusy(false);}
  }
  return <section className="space-y-4">
    <h2 className="text-xl font-bold">Burrow content studio</h2>
    <p>Edit placeholder copy and art metadata without changing stable IDs, prices, inventory or live adventure snapshots. Publication is atomic and audited. Art still needs the matching app asset manifest.</p>
    <label>Content type <select disabled={busy} value={kind} onChange={e=>setKind(e.target.value)} className="border p-2">{['dialogue','friends','prompts','catalog'].map(k=><option key={k}>{k}</option>)}</select></label>
    <label className="block">Entry <select disabled={busy} value={id} onChange={e=>void load(e.target.value)} className="border p-2 max-w-full"><option value="">Choose an entry</option>{rows.map(r=><option key={r.id??r.stable_id} value={r.id??r.stable_id}>{r.title??r.name??r.prompt} · {r.status}</option>)}</select></label>
    {editor&&<><p>Editable fields: {editor.editable.join(', ')}. Publish uses the saved draft, not unsaved text.</p>
      <textarea aria-label="Content JSON draft" value={copy} onChange={e=>setCopy(e.target.value)} disabled={busy} rows={18} className="font-mono text-sm border w-full p-3"/>
      <div className="flex gap-3"><button disabled={busy} onClick={()=>void submit('stage')} className="border rounded p-3">Save draft</button>
        <button disabled={busy||!editor.draft||copy!==JSON.stringify(editor.draft.payload,null,2)} onClick={()=>void submit('publish')} className="border rounded p-3">Publish saved draft</button>
        <button disabled={busy} onClick={()=>{if(window.confirm('Reload and discard unsaved editor text?'))void load(id);}} className="border rounded p-3">Reload</button></div></>}
    {message&&<p role="status">{message}</p>}{busy&&<p role="status">Loading…</p>}
  </section>;
}
