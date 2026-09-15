function answerForDimension(questions, answers, dimension) {
  const question = questions.find((item) => item.analysis_dimension === dimension)
  return question ? answers[question.question_number] : undefined
}

function sameAnswer(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? [...left].sort() : [left]
    const b = Array.isArray(right) ? [...right].sort() : [right]
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return left === right
}

function includesAnswer(container, value) {
  return Array.isArray(container) ? container.includes(value) : container === value
}

function ordinalGap(left, right, order) {
  const a = order.indexOf(left)
  const b = order.indexOf(right)
  return a < 0 || b < 0 ? Number.POSITIVE_INFINITY : Math.abs(a - b)
}

function relativeHistoryAgrees(first, second) {
  return (first === 'self' && second === 'other') || (first === 'other' && second === 'self')
}

function compatibleSentSignal(sent, wanted) {
  if (sent === wanted) return true
  return sent === 'quiet' && wanted === 'plan_contact'
}

export function fixedLaunchOutcomeV2(definition, questions, first, second) {
  const value = (answers, dimension) => answerForDimension(questions, answers, dimension)
  const pair = (dimension) => [value(first, dimension), value(second, dimension)]
  const crossMatches = (leftDimension, rightDimension, compatible = sameAnswer) =>
    Number(compatible(value(first, leftDimension), value(second, rightDimension)))
    + Number(compatible(value(second, leftDimension), value(first, rightDimension)))

  switch (definition.case_id) {
    case 'LOVE-04': {
      const desiredToInitiation = {
        checkin: ['text', 'call'], affection: ['physical_affection'], plans: ['plan'], appreciation: ['appreciation'], balanced: [],
      }
      const desired = pair('desired_channel')
      const reciprocal = [
        desiredToInitiation[desired[0]]?.some((item) => includesAnswer(value(second, 'initiation_channels'), item)),
        desiredToInitiation[desired[1]]?.some((item) => includesAnswer(value(first, 'initiation_channels'), item)),
      ]
      const hits = reciprocal.filter(Boolean).length
      const counts = pair('initiation_channels').map((item) => Array.isArray(item) ? item.length : 0)
      if (desired.includes('balanced') || hits === 2 || (hits === 1 && Math.abs(counts[0] - counts[1]) <= 1)) return 'balanced'
      return Math.abs(counts[0] - counts[1]) >= 2 ? 'imbalance' : 'missed_channel'
    }
    case 'CLOSE-02': {
      const matches = ['comfort_pick', 'plan_pick', 'support_pick', 'current_phrase']
        .filter((dimension) => sameAnswer(value(first, dimension), value(second, dimension))).length
      return matches >= 3 ? 'high' : matches >= 1 ? 'mixed' : 'low'
    }
    case 'CLOSE-06': {
      const matches = ['food_pick', 'free_hour', 'message_pick', 'treat_pick']
        .filter((dimension) => sameAnswer(value(first, dimension), value(second, dimension))).length
      return matches === 4 ? 'perfect' : matches >= 2 ? 'good' : 'chaos'
    }
    case 'LIFE-01': {
      const effort = pair('effort')
      if (effort.includes('zero')) return 'low_energy'
      const craving = pair('craving')
      return sameAnswer(...craving) || craving.includes('novel') ? 'clear' : 'split'
    }
    case 'LIFE-02': {
      const need = pair('need')
      const structure = pair('structure')
      const mustHave = pair('must_have')
      const restSide = need.map((item, index) => item === 'rest' || mustHave[index] === 'alone_time')
      const adventureSide = need.map((item, index) => ['outdoors', 'fun', 'social'].includes(item) || mustHave[index] === 'movement')
      if ((restSide[0] && adventureSide[1]) || (restSide[1] && adventureSide[0])) return 'rest_adventure'
      if (sameAnswer(...need) && ordinalGap(...structure, ['none', 'light', 'medium', 'full']) <= 1) return 'aligned'
      return 'productive_cozy'
    }
    case 'LIFE-03': {
      const windows = pair('energy_window')
      const formats = pair('format')
      const durations = pair('duration')
      const timeOverlap = sameAnswer(...windows) || windows.includes('variable')
      const formatGroups = { voice: 'live', video: 'live', watch: 'shared', cowork: 'shared', voice_notes: 'async' }
      const formatCompatible = sameAnswer(...formats) || formatGroups[formats[0]] === formatGroups[formats[1]]
      if (!timeOverlap || (formats.includes('voice_notes') && !sameAnswer(...windows))) return 'format_bridge'
      return ordinalGap(...durations, ['10', '20_30', '60', 'open']) >= 2 || !formatCompatible ? 'energy_gap' : 'overlap'
    }
    case 'LIFE-04': {
      const paceGap = ordinalGap(...pair('pace'), ['open', 'light', 'balanced', 'packed'])
      if (paceGap >= 2) return 'pace_gap'
      return sameAnswer(...pair('priority')) ? 'aligned' : 'priority_gap'
    }
    case 'LIFE-05': {
      const attention = pair('attention')
      const attentionGap = ordinalGap(...attention, ['background', 'light', 'full'])
      if (attention.includes('background') || attentionGap >= 2) return 'attention_gap'
      if (relativeHistoryAgrees(...pair('fairness'))) return 'picker'
      return sameAnswer(...pair('mood')) && attentionGap <= 1 ? 'clear' : 'picker'
    }
    case 'LIFE-06': {
      const capacity = pair('capacity')
      if (capacity.every((item) => ['none', 'low'].includes(item))
        || (capacity.includes('none') && !capacity.includes('high'))) return 'low_capacity'
      const history = pair('history')
      if (relativeHistoryAgrees(...history)) {
        const otherCapacity = history[0] === 'self' ? capacity[1] : capacity[0]
        if (['enough', 'high'].includes(otherCapacity)) return 'clear_owner'
      }
      return 'split_roles'
    }
    case 'MIDDLE-01': {
      const windows = pair('comfort_window')
      const commitments = pair('commitment')
      const signals = pair('reassurance_signal')
      const order = ['hours', 'end_of_day', 'full_day']
      const windowGap = windows.includes('plan_dependent')
        ? (sameAnswer(...windows) ? 0 : Number.POSITIVE_INFINITY)
        : ordinalGap(...windows, order)
      const later = windows.includes('plan_dependent') ? 'plan_dependent'
        : order[Math.max(order.indexOf(windows[0]), order.indexOf(windows[1]))]
      const canMeet = (commitment, window) => {
        if (['signal', 'context'].includes(commitment)) return true
        if (commitment === 'same_day') return ['end_of_day', 'full_day'].includes(window)
        return commitment === 'plans_only' && window === 'plan_dependent'
      }
      if (windowGap <= 1 && commitments.every((item) => canMeet(item, later))) return 'aligned'
      const signalFits = (signal, commitment) => signal === 'none'
        || commitment === 'signal'
        || (signal === 'status' && commitment === 'context')
        || (signal === 'return_time' && ['same_day', 'context'].includes(commitment))
        || (signal === 'reaction' && commitment !== 'plans_only')
      return signals.some((signal) => commitments.every((commitment) => signalFits(signal, commitment))) ? 'bridge' : 'no_overlap'
    }
    case 'MIDDLE-02': {
      const paces = pair('conflict_pace')
      const pauses = pair('pause_length')
      const returnSignals = pair('return_signal')
      const risks = pair('pause_risk').flatMap((item) => Array.isArray(item) ? item : [])
      const bothPause = paces.every((item) => ['short_pause', 'overnight'].includes(item))
      if (bothPause && risks.some((item) => ['sudden_silence', 'cold_tone', 'buried'].includes(item))) return 'too_hot'
      if (sameAnswer(...paces) && sameAnswer(...returnSignals)
        && ordinalGap(...pauses, ['20m', 'hours', 'overnight', 'variable']) <= 1) return 'aligned'
      return 'pace_gap'
    }
    case 'MIDDLE-03': {
      const needs = pair('first_need')
      const avoid = pair('avoid')
      const fixing = new Set(['advice', 'practical_help'])
      const hearing = new Set(['listening', 'validation'])
      const fixerListener = ((fixing.has(needs[0]) && hearing.has(needs[1]))
        || (fixing.has(needs[1]) && hearing.has(needs[0])))
        && avoid.some((item) => includesAnswer(item, 'advice'))
      if (fixerListener) return 'fixer_listener'
      const phrases = pair('phrase')
      const phraseFits = (phrase, need) => phrase === need
        || (phrase === 'clarify' && ['listening', 'validation', 'advice'].includes(need))
      const reciprocalPhrases = phraseFits(phrases[0], needs[1]) && phraseFits(phrases[1], needs[0])
      if (sameAnswer(...needs) || reciprocalPhrases) return 'aligned'
      return 'different_days'
    }
    case 'MIDDLE-04': {
      const meanings = pair('space_meaning')
      const durationGap = ordinalGap(...pair('duration'), ['hours', 'evening', 'day', 'days_with_checkin'])
      const reassurance = pair('reassurance')
      const reassuranceCompatible = sameAnswer(...reassurance) || reassurance.includes('none')
        || reassurance.every((item) => ['relationship_ok', 'affection', 'return_time'].includes(item))
      if ((!sameAnswer(...meanings) && durationGap >= 2) || !reassuranceCompatible) return 'unclear'
      if (sameAnswer(...meanings) && durationGap <= 1) return 'aligned'
      return 'bridge'
    }
    case 'MIDDLE-05': {
      const gap = ordinalGap(...pair('capacity'), ['10m', '30m', '60m', 'flexible'])
      if (gap >= 2) return 'capacity_gap'
      return sameAnswer(...pair('quality_type')) || sameAnswer(...pair('ritual')) ? 'aligned' : 'type_gap'
    }
    case 'MIDDLE-06': {
      const batteries = pair('battery')
      const contacts = pair('contact_level')
      const compromises = pair('compromise')
      const batteryGap = ordinalGap(...batteries, ['empty', 'low', 'medium', 'high'])
      const contactGap = ordinalGap(...contacts, ['alone', 'quiet_company', 'one_on_one', 'small_group', 'large_social'])
      if (batteryGap <= 1 && contactGap <= 1) return 'aligned'
      if (!batteries.includes('empty') && ['low', 'medium'].includes(batteries[0])
        && ['low', 'medium'].includes(batteries[1])
        && compromises.every((item) => ['brief', 'timed'].includes(item))) return 'short_plan'
      return 'bridge'
    }
    case 'LOVE-F01': {
      const hits = crossMatches('give_style', 'receive_style')
      return hits === 2 ? 'double_match' : hits === 1 ? 'one_match' : 'reroute'
    }
    case 'LOVE-F02': {
      const hits = crossMatches('sent_signal', 'wanted_signal', compatibleSentSignal)
      return hits === 2 ? 'same_frequency' : hits === 1 ? 'quiet_match' : 'hidden_signal'
    }
    case 'LOVE-F03': {
      const energy = pair('date_energy')
      const budget = pair('budget')
      const planning = pair('planning_capacity')
      if (energy.includes('home') || budget.includes('free')) return 'home_date'
      const upperEnergy = energy.every((item) => ['full_date', 'surprise'].includes(item))
      const upperBudget = budget.every((item) => ['medium', 'high'].includes(item))
      return upperEnergy && upperBudget && planning.some((item) => ['simple_plan', 'full_plan'].includes(item))
        ? 'proper_date' : 'tiny_adventure'
    }
    case 'CLOSE-F01': {
      const needs = pair('first_need')
      const replyLoad = pair('reply_load')
      if (needs.includes('space') || replyLoad.includes('no_reply')) return 'soft_mode'
      return sameAnswer(...needs) ? 'shared_manual' : 'two_manuals'
    }
    case 'CLOSE-F02': {
      const matches = ['current_lift', 'energy_drain', 'followup']
        .filter((dimension) => sameAnswer(value(first, dimension), value(second, dimension))).length
      return matches === 3 ? 'radar_locked' : matches > 0 ? 'signal_found' : 'fresh_lore'
    }
    case 'CLOSE-F03': {
      const available = pair('available_signal')
      const wanted = pair('wanted_signal')
      if (available.includes('none') || wanted.includes('warm_space')) return 'space_with_warmth'
      const hits = crossMatches('available_signal', 'wanted_signal')
      return hits === 2 ? 'quiet_sync' : hits === 1 ? 'one_easy_bridge' : 'space_with_warmth'
    }
    case 'LIFE-F01': {
      const battery = pair('battery')
      const channel = pair('channel')
      if (channel.includes('solo') || battery.includes('zero')) return 'solo_reset'
      if (battery.includes('low') || channel.includes('text')) return 'tiny_touchpoint'
      return 'shared_reset'
    }
    case 'LIFE-F02': {
      const duration = pair('duration')
      const habitat = pair('habitat')
      const compatibleHabitat = sameAnswer(...habitat) || habitat.includes('flexible')
        || habitat.every((item) => ['nearby', 'outdoors'].includes(item))
      if (!compatibleHabitat || habitat.includes('remote') || duration.includes('10')) return 'remote_microdate'
      if (duration.some((item) => ['30', '60'].includes(item))
        && habitat.some((item) => ['nearby', 'outdoors'].includes(item))) return 'quick_outing'
      return 'slow_evening'
    }
    case 'LIFE-F03': {
      const cleanSwap = includesAnswer(value(first, 'tolerated_chores'), value(second, 'hated_chore'))
        || includesAnswer(value(second, 'tolerated_chores'), value(first, 'hated_chore'))
      if (cleanSwap) return 'clean_swap'
      return relativeHistoryAgrees(...pair('recent_load')) ? 'first_pick' : 'rotation'
    }
    case 'MIDDLE-F01': {
      const frequencyMatches = sameAnswer(...pair('frequency'))
      const channelMatches = sameAnswer(...pair('channel'))
      const busySignals = pair('busy_signal')
      const busyCompatible = sameAnswer(...busySignals) || busySignals.includes('none')
      if (frequencyMatches && channelMatches && busyCompatible) return 'same_settings'
      const lowEffortChannel = channelMatches && ['reaction', 'text', 'voice'].includes(pair('channel')[0])
      return lowEffortChannel || sameAnswer(...busySignals) ? 'light_bridge' : 'custom_settings'
    }
    case 'MIDDLE-F02': {
      const repairs = pair('repair')
      const stings = pair('sting_trigger')
      const repairAddresses = (repair, sting) => ({
        timing: ['context', 'replan'], tone: ['warmth', 'validate'], no_replan: ['replan', 'substitute'],
        priority: ['warmth', 'validate'], disappointment: ['validate', 'substitute'],
      }[sting] || []).includes(repair)
      if (sameAnswer(...repairs) && stings.every((sting) => repairAddresses(repairs[0], sting))) return 'shared_protocol'
      const explanatory = new Set(['context', 'warmth', 'validate'])
      const nextStep = new Set(['replan', 'substitute'])
      return repairs.some((item) => explanatory.has(item)) && repairs.some((item) => nextStep.has(item))
        ? 'two_step' : 'minimum_viable_repair'
    }
    case 'MIDDLE-F03': {
      if (sameAnswer(...pair('boundary'))) return 'exact_treaty'
      const triggers = pair('trigger')
      if (triggers.includes('none') && triggers.every((item) => ['none', 'ignored'].includes(item))) return 'awareness_only'
      if (triggers.includes('none') && pair('boundary').includes('responsive')) return 'awareness_only'
      return 'tiny_boundary'
    }
    default:
      return null
  }
}
