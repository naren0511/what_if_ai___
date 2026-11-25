export type Domain = 'campus' | 'business' | 'supply' | 'custom';
export type DependencyType = 'supplies' | 'requires' | 'supports' | 'delays' | 'increases_cost';
export type Priority = 'low' | 'medium' | 'high';
export type CostBasis = 'per_fulfilled' | 'per_demanded' | 'per_capacity' | 'fixed';
export type OperatingPeriod = 'event' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export type DependencyAggregation = 'bottleneck' | 'multiplicative' | 'additive' | 'critical_path';

export interface SimNode {
  id: string;
  name: string;
  type: string;
  quantityUnit: string;
  operatingPeriod: OperatingPeriod;
  costCurrency: string;
  costBasis: CostBasis;
  fixedCost: number;
  unitCost: number;
  demand: number;
  capacity: number;
  availability: number;
  baseDelayHours: number;
  priority: Priority;
  budget?: number;
  description?: string;
}

export interface SimEdge {
  id: string;
  source: string;
  target: string;
  type: DependencyType;
  influence: number;
  aggregation?: DependencyAggregation;
  basePropagationDelayHours?: number;
  shortageDelayHours?: number;
  additionalUnitCost?: number;
}

export interface Scenario {
  id: string;
  name: string;
  domain: Domain;
  description: string;
  budget: number;
  currency?: string;
  nodes: SimNode[];
  edges: SimEdge[];
  createdAt: string;
}

export interface ScenarioChange {
  id: string;
  nodeId: string;
  variable: 'demand' | 'capacity' | 'availability' | 'unitCost' | 'baseDelayHours' | 'fixedCost';
  operation: 'set' | 'add' | 'multiply';
  value: number;
  label: string;
}

export interface NodeResult {
  nodeId: string;
  name: string;
  quantityUnit: string;
  operatingPeriod: OperatingPeriod;
  effectiveCapacity: number;
  demand: number;
  fulfilled: number;
  unmetDemand: number;
  utilization: number;
  fixedCost: number;
  variableCost: number;
  unitCost?: number;
  cost: number;
  delayHours: number;
  dependencyFactor: number;
  availabilityFactor: number;
  directImpact: boolean;
  affected: boolean;
  trace: string[];
}

export interface HealthBreakdown {
  overallHealth: number;
  fulfilmentScore: number;
  budgetScore: number;
  utilizationScore: number;
  delayScore: number;
  penalty: number;
  weights: {
    fulfilment: number;
    budget: number;
    utilization: number;
    delay: number;
  };
  isHeuristic: boolean;
  notes: string[];
}

export interface RankedBottleneck {
  nodeId: string;
  name: string;
  unmetDemand: number;
  utilization: number;
  downstreamImpactCount: number;
  propagatedDelay: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  impactScore: number;
  reason: string;
}

export interface SimulationResult {
  scenarioId: string;
  label: string;
  currency: string;
  nodes: NodeResult[];
  totalDemand: number;
  demandByUnit: Record<string, number>;
  totalFulfilled: number;
  totalUnmet: number;
  totalCost: number;
  budget: number;
  budgetVariance: number;
  averageUtilization: number;
  overallHealth: number;
  healthBreakdown: HealthBreakdown;
  bottlenecks: string[];
  rankedBottlenecks: RankedBottleneck[];
  impactedNodeIds: string[];
  assumptionNotes: string[];
  warnings: string[];
  changeSummary: string[];
}

export interface UncertaintyVariableRange {
  optimistic: number;
  base: number;
  pessimistic: number;
}

export interface ConfigurableUncertaintySettings {
  demand: UncertaintyVariableRange;
  capacity: UncertaintyVariableRange;
  availability: UncertaintyVariableRange;
  unitCost: UncertaintyVariableRange;
  delay: UncertaintyVariableRange;
  supplierAvailability?: UncertaintyVariableRange;
}

export interface UncertaintyBandResult {
  band: 'optimistic' | 'base' | 'pessimistic';
  name: string;
  tone: string;
  description: string;
  multipliers: {
    demand: number;
    capacity: number;
    availability: number;
    unitCost: number;
    delay: number;
    supplierAvailability: number;
  };
  result: SimulationResult;
}

export interface DetailedRecommendation {
  problem: string;
  component: string;
  numericalEvidence: string;
  suggestedIntervention: string;
  expectedBenefit: string;
  tradeoff: string;
  assumption: string;
  feasibilityStatus: 'feasible' | 'requires_budget' | 'requires_unmodelled_resource';
  severity: 'critical' | 'warning' | 'info';
}

export interface AlternativeEvaluation {
  name: string;
  strategyKey: string;
  description: string;
  changes: ScenarioChange[];
  result: SimulationResult;
  isViable: boolean;
  positiveTradeoffs: string[];
  negativeTradeoffs: string[];
  hardConstraintViolations: string[];
}

export interface SavedRun {
  id: string;
  scenario: Scenario;
  result: SimulationResult;
  savedAt: string;
  durationMs?: number;
}
