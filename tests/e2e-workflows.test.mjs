import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, validateGraph, simulateUncertaintyBands } from '../src/engine/simulation.ts';
import { evaluateAlternatives, getRecommendations } from '../src/engine/advisor.ts';
import { templates } from '../src/data/templates.ts';

// Deep clone helper
const clone = (obj) => JSON.parse(JSON.stringify(obj));
const getTemplate = (id) => clone(templates.find(t => t.id === id));

// Workflow A: Campus Event - Attendance Surge (+40% demand on registration)
test('Workflow A: Campus Event - Attendance Surge (+40% demand on registration)', () => {
  const scenario = getTemplate('campus-demo');
  const baseRes = simulate(scenario, []);
  
  // Apply surge to registration to exceed capacity 300
  const surgeChange = [
    { id: 'c1', nodeId: 'registration', variable: 'demand', operation: 'set', value: 350, label: 'Attendance Surge' }
  ];
  const surgeRes = simulate(scenario, surgeChange);
  
  const regNode = surgeRes.nodes.find(n => n.nodeId === 'registration');
  assert.ok(regNode, 'registration node result must exist');
  assert.equal(regNode.demand, 350);
  assert.equal(regNode.effectiveCapacity, 300);
  assert.equal(regNode.unmetDemand, 50);
  assert.ok(surgeRes.bottlenecks.length > 0, 'Bottleneck detected');
  assert.ok(surgeRes.overallHealth < baseRes.overallHealth, 'Health score dropped');
});

// Workflow B: Campus Event - Volunteer Shortage (-50% capacity on volunteers)
test('Workflow B: Campus Event - Volunteer Shortage (-50% capacity on volunteers)', () => {
  const scenario = getTemplate('campus-demo');
  const baseRes = simulate(scenario, []);
  
  const shortageChange = [
    { id: 'c2', nodeId: 'volunteers', variable: 'capacity', operation: 'set', value: 15, label: 'Volunteer Shortage' }
  ];
  const shortRes = simulate(scenario, shortageChange);
  
  const volNode = shortRes.nodes.find(n => n.nodeId === 'volunteers');
  assert.ok(volNode, 'volunteers node result must exist');
  assert.equal(volNode.effectiveCapacity, 15);
  assert.ok(volNode.unmetDemand > 0);
  assert.ok(shortRes.overallHealth < baseRes.overallHealth);
});

// Workflow C: Invariant Check - Unit cost increase affects cost without altering physical capacity/demand
test('Workflow C: Invariant Check - Unit cost increase affects cost without altering physical capacity/demand', () => {
  const scenario = getTemplate('business-demo');
  const baseRes = simulate(scenario, []);
  
  // supplier has costBasis: 'per_fulfilled', unitCost: 120
  const costChange = [
    { id: 'c3', nodeId: 'supplier', variable: 'unitCost', operation: 'set', value: 240, label: 'Supplier Cost Double' }
  ];
  const costRes = simulate(scenario, costChange);
  
  // Total cost must increase
  assert.ok(costRes.totalCost > baseRes.totalCost, `Total cost must increase (${costRes.totalCost} > ${baseRes.totalCost})`);
  
  const supBase = baseRes.nodes.find(n => n.nodeId === 'supplier');
  const supCost = costRes.nodes.find(n => n.nodeId === 'supplier');
  assert.ok(supBase && supCost);
  
  // Physical capacity and demand must remain identical
  assert.equal(supCost.effectiveCapacity, supBase.effectiveCapacity);
  assert.equal(supCost.demand, supBase.demand);
  assert.equal(supCost.unmetDemand, supBase.unmetDemand);
});

// Workflow D: Supplier Disruption & Decision Map
test('Workflow D: Supply Chain - Supplier disruption propagates downstream', () => {
  const scenario = getTemplate('supply-demo');
  const baseRes = simulate(scenario, []);
  
  const disruptChange = [
    { id: 'c4', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.4, label: 'Supplier Disruption' }
  ];
  const disRes = simulate(scenario, disruptChange);
  
  const supBase = baseRes.nodes.find(n => n.nodeId === 'supplier');
  const supDis = disRes.nodes.find(n => n.nodeId === 'supplier');
  const whBase = baseRes.nodes.find(n => n.nodeId === 'warehouse');
  const whDis = disRes.nodes.find(n => n.nodeId === 'warehouse');
  
  assert.ok(supBase && supDis && whBase && whDis);
  // Supplier effective capacity drops
  assert.ok(supDis.effectiveCapacity < supBase.effectiveCapacity);
  // Downstream warehouse effective capacity drops due to supplies dependency
  assert.ok(whDis.effectiveCapacity <= whBase.effectiveCapacity);
  assert.ok(disRes.overallHealth < baseRes.overallHealth);
});

// Workflow E: Uncertainty Bands Stress-Testing
test('Workflow E: Uncertainty stress-testing computes optimistic, base, pessimistic bands', () => {
  const scenario = getTemplate('business-demo');
  const bands = simulateUncertaintyBands(scenario, []);
  
  assert.equal(bands.length, 3);
  const [opt, base, pes] = bands;
  assert.equal(opt.band, 'optimistic');
  assert.equal(base.band, 'base');
  assert.equal(pes.band, 'pessimistic');
  
  // Health score ordering: optimistic >= base >= pessimistic
  assert.ok(opt.result.overallHealth >= base.result.overallHealth);
  assert.ok(base.result.overallHealth >= pes.result.overallHealth);
  
  // Unmet demand ordering: pessimistic >= base
  assert.ok(pes.result.totalUnmet >= base.result.totalUnmet);
});

// Workflow F: Alternative Interventions Feasibility
test('Workflow F: Alternative interventions generated are viable and deterministic', () => {
  const scenario = getTemplate('campus-demo');
  // Induce a bottleneck change
  const changes = [
    { id: 'c5', nodeId: 'registration', variable: 'demand', operation: 'set', value: 400, label: 'Large Surge' }
  ];
  const currentRes = simulate(scenario, changes);
  const alts = evaluateAlternatives(scenario, changes);
  
  assert.ok(Array.isArray(alts), 'Returns array of alternatives');
  assert.ok(alts.length > 0, 'Generates at least one alternative strategy');
  
  for (const alt of alts) {
    assert.ok(alt.name, 'Alternative has name');
    assert.ok(typeof alt.isViable === 'boolean', 'Has boolean feasibility');
    assert.ok(typeof alt.result.totalCost === 'number', 'Has cost impact');
    assert.ok(Array.isArray(alt.positiveTradeoffs), 'Provides positive tradeoffs');
    assert.ok(Array.isArray(alt.negativeTradeoffs), 'Provides negative tradeoffs');
    assert.ok(alt.result, 'Includes simulated outcome');
  }

  const recs = getRecommendations(currentRes);
  assert.ok(Array.isArray(recs), 'Recommendations generated');
  assert.ok(recs.length > 0, 'At least one recommendation present');
});

// Workflow G: Circular Dependency Detection & Rejection
test('Workflow G: Circular dependency validation rejects cycle before simulation', () => {
  const scenario = getTemplate('campus-demo');
  // Add a cycle: experience -> registration
  const cyclicEdges = [
    ...scenario.edges,
    {
      id: 'cycle-edge',
      source: 'experience',
      target: 'registration',
      type: 'requires',
      influence: 1
    }
  ];
  
  const validation = validateGraph(scenario.nodes, cyclicEdges);
  assert.equal(validation.valid, false, 'Validation must fail for cyclic graph');
  assert.ok(validation.errors.some(e => e.toLowerCase().includes('circular') || e.toLowerCase().includes('cycle')), 'Cycle error reported');
});
