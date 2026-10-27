const assert=require('node:assert/strict');
/** Ignore ONLY approved outfit bitmap fingerprints, never any business data. */
function visualCatalogExpression(alias,ids){
 assert.ok(['previous','incoming'].includes(alias));assert.equal(ids.length,19);
 assert.ok(ids.every(id=>/^burrow_outfit_[a-z0-9_]+$/.test(id)));
 return `(select jsonb_agg(case when x->>'id'=any(array[${ids.map(id=>"'"+id+"'").join(',')}]) and x->>'type'='outfit' and x#>>'{asset,renderer}'='layered_bunny' then jsonb_set(x,'{asset}',(x->'asset')-'bundledArtHash') else x end order by ordinal) from jsonb_array_elements(${alias}->'products') with ordinality p(x,ordinal))`;
}
module.exports={visualCatalogExpression};
