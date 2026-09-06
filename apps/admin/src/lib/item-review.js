import { ITEM_DICTIONARY, ITEM_CATALOG_VERSION, NEVER_AUTO_ITEMS, normalizeItemKeyword, applyItemRules, applyRemoteItemManifest } from '@novame/engine'
import { loadCurrentItemManifest } from './item-manifest'

export async function reviewSnapshot(db) {
  const { data, error } = await db.rpc('item_rule_snapshot', { p_catalog: ITEM_CATALOG_VERSION })
  if (error) throw error
  return data
}
export async function publishReview(db, input, adminId) {
  const snapshot = await reviewSnapshot(db)
  if (input.revision !== snapshot.revision) throw new Error('Rules changed. Refresh before reviewing.')
  const remote = await loadCurrentItemManifest()
  const publishedBase = applyRemoteItemManifest(ITEM_DICTIONARY, remote.manifest)
  const dictionary = applyItemRules(publishedBase, snapshot.rules)
  let keyword, itemId, action, candidateId = null, removalId = null
  if (input.action === 'publish') {
    const { data: row, error } = await db.from('item_learning_candidates').select('*').eq('id', input.id).single()
    if (error) throw error
    if (row.kind !== 'missing_keyword' || row.evidence_version !== 2 || !row.source_phrase) throw new Error('A verified source phrase is required; legacy suggestions cannot be published.')
    if (!['pending', 'approved'].includes(row.status)) throw new Error('This suggestion has already been reviewed.')
    keyword = normalizeItemKeyword(row.source_phrase)
    itemId = typeof input.itemId === 'string' ? input.itemId : row.suggested_item_id
    if (!Object.prototype.hasOwnProperty.call(dictionary.items, itemId)) throw new Error('Choose an existing item ID.')
    const remoteNeverAuto = (remote.manifest?.items || []).some(item => item.itemId === itemId
      && item.keywordSafety?.some(rule => normalizeItemKeyword(rule.keyword) === keyword && rule.triggerMode === 'NEVER_AUTO'))
    const reviewedNeverAuto = snapshot.rules.some(rule => normalizeItemKeyword(rule.keyword) === keyword
      && rule.item_id === itemId && rule.action === 'never')
    if (NEVER_AUTO_ITEMS[keyword]?.includes(itemId) || remoteNeverAuto || reviewedNeverAuto) {
      throw new Error('This keyword is classified NEVER_AUTO for this icon and cannot be enabled as AUTO.')
    }
    if (dictionary.synonyms[keyword] && dictionary.synonyms[keyword] !== itemId) throw new Error('This keyword already belongs to another icon.')
    if (publishedBase.synonyms[keyword] && publishedBase.synonyms[keyword] !== itemId) throw new Error('A disabled keyword still belongs to another catalog icon. Edit the source catalog or Item Manifest to transfer ownership.')
    if (publishedBase.exclusions?.[keyword]?.length) throw new Error('This phrase has exclusion rules. Review it in the source catalog or Item Manifest instead of replacing its safety policy.')
    action = 'enable'; candidateId = row.id
  } else if (input.action === 'disable') {
    const { data: row, error } = await db.from('item_match_removals').select('*').eq('id', input.id).single()
    if (error) throw error
    if (row.catalog_version !== ITEM_CATALOG_VERSION || row.status !== 'pending') throw new Error('Refresh this removal record before reviewing.')
    keyword = row.keyword; itemId = row.item_id
    if (dictionary.synonyms[keyword] !== itemId) throw new Error('This exact keyword is no longer enabled for that icon.')
    action = 'disable'; removalId = row.id
  } else if (input.action === 'undo') {
    const { data: event, error } = await db.from('item_keyword_rule_events').select('*').eq('revision', input.eventRevision).single()
    if (error) throw error
    if (event.catalog_version !== ITEM_CATALOG_VERSION || !snapshot.rules.some(r => r.keyword === event.keyword && r.revision === event.revision)) throw new Error('Only the latest change for a keyword can be undone.')
    const { data: prior, error: priorError } = await db.from('item_keyword_rule_events').select('*')
      .eq('catalog_version', ITEM_CATALOG_VERSION).eq('keyword', event.keyword).lt('revision', event.revision)
      .order('revision', { ascending: false }).limit(1).maybeSingle()
    if (priorError) throw priorError
    keyword = event.keyword; itemId = prior?.item_id || event.item_id; action = prior?.action || 'reset'
  } else throw new Error('Invalid action')
  const { data, error } = await db.rpc('publish_item_rule', {
    p_catalog: ITEM_CATALOG_VERSION, p_keyword: keyword, p_item_id: itemId, p_action: action,
    p_expected_revision: snapshot.revision, p_admin: adminId, p_candidate: candidateId, p_removal: removalId,
  })
  if (error) throw error
  return data
}

export async function publishManualRule(db, input, adminId) {
  const snapshot = await reviewSnapshot(db)
  if (input.revision !== snapshot.revision) throw new Error('Rules changed. Refresh this icon before saving.')
  const remote = await loadCurrentItemManifest()
  const publishedBase = applyRemoteItemManifest(ITEM_DICTIONARY, remote.manifest)
  const dictionary = applyItemRules(publishedBase, snapshot.rules)
  const keyword = normalizeItemKeyword(String(input.keyword || ''))
  const itemId = String(input.itemId || '')
  if (!Object.prototype.hasOwnProperty.call(dictionary.items, itemId)) throw new Error('Choose an existing icon.')
  if (!keyword || keyword.length > 100) throw new Error('Keyword must be between 1 and 100 characters.')

  let action
  if (input.action === 'add') {
    const triggerMode = input.triggerMode === 'NEVER_AUTO' ? 'NEVER_AUTO' : 'AUTO'
    const remoteNeverAuto = (remote.manifest?.items || []).some(item => item.itemId === itemId
      && item.keywordSafety?.some(rule => normalizeItemKeyword(rule.keyword) === keyword && rule.triggerMode === 'NEVER_AUTO'))
    const latestRule = snapshot.rules.find(rule => normalizeItemKeyword(rule.keyword) === keyword)
    if (triggerMode === 'AUTO' && (NEVER_AUTO_ITEMS[keyword]?.includes(itemId) || remoteNeverAuto)) {
      throw new Error('This keyword is classified NEVER_AUTO in the reviewed catalog and cannot be enabled here.')
    }
    if (triggerMode === 'AUTO' && latestRule?.action === 'never' && latestRule.item_id === itemId) {
      throw new Error('Remove the current NEVER_AUTO rule before enabling this keyword as AUTO.')
    }
    if (dictionary.synonyms[keyword] && dictionary.synonyms[keyword] !== itemId) {
      throw new Error(`This phrase already belongs to ${dictionary.items[dictionary.synonyms[keyword]]?.displayName || 'another icon'}.`)
    }
    if (triggerMode === 'AUTO' && dictionary.synonyms[keyword] === itemId) throw new Error('This keyword is already AUTO for this icon.')
    if (triggerMode === 'NEVER_AUTO' && latestRule?.action === 'never' && latestRule.item_id === itemId) {
      throw new Error('This keyword is already NEVER_AUTO for this icon.')
    }
    if (triggerMode === 'NEVER_AUTO' && (NEVER_AUTO_ITEMS[keyword]?.includes(itemId) || remoteNeverAuto)) {
      throw new Error('This keyword is already NEVER_AUTO for this icon in the reviewed catalog.')
    }
    if (triggerMode === 'AUTO' && publishedBase.exclusions?.[keyword]?.length) {
      throw new Error('This phrase has exclusion rules. Maintain it through the reviewed Item Manifest instead.')
    }
    action = triggerMode === 'NEVER_AUTO' ? 'never' : 'enable'
  } else if (input.action === 'delete') {
    if (dictionary.synonyms[keyword] !== itemId) throw new Error('This exact phrase is not active for this icon.')
    action = 'disable'
  } else if (input.action === 'restore') {
    const currentRule = snapshot.rules.find(rule => normalizeItemKeyword(rule.keyword) === keyword)
    if (currentRule?.action === 'never' && currentRule.item_id === itemId) {
      const { data: prior, error: priorError } = await db.from('item_keyword_rule_events').select('item_id,action')
        .eq('catalog_version', ITEM_CATALOG_VERSION).eq('keyword', keyword).lt('revision', currentRule.revision)
        .order('revision', { ascending: false }).limit(1).maybeSingle()
      if (priorError) throw priorError
      action = prior?.action || 'reset'
    } else {
      if (dictionary.synonyms[keyword] === itemId) throw new Error('This phrase is already active.')
      const owner = dictionary.synonyms[keyword]
      if (owner && owner !== itemId) throw new Error('This phrase now belongs to another icon.')
      action = publishedBase.synonyms[keyword] === itemId ? 'reset' : 'enable'
    }
  } else throw new Error('Invalid manual rule action.')

  const { data, error } = await db.rpc('publish_item_rule', {
    p_catalog: ITEM_CATALOG_VERSION, p_keyword: keyword, p_item_id: itemId, p_action: action,
    p_expected_revision: snapshot.revision, p_admin: adminId, p_candidate: null, p_removal: null,
  })
  if (error) throw error
  return data
}

export async function loadReview(db, status) {
  let candidates = db.from('item_learning_candidates').select('*').order('last_seen_at', { ascending: false }).limit(300)
  let removals = db.from('item_match_removals').select('id,item_id,icon_name,keyword,status,catalog_version,created_at').order('created_at', { ascending: false }).limit(300)
  const iconBacklog = db.from('item_learning_candidates').select('*')
    .eq('kind', 'missing_icon').eq('status', 'approved')
    .order('reviewed_at', { ascending: false }).limit(300)
  if (status !== 'all') { candidates = candidates.eq('status', status); removals = removals.eq('status', status) }
  const [c, r, backlog, events, snapshot] = await Promise.all([candidates, removals, iconBacklog,
    db.from('item_keyword_rule_events').select('revision,keyword,item_id,action,created_at').eq('catalog_version', ITEM_CATALOG_VERSION).order('revision', { ascending: false }).limit(100),
    reviewSnapshot(db),
  ])
  for (const result of [c, r, backlog, events]) if (result.error) throw result.error
  return { candidates: c.data || [], removals: r.data || [], iconBacklog: backlog.data || [], events: events.data || [], snapshot }
}
