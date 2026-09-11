'use strict'

const path = require('path')
const React = require('react')
const { store } = require('views/create-store')
const mapCatalog = require('./data/maps.json')
const {
  CATEGORY_LABELS,
  evaluateMap,
  evaluatePredicate,
  fleetContextFromState,
  formatPercent,
  mapNodeLabel,
  normalizeMapId,
  predicateLabel,
} = require('./logic')

const h = React.createElement
const listeners = new Set()
const pluginState = {
  currentMapId: null,
  currentNode: null,
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getStore(pathName) {
  if (typeof window !== 'undefined' && typeof window.getStore === 'function') {
    return window.getStore(pathName)
  }
  const root = store && typeof store.getState === 'function' ? store.getState() : null
  if (!pathName) return root
  return String(pathName)
    .split('.')
    .reduce((value, key) => (value == null ? undefined : value[key]), root)
}

function getRootState() {
  if (typeof window !== 'undefined' && typeof window.getStore === 'function') {
    return window.getStore() || {}
  }
  return store && typeof store.getState === 'function' ? store.getState() : {}
}

function notify() {
  listeners.forEach((listener) => listener())
}

function mapIdFromPair(area, mapNo) {
  const normalizedArea = number(area)
  const normalizedMapNo = number(mapNo)
  return normalizedArea > 0 && normalizedMapNo > 0 ? `${normalizedArea}-${normalizedMapNo}` : null
}

function mapIdFromDetail(detail) {
  const postBody = detail?.postBody || {}
  const body = detail?.body || {}
  return normalizeMapId(
    postBody.api_map_id || body.api_map_id || mapIdFromPair(postBody.api_maparea_id, postBody.api_mapinfo_no) || mapIdFromPair(body.api_maparea_id, body.api_mapinfo_no),
  )
}

function cellFromDetail(detail) {
  const body = detail?.body || {}
  const postBody = detail?.postBody || {}
  const candidates = [body.api_no, body.api_cell_id, body.api_map_next, body.api_next, postBody.api_no]
  const cell = candidates.find((value) => number(value) > 0)
  return cell == null ? null : number(cell)
}

function updateSortieState(detail) {
  const mapId = mapIdFromDetail(detail) || pluginState.currentMapId
  if (!mapId) return
  const maps = getStore('fcd.map') || {}
  const cell = cellFromDetail(detail)
  const node = cell == null ? null : mapNodeLabel(mapId, cell, maps)
  pluginState.currentMapId = mapId
  if (node) pluginState.currentNode = node
  notify()
}

function handleGameResponse(event) {
  const detail = event?.detail || {}
  const pathName = detail.path || ''
  if (pathName === '/kcsapi/api_req_map/start') {
    pluginState.currentNode = null
    updateSortieState(detail)
  } else if (pathName === '/kcsapi/api_req_map/next') {
    updateSortieState(detail)
  }
}

function startPlugin() {
  pluginState.currentMapId = normalizeMapId(
    getStore('sortie.sortieMapId') || getStore('sortie.mapId') || getStore('info.sortieMapId'),
  )
  if (typeof window !== 'undefined') window.addEventListener('game.response', handleGameResponse)
}

function stopPlugin() {
  if (typeof window !== 'undefined') window.removeEventListener('game.response', handleGameResponse)
  listeners.clear()
}

function mapGeometry(mapId) {
  const maps = getStore('fcd.map') || {}
  return maps[mapId] || null
}

function mapNodes(mapDefinition, geometry) {
  const nodes = new Set([mapDefinition.start])
  Object.keys(geometry?.spots || {}).forEach((node) => nodes.add(node))
  ;(mapDefinition.rules || []).forEach((rule) => {
    nodes.add(rule.node)
    ;(rule.outcomes || []).forEach((outcome) => nodes.add(outcome.to))
  })
  return Array.from(nodes)
}

function positionsForNodes(nodes, geometry) {
  const spots = geometry?.spots || {}
  const position = {}
  nodes.forEach((node, index) => {
    const spot = spots[node]
    position[node] = Array.isArray(spot) && Number.isFinite(Number(spot[0]))
      ? { x: number(spot[0]), y: number(spot[1]) }
      : { x: 80 + (index % 5) * 170, y: 90 + Math.floor(index / 5) * 100 }
  })
  return position
}

function routeEdges(geometry) {
  return Object.entries(geometry?.route || {})
    .map(([cell, value]) => ({ cell: number(cell), from: value?.[0], to: value?.[1] }))
    .filter((edge) => edge.from && edge.to)
}

function statusLabel(status) {
  return {
    true: '满足',
    false: '不满足',
    unknown: '未知',
  }[status] || status
}

function confidenceLabel(confidence) {
  return {
    verified: '已核对',
    approximate: '近似',
    parsed: '已解析',
    unknown: '待核对',
  }[confidence] || confidence || '未标注'
}

function outcomeText(outcome) {
  return `${outcome.to} ${formatPercent(outcome.probability)}`
}

function ruleRows(mapDefinition, node, context) {
  return (mapDefinition.rules || [])
    .filter((rule) => rule.node === node)
    .sort((left, right) => number(left.priority) - number(right.priority))
    .map((rule) => ({
      rule,
      result: evaluatePredicate(rule.predicate, context),
    }))
}

function fleetSummary(context) {
  const entries = Object.entries(context.counts || {})
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${CATEGORY_LABELS[category] || category}${count}`)
  return entries.length ? entries.join(' / ') : '未读取到第一舰队'
}

function edgeProbability(evaluation, from, to) {
  const decision = evaluation.decisions[from]
  const outcome = decision?.outcomes?.find((entry) => entry.to === to)
  return {
    local: outcome?.probability,
    global: evaluation.probability.edgeMass[`${from}->${to}`],
  }
}

class Compass extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      mapId: pluginState.currentMapId && mapCatalog.maps[pluginState.currentMapId]
        ? pluginState.currentMapId
        : Object.keys(mapCatalog.maps)[0],
      selectedNode: pluginState.currentNode || null,
      overrides: {},
    }
    this.refresh = () => this.forceUpdate()
  }

  componentDidMount() {
    listeners.add(this.refresh)
  }

  componentWillUnmount() {
    listeners.delete(this.refresh)
  }

  selectMap(event) {
    this.setState({ mapId: event.target.value, selectedNode: null, overrides: {} })
  }

  selectNode(node) {
    this.setState({ selectedNode: node })
  }

  setManualOverride(node, to) {
    this.setState((state) => ({
      overrides: { ...state.overrides, [node]: to },
      selectedNode: node,
    }))
  }

  renderMap(mapDefinition, geometry, evaluation, selectedNode, currentNode) {
    const nodes = mapNodes(mapDefinition, geometry)
    const positions = positionsForNodes(nodes, geometry)
    const edges = routeEdges(geometry)
    const width = Math.max(1100, ...Object.values(positions).map((position) => position.x + 100))
    const height = Math.max(620, ...Object.values(positions).map((position) => position.y + 100))
    return h(
      'svg',
      { className: 'compass-map', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${mapDefinition.name} 路线图` },
      h('defs', null,
        h('marker', { id: 'compass-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' },
          h('path', { d: 'M0,0 L0,6 L7,3 z', className: 'compass-arrow' }),
        ),
      ),
      ...edges.map((edge) => {
        const from = positions[edge.from]
        const to = positions[edge.to]
        if (!from || !to) return null
        const probability = edgeProbability(evaluation, edge.from, edge.to)
        return h('g', { key: `edge-${edge.cell}`, className: 'compass-edge' },
          h('line', {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            markerEnd: 'url(#compass-arrow)',
            className: probability.global != null ? 'is-reachable' : 'is-unresolved',
          }),
          h('text', {
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2 - 8,
            className: 'compass-edge-label',
          }, probability.global != null ? `全局 ${formatPercent(probability.global)}` : '未知'),
          h('title', null, `局部 ${formatPercent(probability.local)}，全局 ${formatPercent(probability.global)}`),
        )
      }),
      ...nodes.map((node) => {
        const position = positions[node]
        const reach = evaluation.probability.reach[node]
        const classNames = [
          'compass-node',
          node === selectedNode ? 'is-selected' : '',
          node === currentNode ? 'is-current' : '',
          node === mapDefinition.boss ? 'is-boss' : '',
        ].filter(Boolean).join(' ')
        return h('g', {
          key: `node-${node}`,
          className: classNames,
          role: 'button',
          tabIndex: 0,
          onClick: () => this.selectNode(node),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') this.selectNode(node)
          },
        },
        h('circle', { cx: position.x, cy: position.y, r: 28 }),
        h('text', { x: position.x, y: position.y + 6, className: 'compass-node-label' }, node),
        h('text', { x: position.x, y: position.y + 50, className: 'compass-node-probability' }, reach != null ? formatPercent(reach) : '未知'),
        )
      }),
    )
  }

  renderRulePanel(mapDefinition, node, context, evaluation) {
    if (!node) return h('div', { className: 'compass-empty-panel' }, '点击地图节点查看带路条件。')
    const rows = ruleRows(mapDefinition, node, context)
    const decision = evaluation.decisions[node]
    return h('section', { className: 'compass-panel' },
      h('h4', null, `${node} 点带路条件`),
      rows.length
        ? h('div', { className: 'compass-rules' }, ...rows.map(({ rule, result }) => h('div', {
          key: rule.id,
          className: `compass-rule is-${result.status}`,
        },
        h('div', { className: 'compass-rule-heading' },
          h('span', { className: 'compass-rule-status' }, statusLabel(result.status)),
          h('span', null, predicateLabel(rule.predicate)),
          h('span', { className: 'compass-confidence' }, confidenceLabel(rule.confidence)),
        ),
        h('div', { className: 'compass-rule-outcomes' },
          rule.outcomes?.length ? rule.outcomes.map((outcome) => h('span', { key: `${rule.id}-${outcome.to}` }, outcomeText(outcome))) : '无确定出口',
        ),
        )))
        : h('div', { className: 'compass-muted' }, '该节点没有录入带路规则，可能是终点。'),
      decision?.manual
        ? h('div', { className: 'compass-manual' },
          h('strong', null, '手动路线覆盖（仅用于推演）'),
          ...decision.baseOutcomes.map((outcome) => h('button', {
            key: outcome.to,
            type: 'button',
            className: decision.manualOverride === outcome.to ? 'is-active' : '',
            onClick: () => this.setManualOverride(node, outcome.to),
          }, `选择 ${outcome.to}`)),
        )
        : null,
    )
  }

  render() {
    const mapDefinition = mapCatalog.maps[this.state.mapId] || mapCatalog.maps[Object.keys(mapCatalog.maps)[0]]
    const rootState = getRootState()
    const context = fleetContextFromState(rootState, 1)
    const geometry = mapGeometry(this.state.mapId)
    const evaluation = evaluateMap(mapDefinition, context, this.state.overrides)
    const currentNode = pluginState.currentMapId === this.state.mapId ? pluginState.currentNode : null
    const nodes = mapNodes(mapDefinition, geometry)
    const selectedNode = nodes.includes(this.state.selectedNode)
      ? this.state.selectedNode
      : currentNode || mapDefinition.start
    const cssPath = path.join(__dirname, 'assets', 'compass.css')
    const currentDecision = evaluation.decisions[selectedNode]
    const warnings = [
      context.complete ? null : 'poi 尚未提供完整舰队 master 数据，部分条件会显示为未知。',
      context.losApproximate && context.losScore != null ? `索敌值为插件估算值：${context.losScore}` : null,
      evaluation.probability.unknownNodes.length ? `未闭合概率：${evaluation.probability.unknownNodes.join('、')} 点` : null,
    ].filter(Boolean)

    return h('div', { className: 'poi-compass' },
      h('link', { rel: 'stylesheet', href: cssPath }),
      h('header', { className: 'compass-header' },
        h('div', null,
          h('h3', null, '舰队罗盘'),
          h('span', { className: 'compass-subtitle' }, '通常海域 · 离线规则数据'),
        ),
        h('label', { className: 'compass-map-select' },
          h('span', null, '海图'),
          h('select', { value: this.state.mapId, onChange: (event) => this.selectMap(event) },
            Object.entries(mapCatalog.maps).map(([mapId, definition]) => h('option', { key: mapId, value: mapId }, `${mapId} ${definition.name}`)),
          ),
        ),
        h('button', { type: 'button', className: 'compass-reset', onClick: () => this.setState({ overrides: {} }) }, '清除手动路线'),
      ),
      h('div', { className: 'compass-meta' },
        h('span', null, `第一舰队：${fleetSummary(context)}`),
        h('span', null, `当前节点：${currentNode || '未在出击中'}`),
        h('span', null, `规则数据：${mapCatalog.dataVersion}`),
      ),
      warnings.length ? h('div', { className: 'compass-warnings' }, ...warnings.map((warning) => h('div', { key: warning }, warning))) : null,
      h('main', { className: 'compass-layout' },
        h('section', { className: 'compass-map-panel' }, this.renderMap(mapDefinition, geometry, evaluation, selectedNode, currentNode)),
        h('aside', { className: 'compass-sidebar' },
          this.renderRulePanel(mapDefinition, selectedNode, context, evaluation),
          h('section', { className: 'compass-panel' },
            h('h4', null, '当前分歧结果'),
            currentDecision?.rule
              ? h('div', { className: 'compass-current-result' },
                h('div', null, `${selectedNode}：${currentDecision.status === 'matched' ? '已匹配' : '未知'}`),
                h('div', { className: 'compass-rule-outcomes' }, currentDecision.outcomes.length ? currentDecision.outcomes.map(outcomeText).join(' / ') : '无法计算出口'),
              )
              : h('div', { className: 'compass-muted' }, '该节点没有后续分歧。'),
          ),
          h('section', { className: 'compass-panel compass-sources' },
            h('h4', null, '来源'),
            ...(mapDefinition.sourceRefs || []).map((source) => h('a', { key: source.url, href: source.url, target: '_blank', rel: 'noreferrer' }, source.kind)),
          ),
        ),
      ),
    )
  }
}

exports.reactClass = Compass
exports.windowMode = true
exports.pluginDidLoad = startPlugin
exports.pluginWillUnload = stopPlugin
exports.__test = {
  cellFromDetail,
  handleGameResponse,
  mapIdFromDetail,
  mapNodes,
  pluginState,
  routeEdges,
}
