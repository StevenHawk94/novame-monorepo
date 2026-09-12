const FAMILY_SELECT = 'family_key,name,section,module_key,routing_hint,sort_order,library_version'
const SCENARIO_INDEX_SELECT = 'family_key,scenario_key,template_card'
const TEMPLATE_SELECT = 'template_id,family_key,section,module_key,scenario_key,scenario,required_evidence,disqualifiers,emotional_weight,tone_mode,depth_level,field_pattern,label_options,template_card,blocked_overlap,library_version'

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
    familyKey: row.family_key,
    scenarioKey: row.scenario_key,
    label: row.template_card?.label || null,
    title: row.template_card?.title || null,
    observation: row.template_card?.observation || null,
    meaning: row.template_card?.meaning || null,
    takeaway: row.template_card?.takeaway || null,
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
