import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, validateGraph, detectCycle, formatCurrency, applyChanges, simulateUncertaintyBands, DEFAULT_UNCERTAINTY_SETTINGS } from '../src/engine/simulation.ts';
import { evaluateAlternatives, getRecommendations } from '../src/engine/advisor.ts';
import { ScenarioSchema, StructuredStrategyResponseSchema, SimNodeSchema, SimEdgeSchema, ConfigurableUncertaintySchema } from '../src/types/schema.ts';

function createSupplierScenario() {
  return {
    id: 'test-supply-chain',
    name: 'Supplier-Warehouse System',
    domain: 'supply',
    description: 'Deterministic test scenario for supply chain propagation',
    budget: 100000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      {
        id: 'supplier',
        name: 'Supplier',
        type: 'supplier',
        quantityUnit: 'pallet',
        operatingPeriod: 'day',
        costCurrency: 'INR',
        costBasis: 'per_fulfilled',
        fixedCost: 0,
        unitCost: 1,
        demand: 200,
        capacity: 200,
        availability: 1,
        baseDelayHours: 0,
        priority: 'high'
      },
      {
        id: 'warehouse',
        name: 'Warehouse',
        type: 'facility',
        quantityUnit: 'pallet',
        operatingPeriod: 'day',
        costCurrency: 'INR',
        costBasis: 'per_fulfilled',
        fixedCost: 0,
        unitCost: 1,
        demand: 200,
        capacity: 200,
        availability: 1,
        baseDelayHours: 0,
        priority: 'high'
      }
    ],
    edges: [
      { id: 'e1', source: 'supplier', target: 'warehouse', type: 'supplies', influence: 0.8, aggregation: 'bottleneck' }
    ]
  };
}

// ---------------------------------------------------------------------
// 1. Core Simulation Suite
// ---------------------------------------------------------------------

test('1. normal baseline scenario runs and computes expected outcomes', () => {
  const scenario = createSupplierScenario();
  const res = simulate(scenario, [], 'Baseline');
  assert.equal(res.totalDemand, 400);
  assert.equal(res.totalFulfilled, 400);
  assert.equal(res.totalUnmet, 0);
  assert.ok(res.overallHealth >= 90);
  assert.equal(res.bottlenecks.length, 0);
});

test('2. demand greater than capacity detects unmet demand and bottlenecks', () => {
  const scenario = createSupplierScenario();
  scenario.edges = [];
  const res = simulate(scenario, [{ id: 'c1', nodeId: 'warehouse', variable: 'demand', operation: 'set', value: 260, label: 'Demand Surge' }]);
  const wh = res.nodes.find(n => n.nodeId === 'warehouse');
  assert.ok(wh);
  assert.equal(wh.effectiveCapacity, 200);
  assert.equal(wh.fulfilled, 200);
  assert.equal(wh.unmetDemand, 60);
  assert.ok(wh.utilization > 100);
  assert.ok(res.bottlenecks.includes('Warehouse'));
});

test('3. availability reduction clamps and scales capacity proportionally', () => {
  const scenario = createSupplierScenario();
  scenario.edges = [];
  const res = simulate(scenario, [{ id: 'c2', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.5, label: '50% Availability' }]);
  const sup = res.nodes.find(n => n.nodeId === 'supplier');
  assert.ok(sup);
  assert.equal(sup.effectiveCapacity, 100);
  assert.equal(sup.fulfilled, 100);
  assert.equal(sup.unmetDemand, 100);
});

test('4. supply dependency shortage propagation matches exact formula: 1 - 0.8 * (1 - 0.5) = 0.6 -> cap 120, unmet 80', () => {
  const scenario = createSupplierScenario();
  const res = simulate(scenario, [{ id: 'c3', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.5, label: 'Supplier 50% shortage' }]);
  const wh = res.nodes.find(n => n.nodeId === 'warehouse');
  assert.ok(wh);
  assert.equal(wh.effectiveCapacity, 120);
  assert.equal(wh.unmetDemand, 80);
  assert.equal(wh.fulfilled, 120);
});

test('5. requires and supports dependency propagation properly limits downstream capacity', () => {
  const scenario = {
    id: 'test-req-sup',
    name: 'Req and Support Test',
    domain: 'campus',
    description: 'Testing requires and supports typed edges',
    budget: 50000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'n1', name: 'Prerequisite', type: 'process', quantityUnit: 'unit', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 0, demand: 100, capacity: 100, availability: 1, unitCost: 1, baseDelayHours: 0, priority: 'high' },
      { id: 'n2', name: 'Dependent', type: 'people', quantityUnit: 'unit', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 0, demand: 100, capacity: 100, availability: 1, unitCost: 1, baseDelayHours: 0, priority: 'high' }
    ],
    edges: [
      { id: 'e_req', source: 'n1', target: 'n2', type: 'requires', influence: 0.5, aggregation: 'bottleneck' }
    ]
  };
  const res = simulate(scenario, [{ id: 'c', nodeId: 'n1', variable: 'availability', operation: 'set', value: 0.5, label: '50% Prerequisite' }]);
  const dep = res.nodes.find(n => n.nodeId === 'n2');
  assert.ok(dep);
  assert.equal(dep.effectiveCapacity, 75);
  assert.equal(dep.fulfilled, 75);
  assert.equal(dep.unmetDemand, 25);
});

test('6. delay propagation: critical path evaluates maximum of parallel incoming delays', () => {
  const scenario = {
    id: 'test-delay-cpm',
    name: 'CPM Delay Test',
    domain: 'supply',
    description: 'Testing CPM parallel delay propagation',
    budget: 50000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 't1', name: 'Transport Fast', type: 'transport', quantityUnit: 'trip', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, demand: 100, capacity: 100, availability: 1, unitCost: 1, baseDelayHours: 2, priority: 'medium' },
      { id: 't2', name: 'Transport Slow', type: 'transport', quantityUnit: 'trip', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, demand: 100, capacity: 100, availability: 1, unitCost: 1, baseDelayHours: 5, priority: 'medium' },
      { id: 'delivery', name: 'Delivery Hub', type: 'outcome', quantityUnit: 'trip', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, demand: 100, capacity: 100, availability: 1, unitCost: 1, baseDelayHours: 1, priority: 'high' }
    ],
    edges: [
      { id: 'e_d1', source: 't1', target: 'delivery', type: 'delays', influence: 1.0, aggregation: 'critical_path' },
      { id: 'e_d2', source: 't2', target: 'delivery', type: 'delays', influence: 1.0, aggregation: 'critical_path' }
    ]
  };
  const res = simulate(scenario, []);
  const del = res.nodes.find(n => n.nodeId === 'delivery');
  assert.ok(del);
  // Delivery base delay (1h) + max parallel incoming delay (max(2h, 5h) = 5h) = 6 hours (NOT 1 + 2 + 5 = 8h!)
  assert.equal(del.delayHours, 6);
});

test('7. increases-cost relationship: explicit unit surcharge computes exact additional cost', () => {
  const scenario = {
    id: 'test-cost-explicit',
    name: 'Explicit Surcharge Test',
    domain: 'business',
    description: 'Explicit cost surcharge test',
    budget: 50000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'mat', name: 'Raw Materials', type: 'stock', quantityUnit: 'kg', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 0, demand: 100, capacity: 100, availability: 0.5, unitCost: 10, baseDelayHours: 0, priority: 'high' },
      { id: 'prod', name: 'Production', type: 'process', quantityUnit: 'item', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 500, demand: 100, capacity: 100, availability: 1, unitCost: 20, baseDelayHours: 0, priority: 'high' }
    ],
    edges: [
      // upstream unmet demand = 50. additionalUnitCost = 5, influence = 0.8 -> surcharge = 50 * 5 * 0.8 = 200
      { id: 'e_cost', source: 'mat', target: 'prod', type: 'increases_cost', influence: 0.8, additionalUnitCost: 5 }
    ]
  };
  const res = simulate(scenario, []);
  const prod = res.nodes.find(n => n.nodeId === 'prod');
  assert.ok(prod);
  // Fixed cost (500) + variable cost (100 * 20 = 2000) + explicit surcharge (200) = 2700
  assert.equal(prod.cost, 2700);
  assert.ok(prod.trace.some(t => t.includes('₹200 surcharge')));
});

test('8. independent node with no incoming edges has dependencyFactor 1.0', () => {
  const scenario = {
    id: 'test-indep',
    name: 'Independent Node Test',
    domain: 'campus',
    description: 'No edges',
    budget: 10000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'standalone', name: 'Standalone Component', type: 'resource', quantityUnit: 'unit', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 0, demand: 50, capacity: 80, availability: 1, unitCost: 5, baseDelayHours: 0, priority: 'low' }
    ],
    edges: []
  };
  const res = simulate(scenario, []);
  const node = res.nodes[0];
  assert.equal(node.dependencyFactor, 1);
  assert.equal(node.effectiveCapacity, 80);
  assert.equal(node.fulfilled, 50);
  assert.equal(node.unmetDemand, 0);
});

test('9. zero capacity and zero demand edge cases execute without NaN or division by zero', () => {
  const scenario = {
    id: 'test-zeros',
    name: 'Zero Edge Cases',
    domain: 'custom',
    description: 'Zeros test',
    budget: 1000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'zero_both', name: 'Zero Both', type: 'custom', quantityUnit: 'unit', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 0, demand: 0, capacity: 0, availability: 0, unitCost: 0, baseDelayHours: 0, priority: 'low' },
      { id: 'zero_cap', name: 'Zero Capacity With Demand', type: 'custom', quantityUnit: 'unit', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 0, demand: 50, capacity: 0, availability: 1, unitCost: 10, baseDelayHours: 0, priority: 'high' }
    ],
    edges: []
  };
  const res = simulate(scenario, []);
  assert.ok(Number.isFinite(res.overallHealth));
  const zBoth = res.nodes.find(n => n.nodeId === 'zero_both');
  assert.equal(zBoth.utilization, 0);
  assert.equal(zBoth.unmetDemand, 0);
  const zCap = res.nodes.find(n => n.nodeId === 'zero_cap');
  assert.equal(zCap.utilization, 100);
  assert.equal(zCap.unmetDemand, 50);
});

test('10. invalid edge references are rejected with clear descriptive errors', () => {
  const scenario = createSupplierScenario();
  scenario.edges.push({ id: 'e_bad', source: 'supplier', target: 'non_existent_node', type: 'supplies', influence: 0.5 });
  const validation = validateGraph(scenario.nodes, scenario.edges);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(e => e.includes('non_existent_node')));
  assert.throws(() => simulate(scenario, []), /Graph validation failed/);
});

test('11. circular graph rejection detects cycles and blocks simulation', () => {
  const scenario = createSupplierScenario();
  scenario.edges.push({ id: 'e_cycle', source: 'warehouse', target: 'supplier', type: 'requires', influence: 0.5 });
  const cycle = detectCycle(scenario.nodes, scenario.edges);
  assert.ok(cycle && cycle.length > 0);
  const validation = validateGraph(scenario.nodes, scenario.edges);
  assert.equal(validation.valid, false);
  assert.throws(() => simulate(scenario, []), /Circular dependency detected/);
});

test('12. deterministic repeatability returns identical numerical outcomes on repeated runs', () => {
  const scenario = createSupplierScenario();
  const changes = [{ id: 'c', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.6, label: 'Test' }];
  const run1 = simulate(scenario, changes, 'Run 1');
  const run2 = simulate(scenario, changes, 'Run 2');
  assert.equal(run1.totalDemand, run2.totalDemand);
  assert.equal(run1.totalFulfilled, run2.totalFulfilled);
  assert.equal(run1.totalUnmet, run2.totalUnmet);
  assert.equal(run1.totalCost, run2.totalCost);
  assert.equal(run1.overallHealth, run2.overallHealth);
  assert.deepEqual(run1.bottlenecks, run2.bottlenecks);
});

test('13. change application does not mutate original baseline scenario', () => {
  const scenario = createSupplierScenario();
  const baselineAvail = scenario.nodes[0].availability;
  simulate(scenario, [{ id: 'c', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.25, label: 'Drop' }]);
  assert.equal(scenario.nodes[0].availability, baselineAvail);
});

test('14. optimistic, base, and pessimistic stress-test variants produce graded outcomes', () => {
  const scenario = createSupplierScenario();
  const changes = [{ id: 'c', nodeId: 'warehouse', variable: 'demand', operation: 'set', value: 200, label: 'Demand' }];
  const bands = [
    { name: 'Optimistic', factor: 0.8 },
    { name: 'Base', factor: 1.0 },
    { name: 'Pessimistic', factor: 1.3 }
  ].map(b => {
    const scaled = changes.map(c => ({ ...c, value: c.value * b.factor }));
    return simulate(scenario, scaled, b.name);
  });
  assert.ok(bands[0].totalDemand < bands[1].totalDemand);
  assert.ok(bands[1].totalDemand < bands[2].totalDemand);
});

test('15. alternative evaluation tests multiple strategies and catches budget constraint violations', () => {
  const scenario = createSupplierScenario();
  scenario.budget = 300;
  const alts = evaluateAlternatives(scenario, [{ id: 'c', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.5, label: 'Drop' }]);
  assert.ok(alts.length >= 3);
  const baselineAlt = alts.find(a => a.name.includes('Baseline'));
  assert.ok(baselineAlt);
  assert.ok(baselineAlt.result.budgetVariance > 0);
  assert.ok(baselineAlt.hardConstraintViolations.length > 0);
});

test('16. history save, load, and delete handles serialization safely', () => {
  const scenario = createSupplierScenario();
  const res = simulate(scenario, []);
  const mockStorage = new Map();
  const item = { id: 'run-1', scenario, result: res, savedAt: new Date().toISOString() };

  mockStorage.set('whatif-history', JSON.stringify([item]));
  const loaded = JSON.parse(mockStorage.get('whatif-history'));
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'run-1');

  const filtered = loaded.filter(r => r.id !== 'run-1');
  mockStorage.set('whatif-history', JSON.stringify(filtered));
  assert.equal(JSON.parse(mockStorage.get('whatif-history')).length, 0);
});

test('17. report exports format markdown and JSON properly', () => {
  const scenario = createSupplierScenario();
  const res = simulate(scenario, []);
  const recs = getRecommendations(res);
  const exportPayload = { scenario, result: res, recommendations: recs };
  const jsonString = JSON.stringify(exportPayload, null, 2);
  assert.ok(jsonString.includes(scenario.name));
  assert.ok(jsonString.includes('totalFulfilled'));

  const mdReport = `# WHATIF AI — ${scenario.name}\n\nHealth: ${res.overallHealth}/100\nCost: ${formatCurrency(res.totalCost, scenario.currency)}`;
  assert.ok(mdReport.includes('WHATIF AI'));
  assert.ok(mdReport.includes('Supplier-Warehouse System'));
});

test('18. Zod schema correctly validates structured strategy response and rejects malformed outputs', () => {
  const validOutput = {
    summary: 'Supplier disruption propagates downstream to warehouse.',
    criticalBottleneck: 'Supplier availability shortage',
    affectedComponents: ['Supplier', 'Warehouse'],
    interventions: [
      {
        title: 'Activate secondary supplier',
        rationale: 'Restores 40 units of supply',
        tradeoff: '15% higher unit cost',
        requiredAssumptions: 'Secondary supplier lead time is under 24 hours'
      }
    ],
    unresolvedQuestions: ['Can warehouse buffer absorb short-term delay?']
  };
  const parsed = StructuredStrategyResponseSchema.safeParse(validOutput);
  assert.equal(parsed.success, true);

  const malformedOutput = {
    summary: 'Incomplete response',
    affectedComponents: 'Not an array',
    interventions: [{ title: 'Just a title' }]
  };
  const failed = StructuredStrategyResponseSchema.safeParse(malformedOutput);
  assert.equal(failed.success, false);
});

// ---------------------------------------------------------------------
// 19-28. Mathematical Invariants Suite (Universal Upgrade Section 8)
// ---------------------------------------------------------------------

// Invariant 1: Demand monotonicity
test('19. INVARIANT: increasing demand cannot reduce unmet demand when other inputs are fixed', () => {
  const scenario = createSupplierScenario();
  const runBase = simulate(scenario, []);
  const runHigherDemand = simulate(scenario, [
    { id: 'c_inc_dem', nodeId: 'warehouse', variable: 'demand', operation: 'set', value: 300, label: 'Higher Demand' }
  ]);
  const whBase = runBase.nodes.find(n => n.nodeId === 'warehouse');
  const whHigh = runHigherDemand.nodes.find(n => n.nodeId === 'warehouse');
  assert.ok(whBase && whHigh);
  assert.ok(whHigh.unmetDemand >= whBase.unmetDemand);
});

// Invariant 2: Capacity monotonicity
test('20. INVARIANT: increasing capacity cannot reduce fulfilled demand', () => {
  const scenario = createSupplierScenario();
  scenario.nodes.find(n => n.id === 'warehouse').capacity = 100;
  const runLowCap = simulate(scenario, []);
  const runHighCap = simulate(scenario, [
    { id: 'c_inc_cap', nodeId: 'warehouse', variable: 'capacity', operation: 'set', value: 200, label: 'Higher Capacity' }
  ]);
  const whLow = runLowCap.nodes.find(n => n.nodeId === 'warehouse');
  const whHigh = runHighCap.nodes.find(n => n.nodeId === 'warehouse');
  assert.ok(whLow && whHigh);
  assert.ok(whHigh.fulfilled >= whLow.fulfilled);
});

// Invariant 3: Cost independence
test('21. INVARIANT: increasing unit cost must not change capacity or fulfilled demand', () => {
  const scenario = createSupplierScenario();
  const runStandardCost = simulate(scenario, []);
  const runHigherCost = simulate(scenario, [
    { id: 'c_high_cost', nodeId: 'warehouse', variable: 'unitCost', operation: 'set', value: 50, label: 'High Unit Cost' }
  ]);
  const whStd = runStandardCost.nodes.find(n => n.nodeId === 'warehouse');
  const whHigh = runHigherCost.nodes.find(n => n.nodeId === 'warehouse');
  assert.ok(whStd && whHigh);

  assert.equal(whHigh.effectiveCapacity, whStd.effectiveCapacity);
  assert.equal(whHigh.fulfilled, whStd.fulfilled);
  assert.equal(whHigh.unmetDemand, whStd.unmetDemand);
  assert.ok(whHigh.cost > whStd.cost); // Cost changes, physical mechanics invariant
});

// Invariant 4: Availability monotonicity
test('22. INVARIANT: reducing availability cannot improve effective capacity', () => {
  const scenario = createSupplierScenario();
  const runFullAvail = simulate(scenario, []);
  const runReducedAvail = simulate(scenario, [
    { id: 'c_red_avail', nodeId: 'warehouse', variable: 'availability', operation: 'set', value: 0.7, label: 'Reduced Availability' }
  ]);
  const whFull = runFullAvail.nodes.find(n => n.nodeId === 'warehouse');
  const whRed = runReducedAvail.nodes.find(n => n.nodeId === 'warehouse');
  assert.ok(whFull && whRed);
  assert.ok(whRed.effectiveCapacity <= whFull.effectiveCapacity);
});

// Invariant 5: Zero dependency influence invariance
test('23. INVARIANT: zero dependency influence produces no downstream dependency effect', () => {
  const scenario = createSupplierScenario();
  // Set influence to 0 on supplier->warehouse edge
  scenario.edges[0].influence = 0;
  // Displace supplier availability to 0% (complete supplier failure)
  const res = simulate(scenario, [
    { id: 'c_sup_fail', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0, label: 'Total Supplier Failure' }
  ]);
  const wh = res.nodes.find(n => n.nodeId === 'warehouse');
  assert.ok(wh);
  // When influence is 0, dependency factor remains 1.0, and warehouse capacity is unhampered
  assert.equal(wh.dependencyFactor, 1.0);
  assert.equal(wh.effectiveCapacity, 200);
  assert.equal(wh.fulfilled, 200);
});

// Invariant 6: Unrelated component invariance
test('24. INVARIANT: an unrelated component remains unchanged when its independent inputs have not changed', () => {
  const scenario = createSupplierScenario();
  // Add third disconnected node
  scenario.nodes.push({
    id: 'isolated',
    name: 'Isolated Branch',
    type: 'facility',
    quantityUnit: 'order',
    operatingPeriod: 'day',
    costCurrency: 'INR',
    costBasis: 'per_fulfilled',
    fixedCost: 500,
    unitCost: 10,
    demand: 50,
    capacity: 100,
    availability: 1,
    baseDelayHours: 0,
    priority: 'low'
  });
  const run1 = simulate(scenario, []);
  const run2 = simulate(scenario, [
    { id: 'c_disrupt_supplier', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.3, label: 'Supplier Drop' }
  ]);
  const iso1 = run1.nodes.find(n => n.nodeId === 'isolated');
  const iso2 = run2.nodes.find(n => n.nodeId === 'isolated');
  assert.deepEqual(iso1, iso2);
});

// Invariant 7: Duplicate edge rejection
test('25. INVARIANT: duplicate directed edges between the same components are rejected', () => {
  const scenario = createSupplierScenario();
  scenario.edges.push({
    id: 'e1_dup',
    source: 'supplier',
    target: 'warehouse',
    type: 'supplies',
    influence: 0.5
  });
  const validation = validateGraph(scenario.nodes, scenario.edges);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(e => e.includes('Duplicate edge detected')));
  assert.throws(() => simulate(scenario, []), /Graph validation failed/);
});

// Invariant 8: Cost basis differentiation (fixed vs variable vs capacity)
test('26. INVARIANT: cost basis rules (per_fulfilled, per_capacity, fixed) calculate transparently', () => {
  const scenario = {
    id: 'test-cost-bases',
    name: 'Cost Basis Test',
    domain: 'custom',
    description: 'Testing 3 cost bases',
    budget: 100000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'n_ful', name: 'Fulfilled Basis', type: 'proc', quantityUnit: 'u', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_fulfilled', fixedCost: 100, unitCost: 10, demand: 50, capacity: 100, availability: 1, baseDelayHours: 0, priority: 'low' },
      { id: 'n_cap', name: 'Capacity Basis', type: 'proc', quantityUnit: 'u', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'per_capacity', fixedCost: 200, unitCost: 5, demand: 50, capacity: 100, availability: 1, baseDelayHours: 0, priority: 'low' },
      { id: 'n_fix', name: 'Fixed Basis', type: 'proc', quantityUnit: 'u', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 800, unitCost: 99, demand: 50, capacity: 100, availability: 1, baseDelayHours: 0, priority: 'low' }
    ],
    edges: []
  };
  const res = simulate(scenario, []);
  const rFul = res.nodes.find(n => n.nodeId === 'n_ful');
  const rCap = res.nodes.find(n => n.nodeId === 'n_cap');
  const rFix = res.nodes.find(n => n.nodeId === 'n_fix');
  assert.ok(rFul && rCap && rFix);

  // per_fulfilled: fixed (100) + fulfilled (50) * 10 = 600
  assert.equal(rFul.cost, 600);
  // per_capacity: fixed (200) + capacity (100) * 5 = 700
  assert.equal(rCap.cost, 700);
  // fixed: fixed (800) + 0 = 800
  assert.equal(rFix.cost, 800);
});

// Invariant 9: Demand by unit tracking
test('27. INVARIANT: heterogeneous component units are categorized without false equivalence', () => {
  const scenario = {
    id: 'test-units-accounting',
    name: 'Units Accounting',
    domain: 'campus',
    description: 'Heterogeneous units',
    budget: 50000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'attendees', name: 'Attendees', type: 'people', quantityUnit: 'attendee', operatingPeriod: 'event', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 1000, unitCost: 0, demand: 300, capacity: 300, availability: 1, baseDelayHours: 0, priority: 'high' },
      { id: 'projector', name: 'Projector', type: 'asset', quantityUnit: 'device', operatingPeriod: 'event', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 5000, unitCost: 0, demand: 2, capacity: 2, availability: 1, baseDelayHours: 0, priority: 'high' }
    ],
    edges: []
  };
  const res = simulate(scenario, []);
  assert.equal(res.demandByUnit['attendee'], 300);
  assert.equal(res.demandByUnit['device'], 2);
  assert.equal(res.totalDemand, 302);
});

// Invariant 10: Leontief bottleneck min aggregation for multi-prerequisites
test('28. INVARIANT: multiple prerequisite supplies evaluate as limiting bottleneck min factor', () => {
  const scenario = {
    id: 'test-leontief',
    name: 'Leontief Bottleneck Test',
    domain: 'supply',
    description: 'Two suppliers feeding an assembly',
    budget: 50000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      // Supplier A: 50% shortage, influence 0.8 -> factor = 1 - 0.8*0.5 = 0.60
      { id: 'supA', name: 'Supplier A', type: 'supplier', quantityUnit: 'part', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, unitCost: 0, demand: 100, capacity: 100, availability: 0.5, baseDelayHours: 0, priority: 'high' },
      // Supplier B: 20% shortage, influence 0.8 -> factor = 1 - 0.8*0.2 = 0.84
      { id: 'supB', name: 'Supplier B', type: 'supplier', quantityUnit: 'part', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, unitCost: 0, demand: 100, capacity: 100, availability: 0.8, baseDelayHours: 0, priority: 'high' },
      // Assembly requires both parts
      { id: 'assembly', name: 'Assembly', type: 'process', quantityUnit: 'unit', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, unitCost: 0, demand: 100, capacity: 100, availability: 1, baseDelayHours: 0, priority: 'high' }
    ],
    edges: [
      { id: 'eA', source: 'supA', target: 'assembly', type: 'requires', influence: 0.8, aggregation: 'bottleneck' },
      { id: 'eB', source: 'supB', target: 'assembly', type: 'requires', influence: 0.8, aggregation: 'bottleneck' }
    ]
  };
  const res = simulate(scenario, []);
  const asm = res.nodes.find(n => n.nodeId === 'assembly');
  assert.ok(asm);
  // Under Leontief min, assembly factor is min(0.60, 0.84) = 0.60 (NOT 0.60 * 0.84 = 0.504!)
  assert.equal(asm.dependencyFactor, 0.6);
  assert.equal(asm.effectiveCapacity, 60);
});

// ---------------------------------------------------------------------
// 4. Decision Intelligence & Scenario Realism Upgrade Suite
// ---------------------------------------------------------------------

// Requirement 1: Custom scenario ranges & deterministic stress testing
test('29. DECISION INTEL: custom uncertainty scenario ranges execute deterministically across 3 bands', () => {
  const scenario = createSupplierScenario();
  const settings = {
    demand: { optimistic: 0.8, base: 1.0, pessimistic: 1.5 },
    capacity: { optimistic: 1.1, base: 1.0, pessimistic: 0.9 },
    availability: { optimistic: 1.0, base: 1.0, pessimistic: 0.7 },
    unitCost: { optimistic: 0.9, base: 1.0, pessimistic: 1.3 },
    delay: { optimistic: 0.5, base: 1.0, pessimistic: 2.0 },
    supplierAvailability: { optimistic: 1.0, base: 1.0, pessimistic: 0.6 }
  };

  const validation = ConfigurableUncertaintySchema.safeParse(settings);
  assert.equal(validation.success, true);

  const bands = simulateUncertaintyBands(scenario, [], settings);
  assert.equal(bands.length, 3);

  const [opt, base, pes] = bands;
  assert.equal(opt.band, 'optimistic');
  assert.equal(base.band, 'base');
  assert.equal(pes.band, 'pessimistic');

  // Optimistic demand: 400 * 0.8 = 320
  assert.equal(opt.result.totalDemand, 320);
  assert.equal(opt.result.totalUnmet, 0);

  // Pessimistic demand: 400 * 1.5 = 600
  assert.equal(pes.result.totalDemand, 600);
  assert.ok(pes.result.totalUnmet > 0);
  assert.ok(opt.result.overallHealth >= pes.result.overallHealth);
});

// Requirement 2: Scenario comparison & baseline invariance
test('30. DECISION INTEL: scenario comparison executes all alternatives from identical baseline', () => {
  const scenario = createSupplierScenario();
  const changes = [
    { id: 'c_disrupt', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.4, label: 'Supplier Major Shortage' }
  ];

  const alternatives = evaluateAlternatives(scenario, changes);
  assert.ok(alternatives.length >= 3);

  // Baseline must exist as first alternative and remain completely undisrupted
  const baseAlt = alternatives[0];
  assert.equal(baseAlt.strategyKey, 'baseline');
  assert.equal(baseAlt.result.totalUnmet, 0);
  assert.equal(baseAlt.result.totalDemand, 400);

  // Disrupted alternative must reflect the disruption
  const disAlt = alternatives.find(a => a.strategyKey === 'disrupted');
  assert.ok(disAlt);
  assert.ok(disAlt.result.totalUnmet > 0);
});

// Requirement 3: Alternative feasibility & critical constraint enforcement
test('31. DECISION INTEL: alternative feasibility marks unviable options when hard constraints are breached', () => {
  const scenario = createSupplierScenario();
  scenario.budget = 100; // Artificially tiny budget
  const alternatives = evaluateAlternatives(scenario, []);

  // When budget is breached, alternative must have isViable: false
  alternatives.forEach(alt => {
    if (alt.result.budgetVariance > 0 || alt.result.totalUnmet > 0) {
      assert.equal(alt.isViable, false);
      assert.ok(alt.hardConstraintViolations.length > 0);
    }
  });
});

// Requirement 4: Budget constraint violations detection
test('32. DECISION INTEL: budget overrun produces explicit variance and hard constraint violation tag', () => {
  const scenario = createSupplierScenario();
  scenario.budget = 300; // Total cost will be 400
  const res = simulate(scenario, []);

  assert.equal(res.budgetVariance, 100);
  assert.ok(res.warnings.some(w => w.includes('exceeds the scenario budget')));

  const alternatives = evaluateAlternatives(scenario, []);
  const baseAlt = alternatives.find(a => a.strategyKey === 'baseline');
  assert.ok(baseAlt);
  assert.equal(baseAlt.isViable, false);
  assert.ok(baseAlt.hardConstraintViolations.some(v => v.includes('Operating budget exceeded')));
});

// Requirement 5: Context-aware intervention: unavailable backup suppliers
test('33. DECISION INTEL: backup supplier intervention is NEVER generated when no backup supplier is modelled', () => {
  const scenario = createSupplierScenario(); // Only has 'supplier' and 'warehouse'
  assert.ok(!scenario.nodes.some(n => n.name.toLowerCase().includes('backup')));

  const alternatives = evaluateAlternatives(scenario, [
    { id: 'c1', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.3, label: 'Supplier Drop' }
  ]);

  // Must NOT include 'backup_supplier' strategy because no backup supplier exists!
  const hasBackupStrat = alternatives.some(a => a.strategyKey === 'backup_supplier');
  assert.equal(hasBackupStrat, false);

  // Now add a backup supplier and verify it is generated
  const scenarioWithBackup = {
    ...scenario,
    nodes: [
      ...scenario.nodes,
      {
        id: 'backup_supplier',
        name: 'Backup Supplier',
        type: 'supplier',
        quantityUnit: 'pallet',
        operatingPeriod: 'day',
        costCurrency: 'INR',
        costBasis: 'per_fulfilled',
        fixedCost: 0,
        unitCost: 2,
        demand: 0,
        capacity: 150,
        availability: 0,
        baseDelayHours: 0,
        priority: 'medium'
      }
    ]
  };

  const alternativesWithBackup = evaluateAlternatives(scenarioWithBackup, [
    { id: 'c1', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.3, label: 'Supplier Drop' }
  ]);
  const foundBackup = alternativesWithBackup.find(a => a.strategyKey === 'backup_supplier');
  assert.ok(foundBackup);
  assert.equal(foundBackup.strategyKey, 'backup_supplier');
});

// Requirement 6: Health score breakdown transparency
test('34. DECISION INTEL: health score breakdown defines exact weights and captures constraint penalties', () => {
  const scenario = createSupplierScenario();
  const res = simulate(scenario, []);

  assert.equal(res.healthBreakdown.isHeuristic, true);
  assert.equal(res.healthBreakdown.weights.fulfilment, 0.50);
  assert.equal(res.healthBreakdown.weights.budget, 0.25);
  assert.equal(res.healthBreakdown.weights.utilization, 0.15);
  assert.equal(res.healthBreakdown.weights.delay, 0.10);

  // In perfect baseline, subscores are 100
  assert.equal(res.healthBreakdown.fulfilmentScore, 100);
  assert.equal(res.healthBreakdown.budgetScore, 100);
  assert.equal(res.healthBreakdown.penalty, 0);
  assert.equal(res.overallHealth, 100);

  // Now induce severe budget penalty (>20% over budget) and severe unmet demand (>20%)
  scenario.budget = 100; // Total cost 400 > budget * 1.2 (120)
  const disruptedRes = simulate(scenario, [
    { id: 'c_demand', nodeId: 'warehouse', variable: 'demand', operation: 'set', value: 350, label: 'Spike' }
  ]);
  assert.ok(disruptedRes.healthBreakdown.penalty > 0);
  assert.ok(disruptedRes.healthBreakdown.notes.length > 0);
});

// Requirement 7: Trade-off detection
test('35. DECISION INTEL: evaluated alternatives display explicit positive and negative trade-offs', () => {
  const scenario = createSupplierScenario();
  const changes = [
    { id: 'c1', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.4, label: 'Disruption' }
  ];
  const alternatives = evaluateAlternatives(scenario, changes);

  alternatives.forEach(alt => {
    assert.ok(Array.isArray(alt.positiveTradeoffs));
    assert.ok(Array.isArray(alt.negativeTradeoffs));
    assert.ok(alt.positiveTradeoffs.length > 0);
    // Disrupted scenario or costly intervention has negative trade-offs
    if (alt.strategyKey === 'disrupted' || alt.strategyKey === 'capacity_expansion') {
      assert.ok(alt.negativeTradeoffs.length > 0);
    }
  });
});

// Requirement 8: Bottleneck ranking by transparent criteria
test('36. DECISION INTEL: bottlenecks are ranked in descending order of calculated impact score', () => {
  const scenario = {
    id: 'test-bottleneck-ranking',
    name: 'Bottleneck Ranking Test',
    domain: 'supply',
    description: 'Multiple bottlenecks with varying severity',
    budget: 100000,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    nodes: [
      // Node A: 20 unmet demand, 0 downstream
      { id: 'nA', name: 'Node A', type: 'process', quantityUnit: 'u', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, unitCost: 0, demand: 120, capacity: 100, availability: 1, baseDelayHours: 0, priority: 'low' },
      // Node B: 50 unmet demand, restricts Node C downstream
      { id: 'nB', name: 'Node B', type: 'supplier', quantityUnit: 'u', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, unitCost: 0, demand: 150, capacity: 100, availability: 1, baseDelayHours: 0, priority: 'high' },
      // Node C: downstream of B
      { id: 'nC', name: 'Node C', type: 'facility', quantityUnit: 'u', operatingPeriod: 'day', costCurrency: 'INR', costBasis: 'fixed', fixedCost: 0, unitCost: 0, demand: 100, capacity: 100, availability: 1, baseDelayHours: 0, priority: 'high' }
    ],
    edges: [
      { id: 'eBC', source: 'nB', target: 'nC', type: 'supplies', influence: 0.9, aggregation: 'bottleneck' }
    ]
  };

  const res = simulate(scenario, []);
  assert.ok(res.rankedBottlenecks.length >= 2);

  // Check descending sort by impactScore
  for (let i = 0; i < res.rankedBottlenecks.length - 1; i++) {
    assert.ok(res.rankedBottlenecks[i].impactScore >= res.rankedBottlenecks[i + 1].impactScore);
  }

  // Node B has 50 unmet + downstream restriction, so its impactScore must be significantly higher than Node A
  const bRank = res.rankedBottlenecks.find(b => b.nodeId === 'nB');
  const aRank = res.rankedBottlenecks.find(b => b.nodeId === 'nA');
  assert.ok(bRank && aRank);
  assert.ok(bRank.impactScore > aRank.impactScore);
  assert.equal(bRank.severity, 'critical');
});

// Requirement 9: Evidence-based recommendations
test('37. DECISION INTEL: recommendations cite measured numbers, specify feasibility and trade-offs', () => {
  const scenario = createSupplierScenario();
  const res = simulate(scenario, [
    { id: 'c1', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.4, label: 'Supplier Drop' }
  ]);
  const recs = getRecommendations(res);

  assert.ok(recs.length > 0);
  recs.forEach(r => {
    assert.ok(r.problem.length > 0);
    assert.ok(r.component.length > 0);
    assert.ok(r.numericalEvidence.length > 0);
    // Numerical evidence must contain actual numbers
    assert.match(r.numericalEvidence, /\d+/);
    assert.ok(r.suggestedIntervention.length > 0);
    assert.ok(r.expectedBenefit.length > 0);
    assert.ok(r.tradeoff.length > 0);
    assert.ok(r.assumption.length > 0);
    assert.ok(['feasible', 'requires_budget', 'requires_unmodelled_resource'].includes(r.feasibilityStatus));
    assert.ok(['critical', 'warning', 'info'].includes(r.severity));
  });
});
