'use strict'

const { routeDecision } = require('./logic')
const { loadEnemies } = require('./enemies')
const types = require('./data/kcnav-node-types-by-map.json')
const catalog = require('./data/kcnav-node-types.json')

function losBounds(predicate) {
  if (!predicate) return []
  if (predicate.kind === 'los') return [predicate.value]
  if (predicate.kind === 'losRange') return [predicate.min, predicate.max]
  return [...(predicate.predicates || []).flatMap(losBounds), ...losBounds(predicate.predicate)].filter(Number.isFinite)
}

function mapOverview(mapId, definition, context, overrides = {}, loader = loadEnemies) {
  const visited = new Set(), missing = new Set(), los = []
  let partial = false, steps = 0, superiority = null, supremacy = null
  function walk(node, path) {
    if (++steps > 10000 || path.includes(node)) { partial = true; return }
    visited.add(node)
    const current = { ...context, passedNodes: path }
    const decide = score => routeDecision(definition, node, { ...current, losScore: score }, overrides)
    const signature = decision => JSON.stringify([decision.status, decision.manualChoiceRequired, decision.outcomes])
    // Only count LOS boundaries that actually change this fleet's decision.
    // Earlier fixed rules and inapplicable fleet/phase branches must not count.
    const bounds = new Set((definition.rules || []).filter(rule => rule.node === node).flatMap(rule => losBounds(rule.predicate)))
    for (const value of bounds) {
      const decisions = [decide(value - 0.000001), decide(value), decide(value + 0.000001)]
      if (new Set(decisions.map(signature)).size > 1) los.push({ node, value })
    }
    const decision = routeDecision(definition, node, current, overrides)
    if (decision.manualChoiceRequired || decision.status === 'unknown') { partial = true; return }
    for (const outcome of decision.outcomes) if (outcome.probability > 0) walk(outcome.to, [...path, node])
  }
  walk(definition.start, [])
  for (const node of visited) {
    if (!catalog[types[mapId]?.[node]]?.hasEnemies) continue
    const data = loader(mapId, node)
    const rows = data.status === 'ready' ? data.rows.filter(row => row.count > 0) : []
    if (!rows.length) missing.add(node)
    for (const row of rows) {
      if (!row.thresholds || row.uncertain) missing.add(node)
      if (row.thresholds) {
        superiority = Math.max(superiority ?? 0, row.thresholds.superiority)
        supremacy = Math.max(supremacy ?? 0, row.thresholds.supremacy)
      }
    }
  }
  const maxLos = los.length ? Math.max(...los.map(item => item.value)) : null
  return { nodes: [...visited], partial, missing: [...missing], superiority, supremacy, maxLos,
    losNodes: [...new Set(los.filter(item => item.value === maxLos).map(item => item.node))] }
}

module.exports = { mapOverview }
