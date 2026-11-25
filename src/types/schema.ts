import { z } from 'zod';

export const PrioritySchema = z.enum(['low', 'medium', 'high']);
export const DependencyTypeSchema = z.enum(['supplies', 'requires', 'supports', 'delays', 'increases_cost']);
export const DomainSchema = z.enum(['campus', 'business', 'supply', 'custom']);
export const CostBasisSchema = z.enum(['per_fulfilled', 'per_demanded', 'per_capacity', 'fixed']);
export const OperatingPeriodSchema = z.enum(['event', 'day', 'week', 'month', 'quarter', 'year']);
export const DependencyAggregationSchema = z.enum(['bottleneck', 'multiplicative', 'additive', 'critical_path']);

export const SimNodeSchema = z.object({
  id: z.string().min(1, 'Node ID is required'),
  name: z.string().min(1, 'Node name is required'),
  type: z.string().min(1, 'Node type is required'),
  quantityUnit: z.string().min(1, 'Quantity unit is required').default('units'),
  operatingPeriod: OperatingPeriodSchema.default('day'),
  costCurrency: z.string().min(1, 'Cost currency is required').default('INR'),
  costBasis: CostBasisSchema.default('per_fulfilled'),
  fixedCost: z.number().min(0, 'Fixed cost must be non-negative').default(0),
  unitCost: z.number().min(0, 'Unit cost must be non-negative').default(0),
  demand: z.number().min(0, 'Demand must be non-negative'),
  capacity: z.number().min(0, 'Capacity must be non-negative'),
  availability: z.number().min(0, 'Availability must be >= 0').max(1, 'Availability must be <= 1'),
  baseDelayHours: z.number().min(0, 'Base delay must be non-negative').default(0),
  priority: PrioritySchema.default('medium'),
  budget: z.number().min(0).optional(),
  description: z.string().optional()
});

export const SimEdgeSchema = z.object({
  id: z.string().min(1, 'Edge ID is required'),
  source: z.string().min(1, 'Source component ID is required'),
  target: z.string().min(1, 'Target component ID is required'),
  type: DependencyTypeSchema,
  influence: z.number().min(0, 'Influence must be >= 0').max(1, 'Influence must be <= 1'),
  aggregation: DependencyAggregationSchema.optional(),
  basePropagationDelayHours: z.number().min(0).default(0).optional(),
  shortageDelayHours: z.number().min(0).default(0).optional(),
  additionalUnitCost: z.number().min(0).default(0).optional()
});

export const ScenarioChangeSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  variable: z.enum(['demand', 'capacity', 'availability', 'unitCost', 'baseDelayHours', 'fixedCost']),
  operation: z.enum(['set', 'add', 'multiply']),
  value: z.number().min(0, 'Value must be non-negative'),
  label: z.string().min(1)
});

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Scenario name is required'),
  domain: DomainSchema,
  description: z.string(),
  budget: z.number().min(0, 'Budget must be non-negative'),
  currency: z.string().default('INR').optional(),
  nodes: z.array(SimNodeSchema).min(1, 'At least one component is required'),
  edges: z.array(SimEdgeSchema),
  createdAt: z.string()
});

export const StructuredStrategyResponseSchema = z.object({
  summary: z.string(),
  criticalBottleneck: z.string(),
  affectedComponents: z.array(z.string()),
  interventions: z.array(z.object({
    title: z.string(),
    rationale: z.string(),
    tradeoff: z.string(),
    requiredAssumptions: z.string()
  })),
  unresolvedQuestions: z.array(z.string())
});

export const UncertaintyVariableRangeSchema = z.object({
  optimistic: z.number().min(0, 'Optimistic multiplier must be non-negative'),
  base: z.number().min(0, 'Base multiplier must be non-negative'),
  pessimistic: z.number().min(0, 'Pessimistic multiplier must be non-negative')
});

export const ConfigurableUncertaintySchema = z.object({
  demand: UncertaintyVariableRangeSchema,
  capacity: UncertaintyVariableRangeSchema,
  availability: UncertaintyVariableRangeSchema,
  unitCost: UncertaintyVariableRangeSchema,
  delay: UncertaintyVariableRangeSchema,
  supplierAvailability: UncertaintyVariableRangeSchema.optional()
});

export type ValidatedScenario = z.infer<typeof ScenarioSchema>;
export type ValidatedSimNode = z.infer<typeof SimNodeSchema>;
export type ValidatedSimEdge = z.infer<typeof SimEdgeSchema>;
export type ValidatedScenarioChange = z.infer<typeof ScenarioChangeSchema>;
export type ValidatedConfigurableUncertainty = z.infer<typeof ConfigurableUncertaintySchema>;
