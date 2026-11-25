import { z } from 'zod';
import type { Scenario, ScenarioChange, SimulationResult } from './index.ts';

// ----------------------------------------------------
// Capabilities & Model Types
// ----------------------------------------------------

export interface AICapabilities {
  webgpuSupported: boolean;
  adapterInfo?: {
    vendor?: string;
    architecture?: string;
    description?: string;
  };
  hasFP16: boolean;
  estimatedMemoryMB?: number;
  recommendedModel: string;
  isCompatible: boolean;
  notes: string[];
}

export type AIModelId =
  | 'SmolLM2-360M-Instruct-q4f16_1-MLC'
  | 'SmolLM2-135M-Instruct-q0f16-MLC'
  | 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'
  | 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export interface AIModelOption {
  id: AIModelId;
  name: string;
  family: string;
  vramMB: number;
  downloadSizeMB: number;
  description: string;
}

export const SUPPORTED_LOCAL_MODELS: AIModelOption[] = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M Instruct (Quantized)',
    family: 'SmolLM2',
    vramMB: 376,
    downloadSizeMB: 220,
    description: 'Fastest initialization, ultra-lightweight, ideal for browser execution on standard GPUs.'
  },
  {
    id: 'SmolLM2-135M-Instruct-q0f16-MLC',
    name: 'SmolLM2 135M Ultra-Light',
    family: 'SmolLM2',
    vramMB: 360,
    downloadSizeMB: 140,
    description: 'Minimal download footprint for resource-constrained devices.'
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct',
    family: 'Qwen',
    vramMB: 945,
    downloadSizeMB: 390,
    description: 'Superior JSON structuring and constraint-adherence capabilities.'
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct',
    family: 'Llama',
    vramMB: 880,
    downloadSizeMB: 650,
    description: 'Higher reasoning depth for complex multi-echelon supply networks.'
  }
];

export interface AIProgress {
  status: 'idle' | 'checking' | 'downloading' | 'loading' | 'ready' | 'generating' | 'error';
  text: string;
  progress: number; // 0 to 1
  bytesLoaded?: number;
  totalBytes?: number;
}

// ----------------------------------------------------
// Strict Zod Schemas for Structured AI Outputs
// ----------------------------------------------------

export const ProposedChangeItemSchema = z.object({
  targetNodeId: z.string().min(1, 'Target component ID is required'),
  targetNodeName: z.string().min(1, 'Target component name is required'),
  variable: z.enum(['demand', 'capacity', 'availability', 'unitCost', 'baseDelayHours', 'fixedCost']),
  operation: z.enum(['set', 'add', 'multiply']),
  value: z.number(),
  reasoning: z.string().min(1, 'Reasoning is required')
});

export const AIRecoveryStrategyItemSchema = z.object({
  title: z.string().min(1),
  actionType: z.enum(['capacity_buffer', 'demand_throttling', 'backup_activation', 'supplier_diversification', 'cost_containment']),
  targetComponent: z.string().min(1),
  proposedAction: z.string().min(1),
  expectedBenefits: z.string().min(1),
  operationalTradeoffs: z.string().min(1),
  associatedChanges: z.array(z.object({
    nodeId: z.string(),
    variable: z.enum(['demand', 'capacity', 'availability', 'unitCost', 'baseDelayHours', 'fixedCost']),
    operation: z.enum(['set', 'add', 'multiply']),
    value: z.number()
  }))
});

export const UserIntentSchema = z.enum([
  'simulation_disruption',
  'diagnostic_query',
  'recovery_request',
  'counterfactual_query',
  'unsupported_query'
]);

export type UserIntent = z.infer<typeof UserIntentSchema>;

export const NLConversationResponseSchema = z.object({
  intent: UserIntentSchema,
  directAnswer: z.string().min(1),
  explanation: z.string().min(1),
  proposedChanges: z.array(ProposedChangeItemSchema),
  confidenceScore: z.number().min(0).max(1),
  ambiguitiesOrMissingInfo: z.array(z.string()),
  requiresSimulationConfirmation: z.boolean(),
  diagnosticDetails: z.object({
    topBottleneck: z.string().optional(),
    unmetDemand: z.number().optional(),
    healthScore: z.number().optional(),
    totalCost: z.number().optional(),
    modelledComponentFound: z.boolean().optional()
  }).optional(),
  suggestedRecoveryStrategies: z.array(AIRecoveryStrategyItemSchema).optional()
});

export type NLConversationResponse = z.infer<typeof NLConversationResponseSchema>;

export const NLScenarioProposalSchema = z.object({
  interpretation: z.string().min(1),
  proposedChanges: z.array(ProposedChangeItemSchema).min(1),
  confidenceScore: z.number().min(0).max(1),
  unresolvedInformation: z.array(z.string())
});

export type NLScenarioProposal = z.infer<typeof NLScenarioProposalSchema>;

export const AIRecoveryProposalSchema = z.object({
  analysisSummary: z.string().min(1),
  strategies: z.array(AIRecoveryStrategyItemSchema).min(1),
  identifiedRootBottleneck: z.string(),
  unmodelledConsiderations: z.array(z.string())
});

export type AIRecoveryProposal = z.infer<typeof AIRecoveryProposalSchema>;

export const AIDecisionExplanationSchema = z.object({
  headline: z.string().min(1),
  executiveSummary: z.string().min(1),
  criticalPathAnalysis: z.string().min(1),
  financialAndCostImpact: z.string().min(1),
  keyRisks: z.array(z.string()).min(1),
  recommendedNextSteps: z.array(z.string()).min(1)
});

export type AIDecisionExplanation = z.infer<typeof AIDecisionExplanationSchema>;

// ----------------------------------------------------
// Prompt Battle
// ----------------------------------------------------

export interface PromptBattleRound {
  style: 'zero_shot' | 'role_based' | 'structured_context';
  name: string;
  promptSent: string;
  response: string;
  executionTimeMs: number;
  scores: {
    hallucinationIndex: number; // 0 to 100 (100 = 0 hallucinations, verified against simulation metrics)
    componentCoverage: number;   // 0 to 100 (% of affected nodes explicitly addressed)
    constraintAdherence: number; // 0 to 100 (respected non-calculation rules)
    actionability: number;       // 0 to 100 (concrete interventions proposed)
    compositeScore: number;      // weighted composite
  };
  metricCitations: string[];
  hallucinatedClaims: string[];
}

export interface PromptBattleResult {
  scenarioName: string;
  rounds: PromptBattleRound[];
  winnerStyle: 'zero_shot' | 'role_based' | 'structured_context';
  rubricSummary: string;
  mode: 'GENERATIVE_AI' | 'RULE_BASED';
}
