/** One authority for API gates. Profiles are only a UI projection. */
export async function effectiveHasPlus(db,user){
 const result=await db.rpc('burrow_has_plus_v1',{p_user:user})
 if(result.error||typeof result.data!=='boolean')throw Error('entitlement_unavailable')
 return result.data
}
