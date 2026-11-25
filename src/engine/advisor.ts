import type {
  Scenario,
  SimulationResult,
  ScenarioChange,
  DetailedRecommendation,
  AlternativeEvaluation
} from '../types/index.ts';
import { formatCurrency, simulate } from './simulation.ts';

export function getRecommendations(result: SimulationResult): DetailedRecommendation[] {
  const recs: DetailedRecommendation[] = [];

  // 1. Critical bottleneck recommendations
  if (result.rankedBottlenecks.length > 0) {
    const top = result.rankedBottlenecks[0];
    const node = result.nodes.find(n => n.nodeId === top.nodeId);
    recs.push({
      problem: `Critical Capacity Shortage on ${top.name}`,
      component: top.name,
      numericalEvidence: `${top.unmetDemand.toFixed(1)} unmet units (${top.utilization.toFixed(0)}% utilization) cascading to ${top.downstreamImpactCount} downstream component(s).`,
      suggestedIntervention: `Add ${Math.max(15, Math.round(top.unmetDemand * 1.25))} units of buffer capacity or throttle incoming demand by 15%.`,
      expectedBenefit: `Restores throughput for ${top.name} and eliminates supply starvation for downstream dependencies.`,
      tradeoff: `Increases operating costs by ~${formatCurrency((node?.unitCost ?? 10) * Math.max(15, Math.round(top.unmetDemand * 1.25)), result.currency)}.`,
      assumption: 'Buffer capacity can be provisioned within the active operational planning window.',
      feasibilityStatus: 'feasible',
      severity: 'critical'
    });
  }

  // 2. Budget variance recommendation
  if (result.budgetVariance > 0) {
    const highestCostNode = [...result.nodes].sort((a, b) => b.cost - a.cost)[0];
    recs.push({
      problem: 'Operating Cost Exceeds Allocated Budget',
      component: highestCostNode ? highestCostNode.name : 'Overall System',
      numericalEvidence: `Total cost of ${formatCurrency(result.totalCost, result.currency)} exceeds budget by ${formatCurrency(result.budgetVariance, result.currency)} (+${((result.budgetVariance / Math.max(1, result.budget)) * 100).toFixed(1)}%).`,
      suggestedIntervention: `Review unit pricing for ${highestCostNode?.name || 'high-cost nodes'} or transition fixed retainers to per-fulfilled variable billing.`,
      expectedBenefit: `Eliminates the ${formatCurrency(result.budgetVariance, result.currency)} financial overrun to satisfy budget constraints.`,
      tradeoff: 'Renegotiating rates or reducing fixed costs may reduce supplier availability guarantees.',
      assumption: 'Vendors and service providers permit contract restructuring without penalty.',
      feasibilityStatus: 'requires_budget',
      severity: 'warning'
    });
  }

  // 3. High utilization warning
  const highUtilNodes = result.nodes.filter(n => n.utilization > 90 && n.unmetDemand === 0);
  if (highUtilNodes.length > 0) {
    const target = highUtilNodes[0];
    recs.push({
      problem: `Zero Safety Margin on High-Utilization Component`,
      component: target.name,
      numericalEvidence: `Operating at ${target.utilization.toFixed(0)}% utilization with only ${(target.effectiveCapacity - target.demand).toFixed(1)} units of headroom.`,
      suggestedIntervention: `Introduce a 10% safety cushion (${Math.round(target.effectiveCapacity * 0.1)} units) before demand spikes trigger queues.`,
      expectedBenefit: 'Protects system resilience against unpredicted volume surges.',
      tradeoff: 'Idle reserve capacity incurs carrying costs when demand remains flat.',
      assumption: 'Capacity can be provisioned incrementally without fixed minimum commitments.',
      feasibilityStatus: 'feasible',
      severity: 'warning'
    });
  }

  // 4. Downstream ripple warning
  const impactedDownstream = result.nodes.filter(n => n.affected && !n.directImpact);
  if (impactedDownstream.length > 0) {
    recs.push({
      problem: 'Cascading Ripple Effect Across Downstream Nodes',
      component: impactedDownstream.map(n => n.name).slice(0, 3).join(', '),
      numericalEvidence: `${impactedDownstream.length} downstream components suffered propagated delay or capacity restrictions from upstream nodes.`,
      suggestedIntervention: 'Decouple tightly coupled dependencies by placing localized intermediate buffer stock or flexible scheduling windows.',
      expectedBenefit: 'Isolates upstream disruptions from directly halting client-facing deliveries.',
      tradeoff: 'Buffer stages require floor space and working capital.',
      assumption: 'Products or processes can be held safely in intermediate storage stages.',
      feasibilityStatus: 'feasible',
      severity: 'info'
    });
  }

  if (recs.length === 0) {
    recs.push({
      problem: 'No Active Operational Failures Detected',
      component: 'All Components',
      numericalEvidence: `System health is ${result.overallHealth}/100 with zero unmet demand and budget variance of ${formatCurrency(result.budgetVariance, result.currency)}.`,
      suggestedIntervention: 'Execute stress tests with pessimistic multipliers (e.g. 1.25× demand, 0.8× availability) to verify breaking thresholds.',
      expectedBenefit: 'Identifies non-linear operational failure points before they manifest in live operations.',
      tradeoff: 'Stress testing requires exploration of multiple hypothetical scenarios.',
      assumption: 'Current component availability remains stable under nominal conditions.',
      feasibilityStatus: 'feasible',
      severity: 'info'
    });
  }

  return recs;
}

export function evaluateAlternatives(scenario: Scenario, changes: ScenarioChange[]): AlternativeEvaluation[] {
  const alternatives: AlternativeEvaluation[] = [];

  // Strategy 1: Current plan (Baseline)
  const baselineResult = simulate(scenario, [], 'Baseline');
  const baseBudgetViolated = baselineResult.budgetVariance > 0;
  const baseUnmetViolated = baselineResult.totalUnmet > 0;

  alternatives.push({
    name: 'Current plan (Baseline)',
    strategyKey: 'baseline',
    description: 'Operating under nominal baseline capacity and demand assumptions without disruptions.',
    changes: [],
    result: baselineResult,
    isViable: !baseBudgetViolated && !baseUnmetViolated,
    positiveTradeoffs: ['Zero disruption overhead', 'Satisfies baseline operational configuration'],
    negativeTradeoffs: [
      ...(baseBudgetViolated ? [`Baseline exceeds budget by ${formatCurrency(baselineResult.budgetVariance, scenario.currency)}`] : []),
      ...(baseUnmetViolated ? [`Baseline has ${baselineResult.totalUnmet.toFixed(1)} units of unmet demand`] : [])
    ],
    hardConstraintViolations: [
      ...(baseBudgetViolated ? ['Operating budget exceeded'] : []),
      ...(baseUnmetViolated ? ['Unmet demand present'] : [])
    ]
  });

  // Strategy 2: Disruption as entered
  const disruptedResult = simulate(scenario, changes, 'Disruption as entered');
  const disBudgetViolated = disruptedResult.budgetVariance > 0;
  const disUnmetViolated = disruptedResult.totalUnmet > 0;

  alternatives.push({
    name: 'Disruption as entered',
    strategyKey: 'disrupted',
    description: 'The active hypothetical disruption without corrective operational interventions.',
    changes,
    result: disruptedResult,
    isViable: !disBudgetViolated && !disUnmetViolated,
    positiveTradeoffs: ['Requires zero additional intervention capital'],
    negativeTradeoffs: [
      ...(disUnmetViolated ? [`${disruptedResult.totalUnmet.toFixed(1)} units of unmet customer demand`] : []),
      ...(disBudgetViolated ? [`Budget overrun of ${formatCurrency(disruptedResult.budgetVariance, scenario.currency)}`] : []),
      `${disruptedResult.impactedNodeIds.length} components impacted across the system`
    ],
    hardConstraintViolations: [
      ...(disBudgetViolated ? ['Operating budget exceeded'] : []),
      ...(disUnmetViolated ? ['Unmet demand present'] : [])
    ]
  });

  // Strategy 3: Targeted Bottleneck Capacity Expansion (Only if bottlenecks exist!)
  const topBottleneck = disruptedResult.rankedBottlenecks[0];
  if (topBottleneck) {
    const targetNode = scenario.nodes.find(n => n.id === topBottleneck.nodeId);
    if (targetNode) {
      const addedCap = Math.max(15, Math.round(topBottleneck.unmetDemand * 1.3));
      const capChanges: ScenarioChange[] = [
        ...changes,
        {
          id: `strat-cap-${targetNode.id}`,
          nodeId: targetNode.id,
          variable: 'capacity',
          operation: 'add',
          value: addedCap,
          label: `Expand capacity by +${addedCap} on ${targetNode.name}`
        }
      ];
      const capResult = simulate(scenario, capChanges, 'Targeted Capacity Expansion');
      const capBudgetViolated = capResult.budgetVariance > 0;
      const capUnmetViolated = capResult.totalUnmet > 0;

      alternatives.push({
        name: `Targeted Capacity Expansion (+${addedCap} ${targetNode.name})`,
        strategyKey: 'capacity_expansion',
        description: `Proactively expands operational capacity on ${targetNode.name} to clear the primary system bottleneck.`,
        changes: capChanges,
        result: capResult,
        isViable: !capBudgetViolated && !capUnmetViolated,
        positiveTradeoffs: [
          `Recovers ${Math.max(0, disruptedResult.totalUnmet - capResult.totalUnmet).toFixed(1)} units of unmet demand`,
          `Improves health index to ${capResult.overallHealth}/100`
        ],
        negativeTradeoffs: [
          `Increases operating cost by ${formatCurrency(capResult.totalCost - disruptedResult.totalCost, scenario.currency)}`,
          ...(capBudgetViolated ? [`Exceeds scenario budget by ${formatCurrency(capResult.budgetVariance, scenario.currency)}`] : [])
        ],
        hardConstraintViolations: [
          ...(capBudgetViolated ? ['Operating budget exceeded by expansion cost'] : []),
          ...(capUnmetViolated ? ['Residual unmet demand persists'] : [])
        ]
      });
    }
  }

  // Strategy 4: Activate Backup Supplier (ONLY IF a backup supplier actually exists in the scenario!)
  const backupSupplierNode = scenario.nodes.find(
    n => n.type === 'supplier' &&
      (n.name.toLowerCase().includes('backup') ||
        n.name.toLowerCase().includes('secondary') ||
        n.id.toLowerCase().includes('backup'))
  );

  if (backupSupplierNode) {
    const backupChanges: ScenarioChange[] = [
      ...changes,
      {
        id: `strat-backup-${backupSupplierNode.id}`,
        nodeId: backupSupplierNode.id,
        variable: 'availability',
        operation: 'set',
        value: 1.0,
        label: `Activate backup supplier: ${backupSupplierNode.name}`
      }
    ];
    const backupResult = simulate(scenario, backupChanges, 'Activate Backup Supplier');
    const bBudgetViolated = backupResult.budgetVariance > 0;
    const bUnmetViolated = backupResult.totalUnmet > 0;

    alternatives.push({
      name: `Activate Backup Supplier (${backupSupplierNode.name})`,
      strategyKey: 'backup_supplier',
      description: `Brings ${backupSupplierNode.name} online to 100% availability to compensate for primary supplier deficits.`,
      changes: backupChanges,
      result: backupResult,
      isViable: !bBudgetViolated && !bUnmetViolated,
      positiveTradeoffs: [
        `Restores supply throughput by ${Math.max(0, disruptedResult.totalUnmet - backupResult.totalUnmet).toFixed(1)} units`,
        `Improves overall health score to ${backupResult.overallHealth}/100`
      ],
      negativeTradeoffs: [
        `Higher unit cost increases expenditure by ${formatCurrency(backupResult.totalCost - disruptedResult.totalCost, scenario.currency)}`
      ],
      hardConstraintViolations: [
        ...(bBudgetViolated ? ['Operating budget exceeded'] : []),
        ...(bUnmetViolated ? ['Unmet demand persists'] : [])
      ]
    });
  }

  // Strategy 5: Increase Inventory Buffer (ONLY IF inventory / stock components exist!)
  const stockNode = scenario.nodes.find(n => n.type === 'stock' || n.name.toLowerCase().includes('inventory'));
  if (stockNode) {
    const stockAdded = Math.max(20, Math.round(stockNode.capacity * 0.25));
    const invChanges: ScenarioChange[] = [
      ...changes,
      {
        id: `strat-inv-${stockNode.id}`,
        nodeId: stockNode.id,
        variable: 'capacity',
        operation: 'add',
        value: stockAdded,
        label: `Increase inventory buffer (+${stockAdded}) on ${stockNode.name}`
      }
    ];
    const invResult = simulate(scenario, invChanges, 'Inventory Buffer Strategy');
    const invBudgetViolated = invResult.budgetVariance > 0;
    const invUnmetViolated = invResult.totalUnmet > 0;

    alternatives.push({
      name: `Increase Inventory Buffer (+${stockAdded} ${stockNode.name})`,
      strategyKey: 'inventory_buffer',
      description: `Increases safety stock buffer on ${stockNode.name} to decouple upstream supplier lag.`,
      changes: invChanges,
      result: invResult,
      isViable: !invBudgetViolated && !invUnmetViolated,
      positiveTradeoffs: [
        `Absorbs supply variance and reduces unmet demand by ${Math.max(0, disruptedResult.totalUnmet - invResult.totalUnmet).toFixed(1)} units`
      ],
      negativeTradeoffs: [
        `Holding cost adds ${formatCurrency(invResult.totalCost - disruptedResult.totalCost, scenario.currency)} in inventory overhead`
      ],
      hardConstraintViolations: [
        ...(invBudgetViolated ? ['Operating budget exceeded'] : []),
        ...(invUnmetViolated ? ['Unmet demand persists'] : [])
      ]
    });
  }

  // Strategy 6: Demand Throttling (-15% on intake demand)
  const intakeNodes = scenario.nodes.filter(n => n.demand > 0);
  if (intakeNodes.length > 0) {
    const demandThrottleChanges: ScenarioChange[] = [
      ...changes,
      ...intakeNodes.map(n => ({
        id: `strat-throt-${n.id}`,
        nodeId: n.id,
        variable: 'demand' as const,
        operation: 'multiply' as const,
        value: 0.85,
        label: `Throttle intake demand by 15% on ${n.name}`
      }))
    ];
    const demResult = simulate(scenario, demandThrottleChanges, 'Demand Throttling Strategy');
    const demBudgetViolated = demResult.budgetVariance > 0;
    const demUnmetViolated = demResult.totalUnmet > 0;

    alternatives.push({
      name: 'Intake Demand Throttling (-15%)',
      strategyKey: 'demand_throttling',
      description: 'Controlled intake throttling to protect system components from catastrophic overload.',
      changes: demandThrottleChanges,
      result: demResult,
      isViable: !demBudgetViolated && !demUnmetViolated,
      positiveTradeoffs: [
        `Eliminates internal queue bottlenecks and improves health score to ${demResult.overallHealth}/100`,
        `Lowers operating expenditure by ${formatCurrency(Math.max(0, disruptedResult.totalCost - demResult.totalCost), scenario.currency)}`
      ],
      negativeTradeoffs: [
        `Curtains gross throughput by ${(disruptedResult.totalDemand * 0.15).toFixed(0)} units`
      ],
      hardConstraintViolations: [
        ...(demBudgetViolated ? ['Operating budget exceeded'] : []),
        ...(demUnmetViolated ? ['Residual unmet demand persists'] : [])
      ]
    });
  }

  // Strategy 7: Delivery Arrangement Adjustment (if critical path delays are present)
  if (disruptedResult.nodes.some(n => n.delayHours > 0)) {
    const delayedNodes = disruptedResult.nodes.filter(n => n.delayHours > 0);
    const deliveryChanges: ScenarioChange[] = [
      ...changes,
      ...delayedNodes.map(n => ({
        id: `strat-delay-${n.nodeId}`,
        nodeId: n.nodeId,
        variable: 'baseDelayHours' as const,
        operation: 'set' as const,
        value: 0,
        label: `Expedite routing / zero base delay on ${n.name}`
      }))
    ];
    const delivResult = simulate(scenario, deliveryChanges, 'Expedited Delivery Arrangement');
    const delBudgetViolated = delivResult.budgetVariance > 0;
    const delUnmetViolated = delivResult.totalUnmet > 0;

    alternatives.push({
      name: 'Expedited Delivery Routing',
      strategyKey: 'expedited_delivery',
      description: 'Compresses baseline operational delay hours through priority transit and expedited handling.',
      changes: deliveryChanges,
      result: delivResult,
      isViable: !delBudgetViolated && !delUnmetViolated,
      positiveTradeoffs: [
        `Reduces lead-time delays across ${delayedNodes.length} transit-sensitive component(s)`
      ],
      negativeTradeoffs: [
        'Requires dedicated freight priority slots and tight logistical coordination'
      ],
      hardConstraintViolations: [
        ...(delBudgetViolated ? ['Operating budget exceeded'] : []),
        ...(delUnmetViolated ? ['Unmet demand persists'] : [])
      ]
    });
  }

  // Strategy 8: Operating Cost Optimization (if budget is exceeded)
  if (disruptedResult.budgetVariance > 0) {
    const expensiveNodes = scenario.nodes.filter(n => n.unitCost > 0);
    if (expensiveNodes.length > 0) {
      const costOptChanges: ScenarioChange[] = [
        ...changes,
        ...expensiveNodes.map(n => ({
          id: `strat-cost-${n.id}`,
          nodeId: n.id,
          variable: 'unitCost' as const,
          operation: 'multiply' as const,
          value: 0.85,
          label: `Negotiate 15% rate concession on ${n.name}`
        }))
      ];
      const costOptResult = simulate(scenario, costOptChanges, 'Cost Renegotiation Strategy');
      const cBudgetViolated = costOptResult.budgetVariance > 0;
      const cUnmetViolated = costOptResult.totalUnmet > 0;

      alternatives.push({
        name: 'Vendor Cost Restructuring (-15% Rates)',
        strategyKey: 'cost_restructuring',
        description: 'Renegotiates variable vendor rates by 15% to remediate operational budget overrun.',
        changes: costOptChanges,
        result: costOptResult,
        isViable: !cBudgetViolated && !cUnmetViolated,
        positiveTradeoffs: [
          `Saves ${formatCurrency(disruptedResult.totalCost - costOptResult.totalCost, scenario.currency)} in operating expenditure`,
          `Improves budget score to ${costOptResult.healthBreakdown.budgetScore}/100`
        ],
        negativeTradeoffs: [
          'Aggressive rate pressure may risk supplier priority or tier status during shortages'
        ],
        hardConstraintViolations: [
          ...(cBudgetViolated ? ['Operating budget still exceeded'] : []),
          ...(cUnmetViolated ? ['Unmet demand persists'] : [])
        ]
      });
    }
  }

  return alternatives;
}
