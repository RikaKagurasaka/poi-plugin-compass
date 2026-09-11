'use strict'

const { routeDecision } = require('./logic')
const { loadEnemies } = require('./enemies')
const nodeCatalog = require('./data/kcnav-node-types.json')
const nodeTypes = require('./data/kcnav-node-types-by-map.json')
const kc3Ids = require('./data/kc3kai-master-ids.json')
const kc3Stats = require('./data/kc3kai-ship-stats.json')
const kc3Ships = new Set(Object.keys(kc3Stats.ships).map(Number))
const kc3Equips = new Set(kc3Ids.equips)
const submarines = new Set(kc3Ids.submarines)

function enumerateRoutes(definition, geometry, context, overrides = {}) {
  const routes = []
  const blocked = new Set()
  const edges = Object.values(geometry.route || {}).filter((edge) => edge[0] && edge[1])
  const outgoing = new Set(edges.map(([from]) => from))
  let visits = 0
  function walk(node, nodes, probability, score, estimated) {
    if (++visits > 10000) throw new Error('候选路线过多，请先在地图上指定部分能动分歧')
    if (nodes.includes(node)) { blocked.add(node); return }
    const path = [...nodes, node]
    const decision = routeDecision(definition, node, { ...context, passedNodes: nodes }, overrides)
    if (decision.status === 'terminal' || !outgoing.has(node) && !decision.outcomes.length && !decision.rule) {
      routes.push({ key: path.join('>'), nodes: path, probability, score, estimated, boss: node === definition.boss })
      return
    }
    const outcomes = decision.manualChoiceRequired ? decision.manualOutcomes || decision.baseOutcomes : decision.outcomes
    if (decision.status === 'unknown' && !decision.manualChoiceRequired || !outcomes.length) { blocked.add(node); return }
    for (const outcome of outcomes) {
      if (outcome.probability === 0) continue
      const virtualStart = node === '1' && outcome.to === '2' && ['6-4-start-right-lha', '6-4-start-right-heavy', '6-5-start-right'].includes(decision.rule?.id)
      if (!virtualStart && !edges.some(([from, to]) => from === node && to === outcome.to)) { blocked.add(node); continue }
      const p = decision.manualChoiceRequired ? null : outcome.probability
      walk(outcome.to, path, probability == null || p == null ? null : probability * p,
        score * (p ?? 1 / outcomes.length), estimated || outcome.estimated === true)
    }
  }
  walk(definition.start, [], 1, 1, false)
  routes.sort((a, b) => Number(b.boss) - Number(a.boss) || b.score - a.score || a.key.localeCompare(b.key))
  return { routes, blocked: [...blocked] }
}

function battleNodes(mapId, route, geometry, loader = loadEnemies) {
  return route.nodes.flatMap((node, index) => {
    const type = nodeTypes[mapId]?.[node]
    if (!nodeCatalog[type]?.hasEnemies) return []
    const edge = Object.entries(geometry.route).find(([, value]) => value[0] === route.nodes[index - 1] && value[1] === node)
    if (!edge) throw new Error(`${node} 点缺少实际路线编号`)
    const data = loader(mapId, node)
    const rows = data.status === 'ready' ? data.rows.filter((entry) => entry.count > 0) : []
    const subOnly = rows.length > 0 && rows.every((entry) => [...entry.mainFleet, ...entry.escortFleet].every((ship) => submarines.has(ship.id)))
    return [{ node, cell: Number(edge[0]), type, rows, subOnly, formation: subOnly ? 5 : [7, 10].includes(type) ? 3 : 1 }]
  })
}

function required(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`poi 数据不可用：${label}`)
  return value
}

function playerFleet(state, deckId = 1) {
  const fleet = state.info?.fleets?.[deckId - 1]
  if (!Array.isArray(fleet?.api_ship)) throw new Error(`poi 数据不可用：舰队 ${deckId}`)
  const ships = fleet.api_ship.filter((id) => id > 0).map((id) => {
    const ship = state.info?.ships?.[id]
    const master = state.const?.$ships?.[ship?.api_ship_id]
    if (!ship || !master || !Array.isArray(ship.api_slot) || !Array.isArray(ship.api_onslot) || !Array.isArray(ship.api_kyouka)) throw new Error(`poi 数据不可用：舰娘 #${id}`)
    const slotCount = required(ship.api_slotnum, '装备槽数')
    const items = [...ship.api_slot.slice(0, slotCount), ship.api_slot_ex ?? -1].map((equipId, index) => {
      if (equipId <= 0) return null
      const equip = state.info?.equips?.[equipId]
      const equipMaster = state.const?.$equips?.[equip?.api_slotitem_id]
      if (!equip || !equipMaster) throw new Error(`poi 数据不可用：装备 #${equipId}`)
      return { id: equip.api_slotitem_id, rf: required(equip.api_level, '装备改修'), mas: equip.api_alv ?? 0, ac: index < slotCount ? required(ship.api_onslot[index], '当前搭载') : 0 }
    })
    const level = required(ship.api_lv, '等级')
    const statsBase = {}
    for (const [key, field, mod] of [['fp', 'api_houg', 0], ['tp', 'api_raig', 1], ['aa', 'api_tyku', 2], ['ar', 'api_souk', 3]]) {
      statsBase[key] = required(master[field]?.[0], field) + required(ship.api_kyouka[mod], '近代化改修')
    }
    statsBase.luk = required(ship.api_lucky?.[0], '运')
    return { ship, master, items, slotCount, level, statsBase }
  })
  if (!ships.length || ships.length > 6) throw new Error('仅支持所选舰队的 1～6 艘单舰队导出')
  return { ships, admiralLevel: required(state.info?.basic?.api_level, '司令部等级') }
}

function validateBattles(battles) {
  if (!battles.length) throw new Error('此路线没有战斗节点')
  const missing = battles.filter((battle) => !battle.rows.length)
  if (missing.length) throw new Error(`${missing.map((b) => b.node).join('、')} 点尚未缓存或本月无敌编成样本`)
}

function kc3Enemy(ship) {
  if (!kc3Ships.has(ship.id)) throw new Error(`KC3Kai 数据未收录敌舰 #${ship.id}`)
  const equips = ship.equips.filter((id) => id > 0).map((id) => ({ mstId: id > 500 && id < 1000 ? id + 1000 : id, rank: 0 }))
  if (ship.exslot > 0) equips.push({ mstId: ship.exslot, rank: 0 })
  for (const equip of equips) if (!kc3Equips.has(equip.mstId)) throw new Error(`KC3Kai 数据未收录装备 #${equip.mstId}`)
  return { mstId: ship.id, level: ship.lvl, hp: ship.hp, hpInit: ship.hp,
    statsBase: { fp: ship.fp, tp: ship.torp, aa: ship.aa, ar: ship.armor }, equips }
}

function kc3Save(state, mapId, battles, formations = {}, deckId = 1) {
  validateBattles(battles)
  if (battles.length > 9) throw new Error('KC3Kai 最多支持 9 个战斗节点')
  const excessive = battles.find((battle) => battle.rows.length > 12)
  if (excessive) throw new Error(`KC3Kai 每节点最多支持 12 套敌编成，${excessive.node} 点有 ${excessive.rows.length} 套；请改用 noro6 选择单套编成`)
  const unknownType = battles.find((battle) => ![4, 5, 7, 10, 11].includes(battle.type))
  if (unknownType) throw new Error(`${unknownType.node} 点战斗类型尚未适配 KC3Kai`)
  const { ships } = playerFleet(state, deckId)
  const players = ships.map(({ ship, master, items, slotCount, level, statsBase }) => {
    if (!kc3Ships.has(master.api_id)) throw new Error(`KC3Kai 数据未收录舰娘 #${master.api_id}`)
    for (const item of items) if (item && !kc3Equips.has(item.id)) throw new Error(`KC3Kai 数据未收录装备 #${item.id}`)
    // Missing EV/LOS/ASW are derived by KC3Kai from level. Only override ASW
    // when modernization cannot be represented by level alone.
    const aswModernization = required(ship.api_kyouka[6], '对潜改修')
    const exportedStats = { ...statsBase }
    if (aswModernization > 0) {
      const growth = kc3Stats.ships[master.api_id]
      if (!Number.isFinite(growth?.ASWbase) || !Number.isFinite(growth?.ASW)) throw new Error(`KC3Kai 本地缓存缺少 #${master.api_id} 对潜成长数据`)
      exportedStats.asw = growth.ASWbase + Math.floor((growth.ASW - growth.ASWbase) * level / 99) + aswModernization
    }
    return { mstId: master.api_id, level, hp: required(ship.api_maxhp, '最大耐久'), hpInit: required(ship.api_nowhp, '当前耐久'),
      morale: required(ship.api_cond, '士气'), fuelInit: required(ship.api_fuel, '燃油') / required(master.api_fuel_max, '燃油上限') * 100,
      ammoInit: required(ship.api_bull, '弹药') / required(master.api_bull_max, '弹药上限') * 100,
      statsBase: exportedStats, slots: ship.api_onslot.slice(0, slotCount),
      equips: items.map((item) => item ? { mstId: item.id, level: item.rf, rank: item.mas } : null) }
  })
  return {
    version: 2, fleetFMain: { version: 2, type: 0, formation: 1, ships: players },
    useSupportN: false, useSupportB: false, useFF: false, fleetsFFriend: [], landBases: [],
    settings: { airRaidCostW6: mapId.startsWith('6-') },
    battles: battles.map((battle, index) => ({
      id: index + 1, ind: index, formation: Number(formations[battle.node] || battle.formation),
      nodeType: ({ 11: 2, 7: 4, 10: 6 })[battle.type] || 1,
      doNB: battle.type === 5, doNBCond: '', subOnly: battle.subOnly,
      lbasWaves: [false, false, false, false, false, false],
      enemyComps: battle.rows.map((entry, compIndex) => ({ num: compIndex + 1, rate: entry.count,
        fleet: { version: 2, type: entry.escortFleet.length ? 1 : 0, formation: entry.formation,
          ships: entry.mainFleet.map(kc3Enemy), ...(entry.escortFleet.length ? { shipsEscort: entry.escortFleet.map(kc3Enemy) } : {}) } })),
    })),
  }
}

function noroDeck(state, mapId, battles, selected = {}, formations = {}, deckId = 1) {
  validateBattles(battles)
  const { ships, admiralLevel } = playerFleet(state, deckId)
  const f1 = { name: `舰队 ${deckId}`, t: 0 }
  ships.forEach(({ ship, master, level, items, slotCount }, index) => {
    const equipment = {}
    items.forEach((item, i) => { if (item) equipment[i === slotCount ? 'ix' : `i${i + 1}`] = item })
    f1[`s${index + 1}`] = { id: master.api_id, lv: level, luck: ship.api_lucky[0], hp: ship.api_maxhp,
      asw: required(ship.api_taisen?.[0], '对潜'), exa: ship.api_slot_ex !== 0, items: equipment }
  })
  const [a, i] = mapId.split('-').map(Number)
  const fleet = (shipsE) => ({ s: shipsE.map((ship) => ({ id: ship.id, items: ship.equips.filter((id) => id > 0).map((id) => ({ id })) })) })
  return { version: 4, hqlv: admiralLevel, f1, s: { a, i, c: battles.map((battle) => {
    const entry = battle.rows.find((row) => compositionKey(row) === selected[battle.node]) || battle.rows[0]
    return { c: battle.cell, pf: Number(formations[battle.node] || battle.formation), ef: entry.formation,
      f1: fleet(entry.mainFleet), ...(entry.escortFleet.length ? { f2: fleet(entry.escortFleet) } : {}) }
  }) } }
}

function compositionKey(entry) {
  return JSON.stringify([entry.masterId, entry.formation, entry.mainFleet, entry.escortFleet])
}

function kc3Url(save) {
  return new Promise((resolve, reject) => {
    require('lzma').compress(JSON.stringify(save), 1, (bytes, error) => {
      if (error) reject(error)
      else resolve(`https://kc3kai.github.io/kancolle-replay/simulator.html#backup=${Buffer.from(bytes).toString('base64')}`)
    })
  })
}

function noroUrl(deck) {
  return `https://noro6.github.io/kc-web/?predeck=${encodeURIComponent(JSON.stringify(deck))}#/`
}

module.exports = { enumerateRoutes, battleNodes, playerFleet, kc3Save, noroDeck, compositionKey, kc3Url, noroUrl }
