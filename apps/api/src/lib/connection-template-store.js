const FAMILY_SELECT = 'family_key,name,section,module_key,routing_hint,sort_order,library_version'
const SCENARIO_INDEX_SELECT = 'template_id,family_key,section,module_key,scenario_key,scenario,required_evidence,disqualifiers,emotional_weight,signal_type,temporal_state,persistence,topic_domain,emotion_family,support_mode,support_openness,response_preference,boundary_key,timing,mutuality,depth_range,hard_match_tags,preferred_tags,search_aliases,retrieval_text,fallback_policy,blocked_overlap,library_version'
const TEMPLATE_SELECT = 'template_id,family_key,section,module_key,scenario_key,scenario,required_evidence,disqualifiers,emotional_weight,tone_mode,depth_level,field_pattern,label_options,template_card,blocked_overlap,library_version'
const VARIANT_SELECT = 'template_variant_id,scenario_key,section,variant_key,depth_band,tone_mode,playful_eligible,playful_block_reason,emotional_weight,depth_level,field_pattern,template_card,required_slots,selection_rule,null_policy,library_version'

export async function readConnectionFamilies(supabase) {
  const { data, error } = await supabase.from('connection_scenario_families')
    .select(FAMILY_SELECT)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => ({
    familyKey: row.family_key,
    name: row.name,
    section: row.section,
    moduleKey: row.module_key,
    routingHint: row.routing_hint,
    libraryVersion: row.library_version,
  }))
}
export async function readConnectionTemplates(supabase, familyKeys) {
  const keys = [...new Set((familyKeys || []).filter(Boolean))].slice(0, 3)
  if (keys.length === 0) return []
  const { data, error } = await supabase.from('connection_scenario_templates')
    .select(TEMPLATE_SELECT)
    .eq('active', true)
    .in('family_key', keys)
    .order('template_id', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => ({
    templateId: row.template_id,
    familyKey: row.family_key,
    section: row.section,
    moduleKey: row.module_key,
    scenarioKey: row.scenario_key,
    scenario: row.scenario,
    requiredEvidence: row.required_evidence,
    disqualifiers: row.disqualifiers,
    emotionalWeight: row.emotional_weight,
    toneMode: row.tone_mode,
    depthLevel: row.depth_level,
    fieldPattern: row.field_pattern,
    labelOptions: row.label_options,
    templateCard: row.template_card,
    blockedOverlap: row.blocked_overlap,
    libraryVersion: row.library_version,
  }))
}

export async function readConnectionScenarioIndex(supabase, familyKeys) {
  const keys = [...new Set((familyKeys || []).filter(Boolean))].slice(0, 3)
  if (keys.length === 0) return []
  const { data, error } = await supabase.from('connection_scenario_templates')
    .select(SCENARIO_INDEX_SELECT)
    .eq('active', true)
    .in('family_key', keys)
    .order('scenario_key', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => ({
    templateId: row.template_id,
    familyKey: row.family_key,
    section: row.section,
    moduleKey: row.module_key,
    scenarioKey: row.scenario_key,
    scenario: row.scenario,
    requiredEvidence: row.required_evidence,
    disqualifiers: row.disqualifiers,
    emotionalWeight: row.emotional_weight,
    signalType: row.signal_type,
    temporalState: row.temporal_state,
    persistence: row.persistence,
    topicDomain: row.topic_domain,
    emotionFamily: row.emotion_family,
    supportMode: row.support_mode,
    supportOpenness: row.support_openness,
    responsePreference: row.response_preference,
    boundary: row.boundary_key,
    timing: row.timing,
    mutuality: row.mutuality,
    depthRange: row.depth_range,
    hardMatchTags: row.hard_match_tags,
    preferredTags: row.preferred_tags,
    searchAliases: row.search_aliases,
    retrievalText: row.retrieval_text,
    fallbackPolicy: row.fallback_policy,
    blockedOverlap: row.blocked_overlap,
    libraryVersion: row.library_version,
  }))
}

export async function readConnectionTemplateVariants(supabase, familyKeys) {
  const keys = [...new Set((familyKeys || []).filter(Boolean))].slice(0, 3)
  if (keys.length === 0) return []
  const { data: scenarios, error: scenarioError } = await supabase
    .from('connection_scenario_templates')
    .select('scenario_key').eq('active', true).in('family_key', keys)
  if (scenarioError) throw scenarioError
  const scenarioKeys = (scenarios || []).map((row) => row.scenario_key).filter(Boolean)
  if (scenarioKeys.length === 0) return []
  const { data, error } = await supabase.from('connection_template_variants')
    .select(VARIANT_SELECT)
    .eq('active', true)
    .in('scenario_key', scenarioKeys)
    .order('template_variant_id', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => ({
    templateVariantId: row.template_variant_id,
    scenarioKey: row.scenario_key,
    section: row.section,
    variantKey: row.variant_key,
    depthBand: row.depth_band,
    toneMode: row.tone_mode,
    playfulEligible: row.playful_eligible === true,
    playfulBlockReason: row.playful_block_reason,
    emotionalWeight: row.emotional_weight,
    depthLevel: row.depth_level,
    fieldPattern: row.field_pattern,
    templateCard: row.template_card,
    requiredSlots: row.required_slots,
    selectionRule: row.selection_rule,
    nullPolicy: row.null_policy,
    libraryVersion: row.library_version,
  }))
}

export async function readConnectionTemplatesByScenarioKeys(supabase, scenarioKeys) {
  const keys = [...new Set((scenarioKeys || []).filter(Boolean))].slice(0, 3)
  if (keys.length === 0) return []
  const { data, error } = await supabase.from('connection_scenario_templates')
    .select(TEMPLATE_SELECT)
    .eq('active', true)
    .in('scenario_key', keys)
    .order('scenario_key', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => ({
    templateId: row.template_id,
    familyKey: row.family_key,
    section: row.section,
    moduleKey: row.module_key,
    scenarioKey: row.scenario_key,
    scenario: row.scenario,
    requiredEvidence: row.required_evidence,
    disqualifiers: row.disqualifiers,
    emotionalWeight: row.emotional_weight,
    toneMode: row.tone_mode,
    depthLevel: row.depth_level,
    fieldPattern: row.field_pattern,
    labelOptions: row.label_options,
    templateCard: row.template_card,
    blockedOverlap: row.blocked_overlap,
    libraryVersion: row.library_version,
  }))
}
