import {
  buildBetweenYouUpdate, buildConnectionUpdates, cleanConnectionEvents,
  CONNECTION_CONTENT_VERSION, runConnectionGroupMatcher,
  runConnectionSubScenarioMatcher, selectBetweenYouTemplate,
} from './connection-insight-v8'

function dateMinusDays(date, days) {
  const [year, month, day] = String(date).split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() - days)
  return value.toISOString().slice(0, 10)
}

function mergeUpdates(base, incoming) {
  if (!incoming) return base
  for (const [key, module] of Object.entries(incoming)) {
    if (!module?.hasUpdate || !Array.isArray(module.cards) || module.cards.length === 0) continue
    base[key] ||= { hasUpdate: false, clearExisting: false, cards: [] }
    base[key].hasUpdate = true
    base[key].cards.push(...module.cards)
  }
  return base
}

function fingerprint(event, stage) {
  return `${event.section}:${event.emotion}:${stage}:${event.summary.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').slice(0, 180)}`
}

async function recordUnmatched(supabase, events, { userId, reflectId, localDate }) {
  for (const event of events) {
    const stage = !event.groupMatched ? 'group' : 'sub_scenario'
    const key = fingerprint(event, stage)
    const { data: prior, error: readError } = await supabase.from('connection_unmatched_events')
      .select('id,reflect_id,occurrence_count').eq('user_id', userId).eq('fingerprint', key)
      .eq('failure_stage', stage).maybeSingle()
    if (readError) throw readError
    const row = {
      user_id: userId,
      reflect_id: reflectId,
      local_date: localDate,
      section: event.section,
      emotion: event.emotion,
      summary: event.summary,
      failure_stage: stage,
      candidate_group: event.group || null,
      fingerprint: key,
      last_seen_at: new Date().toISOString(),
      status: 'pending',
      occurrence_count: prior?.reflect_id === reflectId
        ? (prior.occurrence_count || 1)
        : (prior?.occurrence_count || 0) + 1,
    }
    const query = prior?.id
      ? supabase.from('connection_unmatched_events').update(row).eq('id', prior.id)
      : supabase.from('connection_unmatched_events').insert(row)
    const { error } = await query
    if (error) throw error
  }
}

async function storeFacts(supabase, matches, context, { reflectId, localDate, userId }) {
  if (!context.pair) return []
  const rows = matches.filter(({ template }) => ['WYMM', 'TWL'].includes(template.category))
    .map(({ template }) => ({
      user_a: context.pair.ua,
      user_b: context.pair.ub,
      author_user_id: userId,
      reflect_id: reflectId,
      local_date: localDate,
      category: template.category,
      scenario_group: template.group,
      sub_scenario: template.subScenario,
      emotion: template.emotion,
    }))
  if (rows.length) {
    const { error } = await supabase.from('connection_tag_facts')
      .upsert(rows, { onConflict: 'reflect_id,category,sub_scenario,emotion' })
    if (error) throw error
  }
  const { data, error } = await supabase.from('connection_tag_facts').select('*')
    .eq('user_a', context.pair.ua).eq('user_b', context.pair.ub)
    .gte('local_date', dateMinusDays(localDate, 6)).lte('local_date', localDate)
    .order('local_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function runConnectionV8Pipeline(supabase, {
  rawEvents, reflectId, localDate, userId, context,
}) {
  const events = cleanConnectionEvents(rawEvents, localDate)
  if (!context.connectionEligible || events.length === 0) {
    return { updates: null, events, groupResult: null, subResult: null, unmatched: [] }
  }
  const grouped = await runConnectionGroupMatcher(events, { supabase })
  const subMatched = await runConnectionSubScenarioMatcher(grouped.events, { supabase })
  const unmatched = subMatched.events.filter((event) => (
    !event.groupMatched || (event.groupMatched && !event.templateMatched)
  ))
  if (unmatched.length) {
    await recordUnmatched(supabase, unmatched, { userId, reflectId, localDate })
  }
  const built = buildConnectionUpdates(subMatched.events, {
    reflectId, createdAt: new Date().toISOString(),
  })
  const facts = await storeFacts(supabase, built.matches, context, {
    reflectId, localDate, userId,
  })
  if (context.pair) {
    const mine = facts.filter((fact) => fact.author_user_id === userId)
    const theirs = facts.filter((fact) => fact.author_user_id === context.pair.readerId)
    const selected = selectBetweenYouTemplate(mine, theirs)
    const between = buildBetweenYouUpdate(selected, {
      createdAt: new Date().toISOString(),
      sourceKey: `${localDate}:${selected?.mapping?.tag || 'none'}`,
    })
    mergeUpdates(built.updates, between)
  }
  return {
    updates: built.updates,
    events: subMatched.events,
    matches: built.matches,
    unmatched,
    groupResult: grouped,
    subResult: subMatched,
    contentVersion: CONNECTION_CONTENT_VERSION,
  }
}
