import type {
  Scenario,
  ScenarioChange,
  SimNode,
  SimulationResult,
  NodeResult,
  DependencyType,
  DependencyAggregation,
  HealthBreakdown,
  RankedBottleneck,
  ConfigurableUncertaintySettings,
  UncertaintyBandResult
} from '../types/index.ts';

export function detectCycle(nodes: SimNode[], edges: Scenario['edges']): string[] | null {
  const indegree = new Map(nodes.map(n => [n.id, 0]));
  const adj = new Map(nodes.map(n => [n.id, [] as string[]]));
  edges.forEach(e => {
    if (!indegree.has(e.source) || !indegree.has(e.target)) return;
    adj.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) || 0) + 1);
  });
  const q = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const next of adj.get(id) || []) {
      const d = (indegree.get(next) || 0) - 1;
      indegree.set(next, d);
      if (d === 0) q.push(next);
    }
  }
  if (order.length === nodes.length) return null;
  return [...indegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
}

export function validateGraph(nodes: SimNode[], edges: Scenario['edges']): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map(n => n.id));
  const seenEdges = new Set<string>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge '${edge.id}' references non-existent source node: '${edge.source}'`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge '${edge.id}' references non-existent target node: '${edge.target}'`);
    }
    if (edge.source === edge.target) {
      errors.push(`Self-loop detected on component '${edge.source}' via edge '${edge.id}'`);
    }
    const edgeKey = `${edge.source}__${edge.target}`;
    if (seenEdges.has(edgeKey)) {
      errors.push(`Duplicate edge detected between '${edge.source}' and '${edge.target}'`);
    }
    seenEdges.add(edgeKey);
  }

  const cycle = detectCycle(nodes, edges);
  if (cycle) {
    errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
  }
  return { valid: errors.length === 0, errors };
}

export function topologicalOrder(nodes: SimNode[], edges: Scenario['edges']): string[] {
  const indegree = new Map(nodes.map(n => [n.id, 0]));
  const adj = new Map(nodes.map(n => [n.id, [] as string[]]));
  edges.forEach(e => {
    if (adj.has(e.source) && indegree.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      indegree.set(e.target, (indegree.get(e.target) || 0) + 1);
    }
  });
  const q = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const next of adj.get(id) || []) {
      const d = (indegree.get(next) || 0) - 1;
      indegree.set(next, d);
      if (d === 0) q.push(next);
    }
  }
  return order;
}

export function clamp(n: number, min = 0, max = 1): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function applyChanges(nodes: SimNode[], changes: ScenarioChange[]): SimNode[] {
  return nodes.map(node => {
    const updated = { ...node };
    changes.filter(c => c.nodeId === node.id).forEach(c => {
      const current = updated[c.variable];
      const next = c.operation === 'set'
        ? c.value
        : c.operation === 'add'
          ? Number(current) + c.value
          : Number(current) * c.value;

      if (c.variable === 'availability') {
        updated.availability = clamp(next, 0, 1);
      } else {
        (updated as any)[c.variable] = Math.max(0, next);
      }
    });
    return updated;
  });
}

export interface EdgePropagationResult {
  factor: number;
  delay: number;
  additionalCost: number;
  note: string;
}

export function propagateSingleEdge(
  edge: Scenario['edges'][number],
  upstream: NodeResult
): EdgePropagationResult {
  const influence = clamp(edge.influence, 0, 1);
  const shortageRatio = upstream.demand > 0
    ? clamp(1 - (upstream.fulfilled / upstream.demand), 0, 1)
    : (upstream.effectiveCapacity === 0 && upstream.availabilityFactor === 0 ? 1 : 0);

  const baseDelay = edge.basePropagationDelayHours ?? 0;
  const shortageDelay = edge.shortageDelayHours ?? 0;
  const unitSurcharge = edge.additionalUnitCost ?? 0;

  switch (edge.type) {
    case 'supplies': {
      const factor = 1 - (influence * shortageRatio);
      const delay = (upstream.delayHours + baseDelay) * influence;
      const note = `Supply: upstream shortage ${(shortageRatio * 100).toFixed(0)}% (influence ${(influence * 100).toFixed(0)}%) yields capacity factor ${factor.toFixed(2)}.`;
      return { factor, delay, additionalCost: 0, note };
    }
    case 'requires': {
      const factor = 1 - (influence * shortageRatio);
      const delay = (upstream.delayHours + baseDelay) * influence;
      const note = `Prerequisite: upstream shortfall reduced downstream capacity factor to ${factor.toFixed(2)}.`;
      return { factor, delay, additionalCost: 0, note };
    }
    case 'supports': {
      const factor = 1 - (influence * shortageRatio);
      const delay = (upstream.delayHours * 0.5 + baseDelay) * influence;
      const note = `Support: upstream performance lowered assisted capacity factor to ${factor.toFixed(2)}.`;
      return { factor, delay, additionalCost: 0, note };
    }
    case 'delays': {
      const delay = (upstream.delayHours + baseDelay + (shortageRatio * shortageDelay)) * influence;
      const note = `Delay: upstream delay (${upstream.delayHours.toFixed(1)}h) and shortage propagated ${delay.toFixed(1)}h downstream lag.`;
      return { factor: 1, delay, additionalCost: 0, note };
    }
    case 'increases_cost': {
      const additionalCost = upstream.unmetDemand * unitSurcharge * influence;
      const note = additionalCost > 0
        ? `Cost pressure: added ₹${additionalCost.toFixed(0)} surcharge from ${upstream.name} unmet demand.`
        : `Cost pressure: potential cost pressure from ${upstream.name} (qualitative warning, no surcharge rate configured).`;
      return { factor: 1, delay: 0, additionalCost, note };
    }
  }
}

/**
 * Computes all downstream node IDs reachable from a given node ID in the scenario DAG.
 */
export function getDownstreamReachableNodes(startNodeId: string, edges: Scenario['edges']): string[] {
  const adj = new Map<string, string[]>();
  edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  });

  const visited = new Set<string>();
  const queue = [...(adj.get(startNodeId) || [])];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (!visited.has(curr)) {
      visited.add(curr);
      for (const next of adj.get(curr) || []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
  }
  return Array.from(visited);
}

export function simulate(scenario: Scenario, changes: ScenarioChange[] = [], label = 'Scenario'): SimulationResult {
  const warnings: string[] = [];
  const validation = validateGraph(scenario.nodes, scenario.edges);
  if (!validation.valid) {
    throw new Error(`Graph validation failed: ${validation.errors.join('; ')}`);
  }

  // Clone nodes and apply changes without mutating baseline
  const nodes = applyChanges(scenario.nodes, changes);
  const order = topologicalOrder(nodes, scenario.edges);
  const resultById = new Map<string, NodeResult>();
  const changedIds = new Set(changes.map(c => c.nodeId));
  const impacted = new Set<string>(changedIds);
  const nodeResults: NodeResult[] = [];

  for (const id of order) {
    const node = nodes.find(n => n.id === id)!;
    const incoming = scenario.edges.filter(e => e.target === id);

    let bottleneckFactor = 1.0;
    let supportFactor = 1.0;
    const parallelDelays: number[] = [];
    let edgeSurcharge = 0;
    const trace: string[] = [];

    // Separate incoming edges by semantics
    const supplyAndReqEdges = incoming.filter(e => e.type === 'supplies' || e.type === 'requires');
    const supportEdges = incoming.filter(e => e.type === 'supports');
    const delayEdges = incoming.filter(e => e.type === 'delays');
    const costEdges = incoming.filter(e => e.type === 'increases_cost');

    // 1. Process supplies & requires (Leontief bottleneck: min factor)
    if (supplyAndReqEdges.length > 0) {
      const factors: number[] = [];
      supplyAndReqEdges.forEach(edge => {
        const upstream = resultById.get(edge.source);
        if (!upstream) return;
        const res = propagateSingleEdge(edge, upstream);
        factors.push(res.factor);
        if (res.delay > 0) parallelDelays.push(res.delay);
        if (upstream.affected || changedIds.has(edge.source)) impacted.add(id);
        trace.push(`${upstream.name} → ${node.name}: ${res.note}`);
      });
      bottleneckFactor = factors.length > 0 ? Math.min(...factors) : 1.0;
    }

    // 2. Process supports (multiplicative independent factors)
    if (supportEdges.length > 0) {
      supportEdges.forEach(edge => {
        const upstream = resultById.get(edge.source);
        if (!upstream) return;
        const res = propagateSingleEdge(edge, upstream);
        supportFactor *= res.factor;
        if (res.delay > 0) parallelDelays.push(res.delay);
        if (upstream.affected || changedIds.has(edge.source)) impacted.add(id);
        trace.push(`${upstream.name} → ${node.name}: ${res.note}`);
      });
    }

    // 3. Process delays (Critical Path Method: parallel incoming delays evaluate as max)
    if (delayEdges.length > 0) {
      delayEdges.forEach(edge => {
        const upstream = resultById.get(edge.source);
        if (!upstream) return;
        const res = propagateSingleEdge(edge, upstream);
        parallelDelays.push(res.delay);
        if (upstream.affected || changedIds.has(edge.source)) impacted.add(id);
        trace.push(`${upstream.name} → ${node.name}: ${res.note}`);
      });
    }

    // 4. Process increases_cost
    if (costEdges.length > 0) {
      costEdges.forEach(edge => {
        const upstream = resultById.get(edge.source);
        if (!upstream) return;
        const res = propagateSingleEdge(edge, upstream);
        edgeSurcharge += res.additionalCost;
        if (upstream.affected || changedIds.has(edge.source)) impacted.add(id);
        trace.push(`${upstream.name} → ${node.name}: ${res.note}`);
      });
    }

    const dependencyFactor = clamp(bottleneckFactor * supportFactor, 0, 1);
    const availabilityFactor = clamp(node.availability, 0, 1);
    const effectiveCapacity = Math.max(0, node.capacity * availabilityFactor * dependencyFactor);
    const fulfilled = Math.min(node.demand, effectiveCapacity);
    const unmetDemand = Math.max(0, node.demand - fulfilled);

    // Safe utilization calculation
    const utilization = effectiveCapacity > 0
      ? (node.demand / effectiveCapacity) * 100
      : (node.demand > 0 ? 100 : 0);

    // Explicit Cost Semantics:
    const fixedCost = Math.max(0, node.fixedCost ?? 0);
    const unitCost = Math.max(0, node.unitCost ?? 0);
    let variableCost = 0;
    const basis = node.costBasis || 'per_fulfilled';

    switch (basis) {
      case 'per_fulfilled':
        variableCost = fulfilled * unitCost;
        break;
      case 'per_demanded':
        variableCost = node.demand * unitCost;
        break;
      case 'per_capacity':
        variableCost = node.capacity * unitCost;
        break;
      case 'fixed':
        variableCost = 0;
        break;
    }
    const totalNodeCost = fixedCost + variableCost + edgeSurcharge;

    // Critical Path Delay: base delay + maximum of parallel incoming delays
    const criticalIncomingDelay = parallelDelays.length > 0 ? Math.max(...parallelDelays) : 0;
    const delayHours = Math.max(0, (node.baseDelayHours ?? 0) + criticalIncomingDelay);

    const isAffected = changedIds.has(id) ||
      impacted.has(id) ||
      unmetDemand > 0 ||
      delayHours > (node.baseDelayHours ?? 0);

    const nr: NodeResult = {
      nodeId: id,
      name: node.name,
      quantityUnit: node.quantityUnit || 'units',
      operatingPeriod: node.operatingPeriod || 'day',
      effectiveCapacity,
      demand: node.demand,
      fulfilled,
      unmetDemand,
      utilization,
      fixedCost,
      variableCost,
      unitCost,
      cost: totalNodeCost,
      delayHours,
      dependencyFactor,
      availabilityFactor,
      directImpact: changedIds.has(id),
      affected: isAffected,
      trace
    };

    resultById.set(id, nr);
    nodeResults.push(nr);
  }

  // Aggregate metrics
  const totalDemand = nodeResults.reduce((s, n) => s + n.demand, 0);
  const totalFulfilled = nodeResults.reduce((s, n) => s + n.fulfilled, 0);
  const totalUnmet = nodeResults.reduce((s, n) => s + n.unmetDemand, 0);
  const totalCost = nodeResults.reduce((s, n) => s + n.cost, 0);
  const budgetVariance = totalCost - scenario.budget;

  // Breakdown demand by unit for transparency across heterogeneous stages
  const demandByUnit: Record<string, number> = {};
  nodeResults.forEach(n => {
    const u = n.quantityUnit || 'units';
    demandByUnit[u] = (demandByUnit[u] || 0) + n.demand;
  });

  const active = nodeResults.filter(n => n.demand > 0 || n.effectiveCapacity > 0);
  const averageUtilization = active.length
    ? active.reduce((s, n) => s + Math.min(150, n.utilization), 0) / active.length
    : 0;

  const totalDelays = nodeResults.reduce((s, n) => s + n.delayHours, 0);
  const averageDelay = nodeResults.length > 0 ? totalDelays / nodeResults.length : 0;

  // ---------------------------------------------------------
  // Transparent Heuristic Health Score Breakdown
  // Weights: Fulfilment 50%, Budget 25%, Utilization 15%, Delay 10%
  // ---------------------------------------------------------
  const fulfilmentRatio = totalDemand > 0 ? totalFulfilled / totalDemand : 1.0;
  const fulfilmentScore = Math.round(clamp(fulfilmentRatio, 0, 1) * 100);

  const budgetRatio = totalCost <= scenario.budget
    ? 1.0
    : scenario.budget > 0
      ? scenario.budget / totalCost
      : 0.0;
  const budgetScore = Math.round(clamp(budgetRatio, 0, 1) * 100);

  const utilizationScore = Math.round(
    averageUtilization <= 100
      ? 100
      : clamp(1 - ((averageUtilization - 100) / 50), 0, 1) * 100
  );

  const delayScore = Math.round(
    averageDelay <= 2
      ? 100
      : clamp(1 - ((averageDelay - 2) / 10), 0, 1) * 100
  );

  // Hard constraint penalties:
  // If budget variance is severe (>20% over budget) or unmet demand > 20%
  let penalty = 0;
  const healthNotes: string[] = [];
  if (budgetVariance > scenario.budget * 0.2 && scenario.budget > 0) {
    penalty += 10;
    healthNotes.push('Applied -10 penalty for operating budget overrun > 20%.');
  }
  if (totalDemand > 0 && (totalUnmet / totalDemand) > 0.2) {
    penalty += 15;
    healthNotes.push('Applied -15 penalty for aggregate unmet demand > 20%.');
  }

  const weightedSum = (fulfilmentScore * 0.50) +
    (budgetScore * 0.25) +
    (utilizationScore * 0.15) +
    (delayScore * 0.10);

  const overallHealth = Math.round(clamp((weightedSum - penalty) / 100, 0, 1) * 100);

  const healthBreakdown: HealthBreakdown = {
    overallHealth,
    fulfilmentScore,
    budgetScore,
    utilizationScore,
    delayScore,
    penalty,
    weights: {
      fulfilment: 0.50,
      budget: 0.25,
      utilization: 0.15,
      delay: 0.10
    },
    isHeuristic: true,
    notes: healthNotes
  };

  // ---------------------------------------------------------
  // Transparent Ranked Bottlenecks Identification
  // ---------------------------------------------------------
  const rankedBottlenecks: RankedBottleneck[] = nodeResults
    .map(n => {
      const downstreamNodes = getDownstreamReachableNodes(n.nodeId, scenario.edges);
      const downstreamImpactCount = downstreamNodes.length;

      // Transparent scoring criterion:
      // (unmetDemand * 1.0) + (downstreamImpactCount * 15) + (delayHours * 4) + (utilization > 95% ? 10 : 0)
      const impactScore = Math.round(
        (n.unmetDemand * 1.0) +
        (downstreamImpactCount * 15) +
        (n.delayHours * 4) +
        (n.utilization > 95 ? 10 : 0)
      );

      let severity: 'critical' | 'high' | 'medium' | 'low' = 'low';
      let reason = 'Component operating stably within nominal capacity.';

      if (n.unmetDemand > 0 && downstreamImpactCount > 0) {
        severity = 'critical';
        reason = `${n.unmetDemand.toFixed(1)} unmet units restricting ${downstreamImpactCount} downstream component(s).`;
      } else if (n.unmetDemand > 0 || n.utilization > 100) {
        severity = 'high';
        reason = n.unmetDemand > 0
          ? `${n.unmetDemand.toFixed(1)} unmet demand with ${n.utilization.toFixed(0)}% utilization.`
          : `Capacity exceeded at ${n.utilization.toFixed(0)}% utilization.`;
      } else if (n.utilization >= 95 && downstreamImpactCount > 0) {
        severity = 'medium';
        reason = `Near-capacity utilization (${n.utilization.toFixed(0)}%) with ${downstreamImpactCount} downstream dependencies.`;
      }

      return {
        nodeId: n.nodeId,
        name: n.name,
        unmetDemand: n.unmetDemand,
        utilization: n.utilization,
        downstreamImpactCount,
        propagatedDelay: n.delayHours,
        severity,
        impactScore,
        reason
      };
    })
    .filter(b => b.severity !== 'low')
    .sort((a, b) => b.impactScore - a.impactScore);

  const bottlenecks = rankedBottlenecks
    .filter(b => b.unmetDemand > 0 || b.utilization > 100)
    .map(b => b.name);

  const assumptionNotes = [
    'Dependency influence values are modelling assumptions unless calibrated by empirical operational data.',
    'Strict prerequisites (supplies, requires) aggregate using Leontief bottleneck limiting factors.',
    'Parallel incoming delays evaluate along the Critical Path (maximum delay) rather than summing independent lags.',
    'Operating costs reflect explicit fixed costs, configured cost basis, and explicit edge surcharges.',
    'Heterogeneous component units are tracked per unit category to avoid misleading aggregation.'
  ];

  if (budgetVariance > 0) {
    warnings.push(`Estimated cost exceeds the scenario budget by ${formatCurrency(budgetVariance, scenario.currency)}.`);
  }
  if (totalUnmet > 0) {
    warnings.push(`${totalUnmet.toFixed(1)} aggregate units of unmet demand detected across components.`);
  }
  if (nodeResults.some(n => n.utilization > 100)) {
    warnings.push('One or more components have demand exceeding effective capacity.');
  }

  const changeSummary = changes.map(c => {
    const nodeName = nodes.find(n => n.id === c.nodeId)?.name || c.nodeId;
    return `${c.label || `${c.variable} ${c.operation} ${c.value}`}: ${c.operation} ${c.value} on ${nodeName}`;
  });

  return {
    scenarioId: scenario.id,
    label,
    currency: scenario.currency || 'INR',
    nodes: nodeResults,
    totalDemand,
    demandByUnit,
    totalFulfilled,
    totalUnmet,
    totalCost,
    budget: scenario.budget,
    budgetVariance,
    averageUtilization,
    overallHealth,
    healthBreakdown,
    bottlenecks,
    rankedBottlenecks,
    impactedNodeIds: [...impacted],
    assumptionNotes,
    warnings,
    changeSummary
  };
}

export function formatCurrency(v: number, currency = 'INR'): string {
  if (Number.isNaN(v)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: 0
  }).format(v);
}

export const DEFAULT_UNCERTAINTY_SETTINGS: ConfigurableUncertaintySettings = {
  demand: { optimistic: 0.85, base: 1.0, pessimistic: 1.25 },
  capacity: { optimistic: 1.15, base: 1.0, pessimistic: 0.85 },
  availability: { optimistic: 1.0, base: 1.0, pessimistic: 0.80 },
  unitCost: { optimistic: 0.90, base: 1.0, pessimistic: 1.20 },
  delay: { optimistic: 0.50, base: 1.0, pessimistic: 2.00 },
  supplierAvailability: { optimistic: 1.0, base: 1.0, pessimistic: 0.75 }
};

export function simulateUncertaintyBands(
  scenario: Scenario,
  changes: ScenarioChange[] = [],
  settings: ConfigurableUncertaintySettings = DEFAULT_UNCERTAINTY_SETTINGS
): UncertaintyBandResult[] {
  const bands: Array<{
    band: 'optimistic' | 'base' | 'pessimistic';
    name: string;
    tone: string;
    description: string;
  }> = [
    {
      band: 'optimistic',
      name: 'Optimistic Stress Band',
      tone: '#10b981',
      description: 'Favorable operational assumptions: lower demand pressure, peak availability and stable vendor costs.'
    },
    {
      band: 'base',
      name: 'Nominal Base Conditions',
      tone: '#00f0ff',
      description: 'Standard operating baseline as configured with entered scenario disruptions.'
    },
    {
      band: 'pessimistic',
      name: 'Pessimistic Stress Band',
      tone: '#f43f5e',
      description: 'Adverse stress-test: surging demand, supply chain delays, degraded availability and cost escalation.'
    }
  ];

  return bands.map(({ band, name, tone, description }) => {
    const demandMult = settings.demand[band];
    const capacityMult = settings.capacity[band];
    const availMult = settings.availability[band];
    const costMult = settings.unitCost[band];
    const delayMult = settings.delay[band];
    const supplierAvailMult = settings.supplierAvailability ? settings.supplierAvailability[band] : availMult;

    // Apply baseline changes first to create disrupted baseline
    const baseDisruptedNodes = applyChanges(scenario.nodes, changes);

    // Deterministically scale variables per band
    const scaledNodes: SimNode[] = baseDisruptedNodes.map(node => {
      const isSupplier = node.type === 'supplier' || node.name.toLowerCase().includes('supplier');
      const nodeAvailMult = isSupplier ? supplierAvailMult : availMult;

      return {
        ...node,
        demand: Math.max(0, node.demand * demandMult),
        capacity: Math.max(0, node.capacity * capacityMult),
        availability: clamp(node.availability * nodeAvailMult, 0, 1),
        unitCost: Math.max(0, node.unitCost * costMult),
        baseDelayHours: Math.max(0, (node.baseDelayHours ?? 0) * delayMult)
      };
    });

    const scaledScenario: Scenario = {
      ...scenario,
      nodes: scaledNodes
    };

    const res = simulate(scaledScenario, [], name);

    return {
      band,
      name,
      tone,
      description,
      multipliers: {
        demand: demandMult,
        capacity: capacityMult,
        availability: availMult,
        unitCost: costMult,
        delay: delayMult,
        supplierAvailability: supplierAvailMult
      },
      result: res
    };
  });
}
