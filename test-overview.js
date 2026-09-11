'use strict'
const assert = require('assert')
const { mapOverview } = require('./overview')
const rule = (node, predicate, outcomes, priority = 0) => ({ node, predicate, outcomes, priority })
const map = { start: '1', rules: [
  rule('1', { kind: 'always' }, [{ to: 'A', probability: 1 }, { to: 'B', probability: 0 }]),
  rule('A', { kind: 'los', op: '>=', value: 40 }, [{ to: 'C', probability: 1 }]),
  rule('A', { kind: 'always' }, [{ to: 'D', probability: 1 }], 10),
  rule('B', { kind: 'los', op: '>=', value: 99 }, [{ to: 'C', probability: 1 }]),
] }
const loader = (_, node) => ({ status: 'ready', rows: [{ count: 2, thresholds: { superiority: node === 'B' ? 999 : 42, supremacy: 84 } }] })
let summary = mapOverview('1-1', map, { losScore: 20 }, {}, loader)
assert.strictEqual(summary.maxLos, 40) // Requirement remains visible even if not met.
assert.deepStrictEqual(summary.losNodes, ['A'])
assert.strictEqual(summary.superiority, 42)
assert(!summary.nodes.includes('B'))
const fixed = { ...map, rules: [rule('A', { kind: 'always' }, [{ to: 'D', probability: 1 }], -1), ...map.rules] }
assert.strictEqual(mapOverview('1-1', fixed, { losScore: 20 }, {}, loader).maxLos, null)
summary = mapOverview('1-1', { ...map, manualNodes: ['A'] }, { losScore: 40 }, {}, loader)
assert.strictEqual(summary.partial, true)
assert(!summary.nodes.includes('C'))
summary = mapOverview('1-1', map, { losScore: 40 }, {}, () => ({ status: 'missing' }))
assert(summary.missing.includes('A'))
assert.strictEqual(summary.superiority, null)
console.log('Map overview tests passed')
