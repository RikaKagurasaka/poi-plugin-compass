'use strict'

const SHIP_CATEGORIES = {
  DE: new Set([1]),
  DD: new Set([2]),
  CL: new Set([3]),
  CLT: new Set([4]),
  CT: new Set([21]),
  CL_ALL: new Set([3, 4, 21]),
  CA: new Set([5]),
  CAV: new Set([6]),
  CVL: new Set([7]),
  BB: new Set([8, 9]),
  BBV: new Set([10]),
  BB_ALL: new Set([8, 9, 10]),
  CV: new Set([11, 12, 18]),
  CV_ALL: new Set([7, 11, 12, 18]),
  SS: new Set([13, 14]),
  AO: new Set([15]),
  AV: new Set([16]),
  LHA: new Set([17]),
  AR: new Set([19]),
  AS: new Set([20]),
  CV_MAIN: new Set([11, 12, 18]),
}

const CATEGORY_LABELS = {
  DE: '海防',
  DD: '驱逐',
  CL: '轻巡',
  CLT: '雷巡',
  CT: '练巡',
  CL_ALL: 'CL系',
  CA: '重巡',
  CAV: '航巡',
  CVL: '轻空母',
  BB: '战舰（BB/FBB）',
  BBV: '航战',
  BB_ALL: 'BB系',
  CV: '空母（CV/CVB）',
  CV_ALL: 'CV系',
  SS: '潜水系',
  AO: '补给',
  AV: '水母',
  LHA: '扬陆',
  AR: '工作舰',
  AS: '潜母',
  CV_MAIN: '正规/装甲空母',
}

const EQUIPMENT_CATEGORY_LABELS = {
  drum: '运输桶',
  radar: '电探',
  daihatsu: '大发系',
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function integer(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeMapId(value) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)[-](\d+)$/)
    if (match) return `${number(match[1])}-${number(match[2])}`
    const compact = value.trim().match(/^(\d+)(\d)$/)
    if (compact) return `${number(compact[1])}-${number(compact[2])}`
  }
  const parsed = integer(value)
  if (parsed != null && parsed >= 11) return `${Math.floor(parsed / 10)}-${parsed % 10}`
  return null
}

function compare(left, operator, right) {
  switch (operator) {
    case '==':
      return left === right
    case '!=':
      return left !== right
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '<':
      return left < right
    case '<=':
      return left <= right
    default:
      return false
  }
}

function statusResult(status, predicate, label) {
  return {
    status,
    predicate,
    label: label || predicate?.label || predicateLabel(predicate),
  }
}

function categoryLabel(category) {
  const value = String(category || '舰队')
  if (value.endsWith('_ALL')) return `${value.slice(0, -4)}系`
  return CATEGORY_LABELS[value] || value
}

function predicateLabel(predicate) {
  if (!predicate || typeof predicate !== 'object') return '未知条件'
  if (predicate.label) return predicate.label
  if (predicate.kind === 'always') return '始终适用'
  if (predicate.kind === 'count') {
    const category = Array.isArray(predicate.category)
      ? predicate.category.map(categoryLabel).join('+')
      : categoryLabel(predicate.category)
    return `${category} ${predicate.op || '=='} ${predicate.value}`
  }
  if (predicate.kind === 'equipmentShips') {
    return `${EQUIPMENT_CATEGORY_LABELS[predicate.equipment] || predicate.equipment}舰数 ${predicate.op || '=='} ${predicate.value}`
  }
  if (predicate.kind === 'los') return `索敌 ${predicate.op || '=='} ${predicate.value}`
  if (predicate.kind === 'losRange') return `索敌 ${predicate.min}～${predicate.max}`
  if (predicate.kind === 'speed') {
    if (predicate.mode === 'hasLow') return '含低速舰'
    if (predicate.mode === 'highPlus') return '高速+舰队'
    if (predicate.mode === 'fastest') return '最速舰队'
    return '全高速'
  }
  if (predicate.kind === 'onlyCategories') {
    return `仅含 ${(predicate.categories || []).map(categoryLabel).join('、')}`
  }
  if (predicate.kind === 'visited') return `已经过 ${predicate.node} 点`
  if (predicate.kind === 'containsMaster') return `包含指定舰娘 (${(predicate.masterIds || []).join('/')})`
  if (predicate.kind === 'containsName') return `包含 ${(predicate.names || []).join('/')}`
  if (predicate.kind === 'nameCount') return `${(predicate.names || []).join('/')} ${predicate.op || '=='} ${predicate.value}`
  if (predicate.kind === 'flag') return `状态：${predicate.name || predicate.flag}`
  if (predicate.kind === 'phase') return `阶段：${predicate.phase || predicate.value}`
  if (predicate.kind === 'equipmentShipsTotal') {
    return `${(predicate.equipment || []).map((equipment) => EQUIPMENT_CATEGORY_LABELS[equipment] || equipment).join('+')} 舰数 ${predicate.op || '=='} ${predicate.value}`
  }
  if (predicate.kind === 'all') return (predicate.predicates || []).map(predicateLabel).join(' 且 ')
  if (predicate.kind === 'any') return (predicate.predicates || []).map(predicateLabel).join(' 或 ')
  return predicate.kind || '未知条件'
}

function categoryCount(context, category) {
  const categories = Array.isArray(category) ? category : [category]
  if (categories.includes('__all__')) return number(context.shipCount)
  return categories.reduce((total, value) => total + number(context.counts?.[value]), 0)
}

function evaluatePredicate(predicate, context = {}) {
  if (!predicate || typeof predicate !== 'object') return statusResult('unknown', predicate, '未知条件')

  switch (predicate.kind) {
    case 'always':
      return statusResult('true', predicate)
    case 'count': {
      const actual = predicate.field === 'ships'
        ? number(context.shipCount)
        : categoryCount(context, predicate.category)
      if (context.complete === false) return statusResult('unknown', predicate)
      return statusResult(compare(actual, predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'equipmentShips': {
      const actual = number(context.equipmentShips?.[predicate.equipment])
      if (context.complete === false) return statusResult('unknown', predicate)
      return statusResult(compare(actual, predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'speed': {
      if (context.complete === false) return statusResult('unknown', predicate)
      if (predicate.mode === 'highPlus' || predicate.mode === 'fastest') {
        const enhancedSpeedClass = context.enhancedSpeedClass || 'unknown'
        if (enhancedSpeedClass === 'unknown') return statusResult('unknown', predicate)
        const matches = predicate.mode === 'fastest'
          ? enhancedSpeedClass === 'fastest'
          : ['highPlus', 'fastest'].includes(enhancedSpeedClass)
        return statusResult(matches ? 'true' : 'false', predicate)
      }
      if (!context.speedClass || context.speedClass === 'unknown') return statusResult('unknown', predicate)
      const matches = predicate.mode === 'hasLow'
        ? context.speedClass === 'low'
        : context.speedClass === 'high'
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'los': {
      if (context.losScore == null || !Number.isFinite(Number(context.losScore))) return statusResult('unknown', predicate)
      return statusResult(compare(Number(context.losScore), predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'losRange': {
      if (context.losScore == null || !Number.isFinite(Number(context.losScore))) return statusResult('unknown', predicate)
      const score = Number(context.losScore)
      const min = number(predicate.min)
      const max = number(predicate.max)
      return statusResult(score >= min && score < max ? 'true' : 'false', predicate)
    }
    case 'flagshipCategory': {
      if (!context.flagship || context.flagship.categoryIds == null) return statusResult('unknown', predicate)
      const matches = (Array.isArray(predicate.categories) ? predicate.categories : [predicate.category])
        .some((category) => context.flagship.categoryIds.includes(category))
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'onlyCategories': {
      const categories = Array.isArray(predicate.categories) ? predicate.categories : []
      if (context.complete === false || !context.ships?.length || !categories.length) {
        return statusResult('unknown', predicate)
      }
      const matches = context.ships.every((ship) =>
        categories.some((category) => ship.categoryIds?.includes(category)),
      )
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'visited': {
      if (!Array.isArray(context.passedNodes)) return statusResult('unknown', predicate)
      return statusResult(context.passedNodes.includes(predicate.node) ? 'true' : 'false', predicate)
    }
    case 'containsMaster': {
      if (context.complete === false || !Array.isArray(context.ships)) return statusResult('unknown', predicate)
      const masterIds = (predicate.masterIds || []).map((masterId) => number(masterId))
      const matches = context.ships.some((ship) => masterIds.includes(number(ship.masterId)))
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'containsName': {
      if (context.complete === false || !Array.isArray(context.ships)) return statusResult('unknown', predicate)
      const names = (predicate.names || []).map((name) => String(name))
      const matches = context.ships.some((ship) => names.some((name) => String(ship.name || '').includes(name)))
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'nameCount': {
      if (context.complete === false || !Array.isArray(context.ships)) return statusResult('unknown', predicate)
      const names = (predicate.names || []).map((name) => String(name))
      const actual = context.ships.filter((ship) => names.some((name) => String(ship.name || '').includes(name))).length
      return statusResult(compare(actual, predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'flag': {
      if (!context.flags || typeof context.flags[predicate.flag] !== 'boolean') return statusResult('unknown', predicate)
      return statusResult(context.flags[predicate.flag] === Boolean(predicate.value) ? 'true' : 'false', predicate)
    }
    case 'phase': {
      if (typeof context.phase !== 'string' || !context.phase) return statusResult('unknown', predicate)
      return statusResult(context.phase === String(predicate.phase || predicate.value) ? 'true' : 'false', predicate)
    }
    case 'equipmentShipsTotal': {
      if (context.complete === false) return statusResult('unknown', predicate)
      const actual = (predicate.equipment || []).reduce((total, equipment) => total + number(context.equipmentShips?.[equipment]), 0)
      return statusResult(compare(actual, predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'all': {
      const results = (predicate.predicates || []).map((child) => evaluatePredicate(child, context))
      if (results.some((result) => result.status === 'false')) return statusResult('false', predicate)
      if (results.some((result) => result.status === 'unknown')) return statusResult('unknown', predicate)
      return statusResult('true', predicate)
    }
    case 'any': {
      const results = (predicate.predicates || []).map((child) => evaluatePredicate(child, context))
      if (results.some((result) => result.status === 'true')) return statusResult('true', predicate)
      if (results.some((result) => result.status === 'unknown')) return statusResult('unknown', predicate)
      return statusResult('false', predicate)
    }
    case 'not': {
      const result = evaluatePredicate(predicate.predicate, context)
      if (result.status === 'unknown') return statusResult('unknown', predicate)
      return statusResult(result.status === 'true' ? 'false' : 'true', predicate)
    }
    default:
      return statusResult('unknown', predicate)
  }
}

function rulesForNode(mapDefinition, node) {
  return (mapDefinition?.rules || [])
    .filter((rule) => rule.node === node)
    .sort((left, right) => number(left.priority) - number(right.priority))
}

function containsPhasePredicate(predicate) {
  if (!predicate || typeof predicate !== 'object') return false
  if (predicate.kind === 'phase') return true
  if (Array.isArray(predicate.predicates) && predicate.predicates.some(containsPhasePredicate)) return true
  return containsPhasePredicate(predicate.predicate)
}

function hasPhaseRules(mapDefinition, node) {
  return rulesForNode(mapDefinition, node).some((rule) => containsPhasePredicate(rule.predicate))
}

function selectRouteRule(mapDefinition, node, context) {
  const rules = rulesForNode(mapDefinition, node)
  for (const rule of rules) {
    const predicate = evaluatePredicate(rule.predicate, context)
    if (predicate.status === 'true') {
      const status = rule.terminal === true
        ? 'terminal'
        : rule.outcomes?.length ? 'matched' : 'unknown'
      return { status, rule, predicate }
    }
    if (predicate.status === 'unknown') return { status: 'unknown', rule, predicate }
  }
  return { status: rules.length ? 'unknown' : 'terminal', rule: null, predicate: null }
}

function normalizeOutcomes(outcomes, rule = null, options = {}) {
  const normalized = (Array.isArray(outcomes) ? outcomes : [])
    .filter((outcome) => outcome && typeof outcome.to === 'string')
    .map((outcome) => ({
      to: outcome.to,
      probability: outcome.probability == null
        ? null
        : Number.isFinite(Number(outcome.probability)) ? Number(outcome.probability) : null,
    }))

  const hasMissingProbability = normalized.some((outcome) => outcome.probability == null)
  const equalize = options.equalizeUnknown !== false && (hasMissingProbability || rule?.confidence === 'unknown')
  const estimated = equalize || rule?.confidence === 'approximate' && normalized.length > 1
  return normalized.map((outcome) => {
    const normalizedOutcome = {
      to: outcome.to,
      probability: equalize && normalized.length ? 1 / normalized.length : outcome.probability,
    }
    if (estimated) normalizedOutcome.estimated = true
    return normalizedOutcome
  })
}

function routeDecision(mapDefinition, node, context, overrides = {}) {
  const selected = selectRouteRule(mapDefinition, node, context)
  const configuredManualOutcomes = mapDefinition?.manualOutcomes?.[node]
  const manual = selected.rule?.manual === true
    || Array.isArray(mapDefinition?.manualNodes) && mapDefinition.manualNodes.includes(node)
  const manualOutcomes = Array.isArray(configuredManualOutcomes)
    ? normalizeOutcomes(configuredManualOutcomes, { confidence: 'unknown' }, { equalizeUnknown: false })
    : null
  const autoOutcomes = selected.status === 'matched'
    ? normalizeOutcomes(selected.rule?.outcomes, selected.rule)
    : []
  const phaseRuleMatched = manual && hasPhaseRules(mapDefinition, node) && selected.status === 'matched'
  const baseOutcomes = phaseRuleMatched
    ? autoOutcomes
    : manualOutcomes || autoOutcomes
  const override = overrides[node]
  const selectableOutcomes = manualOutcomes || baseOutcomes
  const validOverride = manual && selectableOutcomes.some((outcome) => outcome.to === override)
  const outcomes = validOverride
    ? [{ to: override, probability: 1 }]
    : baseOutcomes
  return {
    node,
    status: selected.status,
    rule: selected.rule,
    predicate: selected.predicate,
    baseOutcomes,
    manualOutcomes,
    outcomes,
    manual,
    phaseRuleMatched,
    manualChoiceRequired: manual && !phaseRuleMatched && !validOverride,
    manualOverride: validOverride ? override : null,
  }
}

function edgeKey(from, to) {
  return `${from}->${to}`
}

function propagateProbability(start, decisions) {
  const reach = {}
  const edgeMass = {}
  const unknownNodes = new Set()
  const unknownEdges = new Set()
  const estimatedNodes = new Set()
  const estimatedEdges = new Set()

  function walk(node, mass, path, estimatedPath = false) {
    if (!Number.isFinite(mass) || mass <= 0) return
    reach[node] = number(reach[node]) + mass
    if (estimatedPath) estimatedNodes.add(node)
    if (path.has(node)) {
      unknownNodes.add(node)
      return
    }
    const decision = decisions[node]
    if (!decision || decision.status === 'unknown' || decision.status === 'terminal' && !decision.outcomes.length) {
      if (decision?.status === 'unknown') unknownNodes.add(node)
      return
    }
    const nextPath = new Set(path)
    nextPath.add(node)
    decision.outcomes.forEach((outcome) => {
      const key = edgeKey(node, outcome.to)
      if (outcome.probability == null) {
        unknownEdges.add(key)
        return
      }
      const edgeEstimated = estimatedPath || outcome.estimated === true
      if (edgeEstimated) estimatedEdges.add(key)
      edgeMass[key] = number(edgeMass[key]) + mass * outcome.probability
      walk(outcome.to, mass * outcome.probability, nextPath, edgeEstimated)
    })
  }

  walk(start, 1, new Set())
  return {
    reach,
    edgeMass,
    unknownNodes: Array.from(unknownNodes),
    unknownEdges: Array.from(unknownEdges),
    estimatedNodes: Array.from(estimatedNodes),
    estimatedEdges: Array.from(estimatedEdges),
  }
}

function evaluateMap(mapDefinition, context = {}, overrides = {}) {
  const nodes = new Set([mapDefinition?.start || '1'])
  ;(mapDefinition?.rules || []).forEach((rule) => nodes.add(rule.node))
  const decisions = {}
  nodes.forEach((node) => {
    decisions[node] = routeDecision(mapDefinition, node, context, overrides)
    decisions[node].outcomes.forEach((outcome) => nodes.add(outcome.to))
  })
  // A rule outcome can introduce another node; resolve its decision once as well.
  Array.from(nodes).forEach((node) => {
    if (!decisions[node]) decisions[node] = routeDecision(mapDefinition, node, context, overrides)
  })
  const probability = propagateProbability(mapDefinition?.start || '1', decisions)
  return { decisions, probability }
}

function mapNodeLabel(mapId, cell, maps) {
  const normalized = normalizeMapId(mapId)
  const route = maps?.[normalized]?.route
  const entry = route?.[number(cell)]
  return Array.isArray(entry) && typeof entry[1] === 'string' ? entry[1] : ''
}

function shipCategoryIds(typeId) {
  return Object.entries(SHIP_CATEGORIES)
    .filter(([, ids]) => ids.has(number(typeId)))
    .map(([category]) => category)
}

function equipmentKind(master) {
  const name = String(master?.api_name || '')
  if (name.includes('ドラム缶') || name.includes('运输桶')) return 'drum'
  if ([12, 13].includes(number(master?.api_type?.[2])) || name.includes('電探') || name.includes('电探')) return 'radar'
  const excludedDaihatsu = ['特大発動艇+戦車第11連隊', 'M4A1 DD', '装甲艇(AB艇)', '特大動艇+战车第11连队']
  if (!excludedDaihatsu.some((item) => name.includes(item)) && (name.includes('大発') || name.includes('大发') || name.includes('内火艇'))) return 'daihatsu'
  return null
}

function getFleet(state, deckId = 1) {
  const fleets = state?.info?.fleets
  if (Array.isArray(fleets)) return fleets[deckId - 1] || null
  return fleets?.[deckId - 1] || fleets?.[deckId] || null
}

function fleetContextFromState(state, deckId = 1, options = {}) {
  const fleet = getFleet(state, deckId)
  const instanceShips = state?.info?.ships || {}
  const masterShips = state?.const?.$ships || {}
  const instanceEquips = state?.info?.equips || {}
  const masterEquips = state?.const?.$equips || {}
  const shipIds = Array.isArray(fleet?.api_ship) ? fleet.api_ship : []
  const activeShipIds = shipIds.filter((id) => number(id) > 0)
  const dataIssues = []
  if (!fleet) dataIssues.push('舰队')
  if (!Array.isArray(fleet?.api_ship)) dataIssues.push('舰队槽位')
  if (!activeShipIds.length) dataIssues.push('舰娘')
  const ships = shipIds
    .filter((id) => number(id) > 0)
    .map((instanceId, index) => {
      const instance = instanceShips[instanceId]
      const master = masterShips[instance?.api_ship_id]
      if (!instance) {
        dataIssues.push(`舰娘实例 #${instanceId}`)
        return null
      }
      if (!master) {
        dataIssues.push(`舰娘 master #${instance.api_ship_id}`)
        return null
      }
      if (!Number.isFinite(Number(master.api_stype))) dataIssues.push(`舰种 #${instance.api_ship_id}`)
      if (!Array.isArray(instance.api_slot)) dataIssues.push(`装备槽位 #${instanceId}`)
      const equipmentIds = Array.isArray(instance.api_slot) ? instance.api_slot : []
      const equipments = []
      for (const id of equipmentIds.filter((value) => number(value) > 0)) {
        const equipment = instanceEquips[id]
        const masterEquipment = masterEquips[equipment?.api_slotitem_id]
        if (!equipment || !masterEquipment) {
          dataIssues.push(`装备 #${id}`)
          continue
        }
        equipments.push(masterEquipment)
      }
      if (!Number.isFinite(Number(instance.api_soku))) dataIssues.push(`速力 #${instanceId}`)
      const categoryIds = shipCategoryIds(master.api_stype)
      return {
        instanceId: number(instanceId),
        masterId: number(instance.api_ship_id),
        name: master.api_name || `#${instance.api_ship_id}`,
        categoryIds,
        typeId: number(master.api_stype),
        speed: Number.isFinite(Number(instance.api_soku)) ? Number(instance.api_soku) : null,
        baseLos: Number.isFinite(Number(master.api_sakuteki)) ? Number(master.api_sakuteki) : null,
        equipments,
        equipmentKinds: equipments.map(equipmentKind).filter(Boolean),
        flagship: index === 0,
      }
    })
    .filter(Boolean)

  const fleetComplete = dataIssues.length === 0 && ships.length === activeShipIds.length
  const counts = {}
  Object.keys(SHIP_CATEGORIES).forEach((category) => {
    counts[category] = ships.filter((ship) => ship.categoryIds.includes(category)).length
  })
  const speedKnown = fleetComplete && ships.length > 0 && ships.every((ship) => Number.isFinite(ship.speed))
  const fleetSpeed = speedKnown ? Math.min(...ships.map((ship) => ship.speed)) : null
  const speedClass = fleetSpeed == null ? 'unknown' : fleetSpeed < 10 ? 'low' : 'high'
  const enhancedSpeedClass = fleetSpeed == null
    ? 'unknown'
    : fleetSpeed >= 20 ? 'fastest'
      : fleetSpeed >= 15 ? 'highPlus'
        : 'high'
  const equipmentShips = {
    drum: ships.filter((ship) => ship.equipmentKinds.includes('drum')).length,
    radar: ships.filter((ship) => ship.equipmentKinds.includes('radar')).length,
    daihatsu: ships.filter((ship) => ship.equipmentKinds.includes('daihatsu')).length,
  }
  const losCoefficients = [1, 2, 3, 4]
  const poiLosResults = losCoefficients.map((coefficient) => {
    if (typeof options.losCalculator !== 'function') return null
    try {
      return options.losCalculator(state, deckId, coefficient)
    } catch (_) {
      return null
    }
  })
  const poiLosScores = poiLosResults.map((result) => {
    const score = result && typeof result === 'object' ? result.total : result
    return score != null && Number.isFinite(Number(score)) ? Number(score) : null
  })
  const requestedCoefficient = Number(options.losCoefficient)
  const selectedCoefficient = losCoefficients.includes(requestedCoefficient) ? requestedCoefficient : 1
  const selectedIndex = selectedCoefficient - 1
  const poiLos = poiLosResults[selectedIndex]
  const poiLosScore = poiLosScores[selectedIndex]
  const hasPoiLos = fleetComplete && poiLosScores.every((score) => score != null)
  if (!hasPoiLos) dataIssues.push('poi 33式索敌')
  const dataAvailable = fleetComplete && hasPoiLos
  return {
    complete: dataAvailable,
    fleetComplete,
    dataAvailable,
    dataIssues: Array.from(new Set(dataIssues)),
    shipCount: ships.length,
    ships,
    flagship: ships[0] || null,
    counts,
    equipmentShips,
    fleetSpeed,
    speedClass,
    enhancedSpeedClass,
    phase: typeof options.phase === 'string' ? options.phase : null,
    passedNodes: Array.isArray(options.passedNodes) ? options.passedNodes : null,
    flags: options.flags || null,
    losScore: hasPoiLos ? poiLosScore : null,
    losScores: hasPoiLos ? poiLosScores : [null, null, null, null],
    losCoefficient: selectedCoefficient,
    admiralCoefficient: options.admiralCoefficient ?? null,
    losApproximate: false,
    losSource: hasPoiLos ? 'poi-33' : 'unavailable',
    losDetails: hasPoiLos && typeof poiLos === 'object' ? poiLos : null,
  }
}

function formatPercent(value, estimated = false) {
  if (!Number.isFinite(Number(value))) return '未知'
  const suffix = estimated ? '?' : ''
  return `${(Number(value) * 100).toFixed(1).replace(/\.0$/, '')}%${suffix}`
}

module.exports = {
  CATEGORY_LABELS,
  SHIP_CATEGORIES,
  categoryCount,
  edgeKey,
  evaluateMap,
  evaluatePredicate,
  fleetContextFromState,
  formatPercent,
  mapNodeLabel,
  normalizeMapId,
  normalizeOutcomes,
  predicateLabel,
  propagateProbability,
  routeDecision,
  selectRouteRule,
  shipCategoryIds,
}
