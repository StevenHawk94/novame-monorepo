/**
 * Run a current write RPC with one idempotent repair when a just-onboarded
 * account has not finished creating its companions row yet.
 *
 * This is deliberately a failure-only path: established users pay no extra
 * query. complete_onboarding is idempotent and service-role-only, so retrying
 * the exact original arguments preserves each RPC's own replay/cooldown lock.
 */
export async function runCompanionDependentRpc(supabase, rpcName, args, userId) {
  let response = await supabase.rpc(rpcName, args)
  const message = response.error?.message || ''
  const missing = response.data?.error === 'companion_not_initialized'
    || message.includes('companion_not_initialized')
  if (!missing) return response

  const initialized = await supabase.rpc('complete_onboarding', {
    p_user_id: userId,
    p_companion_id: 'pet1',
  })
  if (initialized.error || initialized.data?.error) {
    return initialized.error
      ? { data: null, error: initialized.error }
      : response
  }

  response = await supabase.rpc(rpcName, args)
  return response
}
