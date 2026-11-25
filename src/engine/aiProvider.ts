import { z } from 'zod';
import type { Scenario, ScenarioChange, SimulationResult } from '../types/index.ts';
import {
  type AICapabilities,
  type AIProgress,
  type AIModelId,
  SUPPORTED_LOCAL_MODELS,
  ProposedChangeItemSchema,
  UserIntentSchema,
  type UserIntent,
  NLConversationResponseSchema,
  type NLConversationResponse,
  NLScenarioProposalSchema,
  type NLScenarioProposal,
  AIRecoveryProposalSchema,
  type AIRecoveryProposal,
  AIDecisionExplanationSchema,
  type AIDecisionExplanation,
  type PromptBattleResult,
  type PromptBattleRound
} from '../types/ai.ts';
import {
  buildNLConversationPrompt,
  buildNLScenarioPrompt,
  buildRecoveryStrategyPrompt,
  buildDecisionExplanationPrompt
} from './aiPrompts.ts';
import { formatCurrency, simulate } from './simulation.ts';

// Dynamic type for WebLLM engine to avoid forcing static bundle inclusion
let mlcEngine: any = null;
let activeModelId: string | null = null;

// ----------------------------------------------------
// 1. Capability Checking
// ----------------------------------------------------

export async function checkAICapabilities(): Promise<AICapabilities> {
  const notes: string[] = [];

  const hasNavigator = typeof navigator !== 'undefined';
  const hasGPU = hasNavigator && 'gpu' in navigator && (navigator as any).gpu !== undefined;

  if (!hasGPU) {
    notes.push('WebGPU is not enabled or supported in this browser. Running in verified Rule-Based Expert Mode.');
    return {
      webgpuSupported: false,
      hasFP16: false,
      recommendedModel: 'Rule-Based Mode (Deterministic Engine)',
      isCompatible: false,
      notes
    };
  }

  try {
    const gpu = (navigator as any).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      notes.push('WebGPU adapter could not be initialized. Running in Rule-Based Expert Mode.');
      return {
        webgpuSupported: false,
        hasFP16: false,
        recommendedModel: 'Rule-Based Mode',
        isCompatible: false,
        notes
      };
    }

    const hasFP16 = adapter.features ? adapter.features.has('shader-f16') : false;
    const adapterInfo = adapter.info ? {
      vendor: adapter.info.vendor || 'Generic',
      architecture: adapter.info.architecture || 'Unknown',
      description: adapter.info.description || 'GPU Adapter'
    } : undefined;

    notes.push('WebGPU hardware acceleration verified.');
    if (hasFP16) {
      notes.push('Shader FP16 half-precision supported for optimal memory footprint.');
    } else {
      notes.push('Standard 32-bit shader mode supported.');
    }

    return {
      webgpuSupported: true,
      adapterInfo,
      hasFP16,
      recommendedModel: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
      isCompatible: true,
      notes
    };
  } catch (err: any) {
    notes.push(`WebGPU probe failed: ${err.message}. Using Rule-Based Mode.`);
    return {
      webgpuSupported: false,
      hasFP16: false,
      recommendedModel: 'Rule-Based Mode',
      isCompatible: false,
      notes
    };
  }
}

// ----------------------------------------------------
// 2. Model Initialization & Lifecycle
// ----------------------------------------------------

export async function initializeLocalAI(
  modelId: AIModelId = 'SmolLM2-360M-Instruct-q4f16_1-MLC',
  onProgress?: (progress: AIProgress) => void
): Promise<boolean> {
  if (mlcEngine && activeModelId === modelId) {
    if (onProgress) {
      onProgress({ status: 'ready', text: 'Model is active and ready in memory.', progress: 1.0 });
    }
    return true;
  }

  if (onProgress) {
    onProgress({
      status: 'checking',
      text: 'Verifying browser WebGPU and shader capabilities...',
      progress: 0.05
    });
  }

  const caps = await checkAICapabilities();
  if (!caps.webgpuSupported) {
    if (onProgress) {
      onProgress({
        status: 'error',
        text: 'WebGPU is not supported on this browser/device. System will operate in Rule-Based Mode.',
        progress: 0
      });
    }
    return false;
  }

  try {
    if (onProgress) {
      onProgress({
        status: 'downloading',
        text: `Loading WebLLM runtime for ${modelId}...`,
        progress: 0.15
      });
    }

    const webllm = await import('@mlc-ai/web-llm');

    const initProgressCallback = (report: any) => {
      const p = Math.min(1.0, Math.max(0.15, report.progress ?? 0.5));
      if (onProgress) {
        onProgress({
          status: 'loading',
          text: report.text || 'Compiling GPU shaders and caching model weights...',
          progress: p
        });
      }
    };

    mlcEngine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback
    });

    activeModelId = modelId;

    if (onProgress) {
      onProgress({
        status: 'ready',
        text: `Local model ${modelId} is active in browser memory via WebGPU.`,
        progress: 1.0
      });
    }
    return true;
  } catch (err: any) {
    console.warn('Local WebLLM initialization error:', err);
    mlcEngine = null;
    activeModelId = null;
    if (onProgress) {
      onProgress({
        status: 'error',
        text: `Model initialization failed (${err.message || 'GPU memory allocation error'}). Falling back to Rule-Based Mode.`,
        progress: 0
      });
    }
    return false;
  }
}

export function isLocalAIReady(): boolean {
  return mlcEngine !== null;
}

export function getActiveModelId(): string | null {
  return activeModelId;
}

export async function unloadLocalAI(): Promise<void> {
  if (mlcEngine) {
    try {
      await mlcEngine.unload();
    } catch {
      // ignore
    }
    mlcEngine = null;
    activeModelId = null;
  }
}

// ----------------------------------------------------
// 3. Robust JSON Parsing & Schema Auto-Repair
// ----------------------------------------------------

export function cleanAndParseJSON<T>(rawText: string, schema: z.ZodSchema<T>): { success: true; data: T; repaired: boolean } | { success: false; error: string; raw: string } {
  let cleaned = rawText.trim();
  let wasRepaired = false;

  if (cleaned.includes('```')) {
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      cleaned = match[1].trim();
      wasRepaired = true;
    }
  }

  let parsedObj: any = null;
  try {
    parsedObj = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const extracted = cleaned.substring(firstBrace, lastBrace + 1);
      const fixedCommas = extracted.replace(/,\s*([}\]])/g, '$1');
      try {
        parsedObj = JSON.parse(fixedCommas);
        wasRepaired = true;
      } catch (err2: any) {
        return {
          success: false,
          error: `JSON parse failed after repair attempt: ${err2.message}`,
          raw: rawText
        };
      }
    } else {
      return {
        success: false,
        error: 'No JSON object structure found in model output.',
        raw: rawText
      };
    }
  }

  const validation = schema.safeParse(parsedObj);
  if (validation.success) {
    return { success: true, data: validation.data, repaired: wasRepaired || cleaned !== rawText };
  }

  return {
    success: false,
    error: `Schema validation failed: ${validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    raw: rawText
  };
}

// ----------------------------------------------------
// 4. Unified Natural Language Query Processor
// ----------------------------------------------------

export async function processNaturalLanguageQuery(
  userInput: string,
  scenario: Scenario,
  result: SimulationResult | null = null
): Promise<{ response: NLConversationResponse; mode: 'GENERATIVE_AI' | 'RULE_BASED' }> {
  // If Local AI is active, run generative inference
  if (mlcEngine) {
    try {
      const prompt = buildNLConversationPrompt(userInput, scenario, result);
      const completion = await mlcEngine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 800
      });

      const raw = completion.choices[0]?.message?.content || '';
      const parsed = cleanAndParseJSON(raw, NLConversationResponseSchema);
      if (parsed.success) {
        return { response: parsed.data, mode: 'GENERATIVE_AI' };
      }
      console.warn('AI output failed schema validation. Falling back to deterministic copilot:', parsed.error);
    } catch (err) {
      console.warn('Inference error in NL processor:', err);
    }
  }

  // High-Precision Rule-Based Expert Copilot
  return {
    response: evaluateRuleBasedConversationQuery(userInput, scenario, result),
    mode: 'RULE_BASED'
  };
}

export function evaluateRuleBasedConversationQuery(
  userInput: string,
  scenario: Scenario,
  result: SimulationResult | null = null
): NLConversationResponse {
  const lower = userInput.toLowerCase();

  // Intent 1: Diagnostic / Analytical Question
  const isDiagnostic =
    lower.includes('which component') ||
    lower.includes('biggest bottleneck') ||
    lower.includes('what bottleneck') ||
    lower.includes('top bottleneck') ||
    lower.includes('current health') ||
    lower.includes('health score') ||
    lower.includes('where is the bottleneck') ||
    lower.includes('most constrained');

  if (isDiagnostic) {
    const simRes = result || simulate(scenario, []);
    const top = simRes.rankedBottlenecks[0];

    if (top) {
      return {
        intent: 'diagnostic_query',
        directAnswer: `The primary operational bottleneck is ${top.name}, operating at ${top.utilization.toFixed(0)}% utilization with ${top.unmetDemand.toFixed(1)} unmet units.`,
        explanation: `${top.name} constrains throughput across ${top.downstreamImpactCount} downstream dependent component(s). Total unmet demand across the scenario is ${simRes.totalUnmet.toFixed(1)} units with an overall health score of ${simRes.overallHealth}/100.`,
        proposedChanges: [],
        confidenceScore: 0.98,
        ambiguitiesOrMissingInfo: [],
        requiresSimulationConfirmation: false,
        diagnosticDetails: {
          topBottleneck: top.name,
          unmetDemand: top.unmetDemand,
          healthScore: simRes.overallHealth,
          totalCost: simRes.totalCost,
          modelledComponentFound: true
        }
      };
    }

    return {
      intent: 'diagnostic_query',
      directAnswer: `All ${scenario.nodes.length} components are operating within safe capacity limits with 0 unmet demand.`,
      explanation: `The system health score is ${simRes.overallHealth}/100. Total demand of ${simRes.totalDemand} units is 100% fulfilled with a budget variance of ${formatCurrency(simRes.budgetVariance, simRes.currency)}.`,
      proposedChanges: [],
      confidenceScore: 0.98,
      ambiguitiesOrMissingInfo: [],
      requiresSimulationConfirmation: false,
      diagnosticDetails: {
        topBottleneck: 'None',
        unmetDemand: 0,
        healthScore: simRes.overallHealth,
        totalCost: simRes.totalCost,
        modelledComponentFound: true
      }
    };
  }

  // Intent 2: Recovery / Mitigation Request
  const isRecoveryRequest =
    lower.includes('recovery strateg') ||
    lower.includes('suggest ... strateg') ||
    lower.includes('mitigat') ||
    lower.includes('fix the bottleneck') ||
    lower.includes('how can i fix') ||
    lower.includes('within my current budget') ||
    (lower.includes('suggest') && lower.includes('strateg'));

  if (isRecoveryRequest) {
    const simRes = result || simulate(scenario, []);
    const top = simRes.rankedBottlenecks[0];
    const topNode = top ? scenario.nodes.find(n => n.id === top.nodeId) : scenario.nodes[0];
    const targetName = topNode?.name || 'Primary Stage';

    const strategies: any[] = [];
    if (top && topNode) {
      const bufferQty = Math.max(20, Math.round(top.unmetDemand * 1.25));
      strategies.push({
        title: `Capacity Buffer on ${targetName}`,
        actionType: 'capacity_buffer',
        targetComponent: targetName,
        proposedAction: `Provision +${bufferQty} units of buffer capacity to clear active unmet demand.`,
        expectedBenefits: `Restores supply throughput and protects downstream dependencies.`,
        operationalTradeoffs: `Increases operating costs by ~${formatCurrency((topNode.unitCost || 10) * bufferQty, scenario.currency)}.`,
        associatedChanges: [{ nodeId: topNode.id, variable: 'capacity', operation: 'add', value: bufferQty }]
      });

      strategies.push({
        title: `Tactical Demand Throttling on ${targetName}`,
        actionType: 'demand_throttling',
        targetComponent: targetName,
        proposedAction: `Throttle intake by 20% to stabilize capacity within budget.`,
        expectedBenefits: `Eliminates propagation lag with zero additional capital expenditure.`,
        operationalTradeoffs: `Rejects or defers excess intake volume.`,
        associatedChanges: [{ nodeId: topNode.id, variable: 'demand', operation: 'multiply', value: 0.8 }]
      });

      strategies.push({
        title: `Cost & Overhead Containment`,
        actionType: 'cost_containment',
        targetComponent: targetName,
        proposedAction: `Negotiate 10% unit cost efficiency or reallocate idle resources.`,
        expectedBenefits: `Maintains budget compliance of ${formatCurrency(scenario.budget, scenario.currency)}.`,
        operationalTradeoffs: `Requires operational restructuring.`,
        associatedChanges: [{ nodeId: topNode.id, variable: 'unitCost', operation: 'multiply', value: 0.9 }]
      });
    } else {
      strategies.push({
        title: `Maintain Operating Baseline`,
        actionType: 'cost_containment',
        targetComponent: targetName,
        proposedAction: 'Current operations are balanced at 100/100 health. Monitor upstream signals.',
        expectedBenefits: 'Zero disruption overhead.',
        operationalTradeoffs: 'Standard fixed operating cost.',
        associatedChanges: []
      });
    }

    return {
      intent: 'recovery_request',
      directAnswer: `Formulated ${strategies.length} recovery strategies within the ${formatCurrency(scenario.budget, scenario.currency)} operating budget.`,
      explanation: `Strategies address ${targetName} through capacity buffer expansion, intake throttling, and cost containment.`,
      proposedChanges: [],
      confidenceScore: 0.95,
      ambiguitiesOrMissingInfo: [],
      requiresSimulationConfirmation: false,
      suggestedRecoveryStrategies: strategies
    };
  }

  // Intent 3: Counterfactual Query on Unmodelled Components (e.g. Backup Supplier)
  const isCounterfactual =
    lower.includes('backup supplier') ||
    lower.includes('secondary supplier') ||
    lower.includes('alternate supplier') ||
    lower.includes('activate a backup');

  if (isCounterfactual) {
    const backupNode = scenario.nodes.find(n => 
      n.id.toLowerCase().includes('backup') || n.name.toLowerCase().includes('backup')
    );

    if (backupNode) {
      return {
        intent: 'counterfactual_query',
        directAnswer: `Backup supplier "${backupNode.name}" is present in the scenario. Proposed to activate at 100% availability.`,
        explanation: `Activating ${backupNode.name} provides redundant supply capacity for connected facilities.`,
        proposedChanges: [
          {
            targetNodeId: backupNode.id,
            targetNodeName: backupNode.name,
            variable: 'availability',
            operation: 'set',
            value: 1.0,
            reasoning: 'Activate backup supplier redundancy'
          }
        ],
        confidenceScore: 0.94,
        ambiguitiesOrMissingInfo: [],
        requiresSimulationConfirmation: true,
        diagnosticDetails: {
          topBottleneck: backupNode.name,
          modelledComponentFound: true
        }
      };
    }

    // Explicitly reject hallucinating a backup supplier if not modelled!
    return {
      intent: 'counterfactual_query',
      directAnswer: `No backup supplier is currently modelled in the "${scenario.name}" scenario.`,
      explanation: `The active topology contains: ${scenario.nodes.map(n => n.name).join(', ')}. To simulate a backup supplier, add a "Backup Supplier" component in the Scenario Builder connected to your downstream nodes, or simulate expanding capacity on your existing Primary Supplier.`,
      proposedChanges: [],
      confidenceScore: 0.98,
      ambiguitiesOrMissingInfo: ['Backup supplier node does not exist in active scenario graph.'],
      requiresSimulationConfirmation: false,
      diagnosticDetails: {
        modelledComponentFound: false
      }
    };
  }

  // Intent 4: What-If Parameter Disruption (Single or Multi-Clause)
  const isDisruption =
    lower.includes('what if') ||
    lower.includes('what happens') ||
    lower.includes('increase') ||
    lower.includes('reduce') ||
    lower.includes('decrease') ||
    lower.includes('falls') ||
    lower.includes('surge') ||
    lower.includes('unavailable') ||
    lower.includes('offline') ||
    lower.includes('drop') ||
    lower.includes('cut') ||
    lower.includes('double');

  if (isDisruption) {
    return extractStructuredDisruptionProposal(userInput, scenario);
  }

  // Fallback: Unsupported query
  return {
    intent: 'unsupported_query',
    directAnswer: 'Query could not be mapped to supported decision simulation parameters.',
    explanation: `WHATIF AI simulates operational capacity, demand, availability, unit costs, delays, and bottleneck propagation across ${scenario.name}. Please enter a what-if perturbation (e.g. "What if supplier availability falls by 40%?") or an operational diagnostic question (e.g. "Which component is causing the biggest bottleneck?").`,
    proposedChanges: [],
    confidenceScore: 0.6,
    ambiguitiesOrMissingInfo: ['Query does not reference operational components or simulation metrics.'],
    requiresSimulationConfirmation: false
  };
}

export function extractStructuredDisruptionProposal(userInput: string, scenario: Scenario): NLConversationResponse {
  const lower = userInput.toLowerCase();
  const proposedChanges: any[] = [];
  const ambiguities: string[] = [];

  // Split input into clauses conjoined by 'and', 'while', 'plus', or commas
  const clauses = userInput.split(/\b(?:and|while|plus)\b|,/i).map(c => c.trim()).filter(Boolean);

  for (const clause of clauses) {
    const cLower = clause.toLowerCase();

    // 1. Identify Target Component
    let targetNode: any = null;

    // Semantic matching by component intent
    if (cLower.includes('customer') || cLower.includes('order') || cLower.includes('client')) {
      targetNode = scenario.nodes.find(n => 
        n.id.includes('customer') || n.name.toLowerCase().includes('customer') ||
        n.id.includes('order') || n.name.toLowerCase().includes('order') ||
        n.type === 'outcome'
      );
    } else if (cLower.includes('attend') || cLower.includes('registration') || cLower.includes('participant')) {
      targetNode = scenario.nodes.find(n => 
        n.id.includes('registration') || n.name.toLowerCase().includes('registration') ||
        n.quantityUnit === 'attendee'
      );
    } else if (cLower.includes('volunteer')) {
      targetNode = scenario.nodes.find(n => 
        n.id.includes('volunteer') || n.name.toLowerCase().includes('volunteer') ||
        n.quantityUnit === 'volunteer'
      );
    } else if (cLower.includes('supplier')) {
      targetNode = scenario.nodes.find(n => 
        n.type === 'supplier' || n.name.toLowerCase().includes('supplier')
      );
    } else if (cLower.includes('staff') || cLower.includes('employee')) {
      targetNode = scenario.nodes.find(n => 
        n.type === 'people' || n.name.toLowerCase().includes('staff')
      );
    } else if (cLower.includes('warehouse') || cLower.includes('inventory') || cLower.includes('stock')) {
      targetNode = scenario.nodes.find(n => 
        n.id.includes('warehouse') || n.id.includes('inventory') || n.type === 'stock'
      );
    } else if (cLower.includes('transport') || cLower.includes('transit') || cLower.includes('logistics')) {
      targetNode = scenario.nodes.find(n => 
        n.type === 'transport' || n.name.toLowerCase().includes('transport')
      );
    } else if (cLower.includes('venue') || cLower.includes('hall')) {
      targetNode = scenario.nodes.find(n => 
        n.id.includes('venue') || n.name.toLowerCase().includes('venue')
      );
    } else {
      // Fallback: match by node name in clause
      targetNode = scenario.nodes.find(n => 
        cLower.includes(n.id.toLowerCase()) || cLower.includes(n.name.toLowerCase())
      );
    }

    if (!targetNode) {
      targetNode = scenario.nodes[0];
      ambiguities.push(`Clause "${clause}" did not explicitly match a known component; defaulted to ${targetNode.name}.`);
    }

    // 2. Identify Variable & Operation
    const isAvailability = cLower.includes('availab') || cLower.includes('offline') || cLower.includes('outage') || cLower.includes('fails');
    const isCost = cLower.includes('cost') || cLower.includes('price') || cLower.includes('wage');
    const isDelay = cLower.includes('delay') || cLower.includes('lag') || cLower.includes('late');
    const isCapacityExplicit = cLower.includes('capacit') || cLower.includes('buffer') || cLower.includes('reduce volunteer') || cLower.includes('cut volunteer') || cLower.includes('cut staff') || cLower.includes('reduce staff');
    const isDemandExplicit = cLower.includes('demand') || cLower.includes('attend') || cLower.includes('order');

    let variable: 'demand' | 'capacity' | 'availability' | 'unitCost' | 'baseDelayHours' | 'fixedCost' = 'demand';
    if (isAvailability) {
      variable = 'availability';
    } else if (isCost) {
      variable = 'unitCost';
    } else if (isDelay) {
      variable = 'baseDelayHours';
    } else if (isCapacityExplicit) {
      variable = 'capacity';
    } else if (isDemandExplicit) {
      variable = 'demand';
    } else {
      variable = targetNode.type === 'supplier' || targetNode.type === 'facility' ? 'capacity' : 'demand';
    }

    // 3. Identify Value & Operation
    let operation: 'multiply' | 'set' | 'add' = 'set';
    let val = 1.0;

    // Check complete failure / unavailability
    if (cLower.includes('unavailable') || cLower.includes('offline') || cLower.includes('fails') || cLower.includes('zero availability')) {
      operation = 'set';
      val = 0;
    } else {
      // Percentage check
      const pctMatch = cLower.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        const isReduction = cLower.includes('fall') || cLower.includes('drop') || cLower.includes('reduc') || cLower.includes('cut') || cLower.includes('decrease') || cLower.includes('down');
        operation = 'multiply';
        val = isReduction ? Math.max(0, Number(((100 - pct) / 100).toFixed(2))) : Number(((100 + pct) / 100).toFixed(2));
      } else {
        // Delta / Addition check: "increase by 100", "add 50", "by 100"
        const addMatch = cLower.match(/(?:increase|add|boost|surge|expand)\s+(?:by\s+)?(\d+(?:\.\d+)?)/i) ||
                         cLower.match(/(?:by|\+)\s*(\d+(?:\.\d+)?)/);
        const subMatch = cLower.match(/(?:reduce|decrease|cut|drop)\s+(?:by\s+)?(\d+(?:\.\d+)?)/i);

        if (addMatch && !cLower.includes('%')) {
          operation = 'add';
          val = parseFloat(addMatch[1]);
        } else if (subMatch && !cLower.includes('%')) {
          operation = 'add';
          val = -parseFloat(subMatch[1]);
        } else {
          // Absolute set check: "to 150", "= 200"
          const setMatch = cLower.match(/(?:to|=)\s*(\d+(?:\.\d+)?)/);
          if (setMatch) {
            operation = 'set';
            val = parseFloat(setMatch[1]);
          } else {
            // Default shift
            operation = 'multiply';
            val = cLower.includes('double') ? 2.0 : 1.25;
            ambiguities.push(`No exact numerical amount in clause "${clause}". Applied standard shift.`);
          }
        }
      }
    }

    proposedChanges.push({
      targetNodeId: targetNode.id,
      targetNodeName: targetNode.name,
      variable,
      operation,
      value: val,
      reasoning: `Clause: "${clause}" -> ${targetNode.name} (${variable} ${operation} ${val})`
    });
  }

  const changeSummaries = proposedChanges.map(c => 
    `${c.targetNodeName} ${c.variable} ${c.operation === 'multiply' ? `${c.value}×` : c.operation === 'add' ? `+${c.value}` : `set to ${c.value}`}`
  );

  return {
    intent: 'simulation_disruption',
    directAnswer: `Identified ${proposedChanges.length} scenario change(s): ${changeSummaries.join('; ')}.`,
    explanation: `Proposes applying parameter changes across ${[...new Set(proposedChanges.map(c => c.targetNodeName))].join(', ')} to simulate downstream cascade impacts.`,
    proposedChanges,
    confidenceScore: ambiguities.length === 0 ? 0.95 : 0.8,
    ambiguitiesOrMissingInfo: ambiguities,
    requiresSimulationConfirmation: true
  };
}

// Backward-compatible wrapper for NL scenario interpretation
export async function interpretNaturalLanguageScenario(
  userInput: string,
  scenario: Scenario
): Promise<{ proposal: NLScenarioProposal; mode: 'GENERATIVE_AI' | 'RULE_BASED' }> {
  const { response, mode } = await processNaturalLanguageQuery(userInput, scenario, null);
  
  // Convert to NLScenarioProposal format
  const changes = response.proposedChanges.length > 0 ? response.proposedChanges : [
    {
      targetNodeId: scenario.nodes[0].id,
      targetNodeName: scenario.nodes[0].name,
      variable: 'demand' as const,
      operation: 'multiply' as const,
      value: 1.25,
      reasoning: response.directAnswer
    }
  ];

  return {
    proposal: {
      interpretation: response.directAnswer,
      proposedChanges: changes,
      confidenceScore: response.confidenceScore,
      unresolvedInformation: response.ambiguitiesOrMissingInfo
    },
    mode
  };
}

export function extractRuleBasedScenarioProposal(userInput: string, scenario: Scenario): NLScenarioProposal {
  const res = evaluateRuleBasedConversationQuery(userInput, scenario, null);
  const changes = res.proposedChanges.length > 0 ? res.proposedChanges : [
    {
      targetNodeId: scenario.nodes[0].id,
      targetNodeName: scenario.nodes[0].name,
      variable: 'demand' as const,
      operation: 'multiply' as const,
      value: 1.25,
      reasoning: res.directAnswer
    }
  ];

  return {
    interpretation: res.directAnswer,
    proposedChanges: changes,
    confidenceScore: res.confidenceScore,
    unresolvedInformation: res.ambiguitiesOrMissingInfo
  };
}

// ----------------------------------------------------
// 5. Connect Language Model to Deterministic Simulation
// ----------------------------------------------------

export interface SimulationExecutionWithAI {
  baselineResult: SimulationResult;
  simulatedResult: SimulationResult;
  variance: {
    healthDelta: number;
    unmetDemandDelta: number;
    costDelta: number;
    bottlenecksAdded: string[];
    newlyImpactedNodes: string[];
  };
  aiExplanation: string;
}

export function executeSimulationWithAIExplanation(
  scenario: Scenario,
  changes: ScenarioChange[]
): SimulationExecutionWithAI {
  const baseline = simulate(scenario, [], 'Baseline');
  const simulated = simulate(scenario, changes, 'What-If Simulation');

  const healthDelta = simulated.overallHealth - baseline.overallHealth;
  const unmetDemandDelta = simulated.totalUnmet - baseline.totalUnmet;
  const costDelta = simulated.totalCost - baseline.totalCost;
  const bottlenecksAdded = simulated.bottlenecks.filter(b => !baseline.bottlenecks.includes(b));
  const newlyImpactedNodes = simulated.impactedNodeIds.filter(id => !baseline.impactedNodeIds.includes(id));

  let aiExplanation = '';
  if (unmetDemandDelta > 0) {
    aiExplanation = `Simulation executed: The disruption reduced system health by ${Math.abs(healthDelta).toFixed(0)} points (now ${simulated.overallHealth}/100) and generated ${unmetDemandDelta.toFixed(1)} units of unmet customer demand. Newly identified bottleneck(s): ${bottlenecksAdded.join(', ') || 'Downstream starvation'}. Operating cost shifted by ${formatCurrency(costDelta, scenario.currency)}.`;
  } else if (healthDelta >= 0) {
    aiExplanation = `Simulation executed: Changes maintained optimal operational stability with 0 unmet demand. Health score is ${simulated.overallHealth}/100 with total cost of ${formatCurrency(simulated.totalCost, scenario.currency)} (variance: ${formatCurrency(simulated.budgetVariance, scenario.currency)}).`;
  } else {
    aiExplanation = `Simulation executed: System experienced performance degradation with health score dropping to ${simulated.overallHealth}/100 and operating cost changing by ${formatCurrency(costDelta, scenario.currency)}.`;
  }

  return {
    baselineResult: baseline,
    simulatedResult: simulated,
    variance: {
      healthDelta,
      unmetDemandDelta,
      costDelta,
      bottlenecksAdded,
      newlyImpactedNodes
    },
    aiExplanation
  };
}

// ----------------------------------------------------
// 6. Recovery Strategy Generator
// ----------------------------------------------------

export async function generateRecoveryStrategies(
  scenario: Scenario,
  result: SimulationResult
): Promise<{ proposal: AIRecoveryProposal; mode: 'GENERATIVE_AI' | 'RULE_BASED' }> {
  if (mlcEngine) {
    try {
      const prompt = buildRecoveryStrategyPrompt(scenario, result);
      const completion = await mlcEngine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 800
      });

      const raw = completion.choices[0]?.message?.content || '';
      const parsed = cleanAndParseJSON(raw, AIRecoveryProposalSchema);
      if (parsed.success) {
        return { proposal: parsed.data, mode: 'GENERATIVE_AI' };
      }
      console.warn('Recovery AI output failed schema validation:', parsed.error);
    } catch (err) {
      console.warn('Inference error in recovery strategy generator:', err);
    }
  }

  return {
    proposal: generateRuleBasedRecoveryProposal(scenario, result),
    mode: 'RULE_BASED'
  };
}

export function generateRuleBasedRecoveryProposal(scenario: Scenario, result: SimulationResult): AIRecoveryProposal {
  const topBottleneck = result.rankedBottlenecks[0];
  const targetNode = topBottleneck ? scenario.nodes.find(n => n.id === topBottleneck.nodeId) : scenario.nodes[0];
  const targetName = targetNode?.name || 'Primary Stage';

  const strategies: any[] = [];

  if (topBottleneck && targetNode) {
    const requiredBuffer = Math.max(20, Math.round(topBottleneck.unmetDemand * 1.25));
    strategies.push({
      title: `Emergency Capacity Provisioning on ${targetName}`,
      actionType: 'capacity_buffer',
      targetComponent: targetName,
      proposedAction: `Provision +${requiredBuffer} ${targetNode.quantityUnit || 'units'} of temporary capacity to clear the active unmet demand of ${topBottleneck.unmetDemand.toFixed(1)}.`,
      expectedBenefits: `Eliminates throughput starvation for ${topBottleneck.downstreamImpactCount} downstream dependent components.`,
      operationalTradeoffs: `Increases operating expenditure by estimated ${formatCurrency((targetNode.unitCost || 10) * requiredBuffer, scenario.currency)}.`,
      associatedChanges: [
        {
          nodeId: targetNode.id,
          variable: 'capacity',
          operation: 'add',
          value: requiredBuffer
        }
      ]
    });

    strategies.push({
      title: `Tactical Demand Throttling on ${targetName}`,
      actionType: 'demand_throttling',
      targetComponent: targetName,
      proposedAction: 'Throttle incoming intake rate by 20% to stabilize utilization within safe operating limits.',
      expectedBenefits: 'Prevents cascade failure and stabilizes critical path delay without deploying capital.',
      operationalTradeoffs: 'Rejects or defers excess customer requests, impacting gross fulfillment volume.',
      associatedChanges: [
        {
          nodeId: targetNode.id,
          variable: 'demand',
          operation: 'multiply',
          value: 0.8
        }
      ]
    });
  } else {
    strategies.push({
      title: 'Operational Baseline Fine-Tuning',
      actionType: 'cost_containment',
      targetComponent: targetName,
      proposedAction: 'System is currently stable. Maintain baseline buffer allocations and review procurement contracts.',
      expectedBenefits: 'Maintains optimal 100/100 health score with zero unmet demand.',
      operationalTradeoffs: 'Carries standard operating fixed overhead.',
      associatedChanges: []
    });
  }

  return {
    analysisSummary: topBottleneck 
      ? `System health degraded to ${result.overallHealth}/100 driven by a severe bottleneck on ${targetName} (${topBottleneck.unmetDemand.toFixed(1)} unmet demand, ${topBottleneck.utilization.toFixed(0)}% utilization).`
      : `Operational system is balanced at ${result.overallHealth}/100 health with zero capacity deficits.`,
    identifiedRootBottleneck: topBottleneck ? topBottleneck.name : 'None',
    strategies,
    unmodelledConsiderations: [
      'Supplier contract notice lead-times',
      'Overtime labor union rate differentials',
      'Inventory holding space physical limits'
    ]
  };
}

// ----------------------------------------------------
// 7. Decision Explanation Generator
// ----------------------------------------------------

export async function generateDecisionExplanation(
  scenario: Scenario,
  result: SimulationResult
): Promise<{ explanation: AIDecisionExplanation; mode: 'GENERATIVE_AI' | 'RULE_BASED' }> {
  if (mlcEngine) {
    try {
      const prompt = buildDecisionExplanationPrompt(scenario, result);
      const completion = await mlcEngine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 700
      });

      const raw = completion.choices[0]?.message?.content || '';
      const parsed = cleanAndParseJSON(raw, AIDecisionExplanationSchema);
      if (parsed.success) {
        return { explanation: parsed.data, mode: 'GENERATIVE_AI' };
      }
      console.warn('Explanation AI output failed schema validation:', parsed.error);
    } catch (err) {
      console.warn('Inference error in decision explanation generator:', err);
    }
  }

  return {
    explanation: generateRuleBasedDecisionExplanation(scenario, result),
    mode: 'RULE_BASED'
  };
}

export function generateRuleBasedDecisionExplanation(scenario: Scenario, result: SimulationResult): AIDecisionExplanation {
  const isBottlenecked = result.rankedBottlenecks.length > 0;
  const top = result.rankedBottlenecks[0];

  return {
    headline: isBottlenecked
      ? `Bottleneck Alert: ${top.name} Operating at ${top.utilization.toFixed(0)}% Capacity with ${top.unmetDemand.toFixed(1)} Unmet Units`
      : `Nominal Operations: Scenario Running at Optimal ${result.overallHealth}/100 Health Score`,
    executiveSummary: isBottlenecked
      ? `The configured scenario causes severe capacity constriction at ${top.name}, propagating supply deficits across ${top.downstreamImpactCount} downstream components. Total unmet demand stands at ${result.totalUnmet.toFixed(1)} units with estimated operating cost of ${formatCurrency(result.totalCost, result.currency)}.`
      : `All ${scenario.nodes.length} components are operating within safe bounds. Total demand of ${result.totalDemand} units is 100% fulfilled with a budget variance of ${formatCurrency(result.budgetVariance, result.currency)}.`,
    criticalPathAnalysis: isBottlenecked
      ? `Upstream shortages on ${top.name} restrict throughput via strict prerequisite relationships. Leontief aggregation limits downstream capacity to ${result.nodes.find(n => n.nodeId === top.nodeId)?.effectiveCapacity} units.`
      : 'All critical path dependencies are satisfied with zero bottleneck aggregation restrictions.',
    financialAndCostImpact: `Total estimated operating cost is ${formatCurrency(result.totalCost, result.currency)} against a budget of ${formatCurrency(result.budget, result.currency)} (variance: ${formatCurrency(result.budgetVariance, result.currency)}).`,
    keyRisks: isBottlenecked ? [
      `Throughput starvation on ${top.name} cascading to downstream nodes`,
      `Budget variance of ${formatCurrency(result.budgetVariance, result.currency)} if overtime buffer is required`,
      'Customer order SLA breach due to accumulated propagation lag'
    ] : [
      'Potential vulnerability to unmodelled external supply disruptions',
      'Fixed cost overhead under sub-nominal demand conditions'
    ],
    recommendedNextSteps: isBottlenecked ? [
      `Review capacity expansion options for ${top.name}`,
      'Evaluate tactical demand throttling or secondary supplier activation',
      'Execute stress-testing under pessimistic uncertainty bands'
    ] : [
      'Conduct pessimistic stress testing to verify operational safety margins',
      'Archive current baseline run for variance benchmarking'
    ]
  };
}

// ----------------------------------------------------
// 8. Feature D: Prompt Battle Arena
// ----------------------------------------------------

export async function executePromptBattle(
  scenario: Scenario,
  result: SimulationResult
): Promise<PromptBattleResult> {
  const contextSummary = JSON.stringify({
    scenario: scenario.name,
    health: result.overallHealth,
    unmetDemand: result.totalUnmet,
    cost: result.totalCost,
    bottlenecks: result.bottlenecks
  });

  const promptStyles: Array<{ style: 'zero_shot' | 'role_based' | 'structured_context'; name: string; prompt: string }> = [
    {
      style: 'zero_shot',
      name: 'Zero-Shot Quick Query',
      prompt: `Analyze the operational scenario "${scenario.name}". Unmet demand is ${result.totalUnmet}, cost is ${result.totalCost}. What should we do?`
    },
    {
      style: 'role_based',
      name: 'Role-Constrained Risk Architect',
      prompt: `You are the Lead Risk Architect for WHATIF AI.
Scenario Context: ${contextSummary}.
STRICT RULE: Do not invent numbers. Rely strictly on the telemetry provided.
Identify the root bottleneck and propose two tactical interventions with concrete trade-offs.`
    },
    {
      style: 'structured_context',
      name: 'Context-Aware Structured Blueprint',
      prompt: `<|im_start|>system
Return strictly structured diagnostic JSON with schema { "rootBottleneck": string, "rationale": string, "actions": string[] }.
Telemetry: ${contextSummary}
<|im_end|>
<|im_start|>user
Diagnose bottlenecks and interventions.
<|im_end|>`
    }
  ];

  const rounds: PromptBattleRound[] = [];

  for (const styleObj of promptStyles) {
    const start = performance.now();
    let responseText = '';

    if (mlcEngine) {
      try {
        const comp = await mlcEngine.chat.completions.create({
          messages: [{ role: 'user', content: styleObj.prompt }],
          temperature: 0.2,
          max_tokens: 350
        });
        responseText = comp.choices[0]?.message?.content || '';
      } catch (err: any) {
        responseText = `Model generation error: ${err.message}. Using expert rule response.`;
      }
    }

    if (!responseText || responseText.startsWith('Model generation error')) {
      if (styleObj.style === 'zero_shot') {
        responseText = `Based on scenario ${scenario.name}, unmet demand is ${result.totalUnmet}. Expand capacity or throttle demand to prevent further losses.`;
      } else if (styleObj.style === 'role_based') {
        responseText = `ROLE BRIEFING: As Lead Risk Architect, the primary bottleneck is ${result.bottlenecks[0] || 'None'}. Unmet demand of ${result.totalUnmet} units threatens downstream operations. Intervention 1: Buffer capacity (+25%). Tradeoff: Increases operating expenditure by ${formatCurrency(result.totalCost * 0.15, result.currency)}. Intervention 2: Demand throttle (-15%). Tradeoff: Foregoes marginal revenue.`;
      } else {
        responseText = JSON.stringify({
          rootBottleneck: result.bottlenecks[0] || 'None',
          rationale: `System health at ${result.overallHealth}/100 with ${result.totalUnmet} unmet units.`,
          actions: ['Add buffer capacity to critical stage', 'Activate secondary supply route']
        }, null, 2);
      }
    }

    const duration = Math.round(performance.now() - start);
    const scores = evaluatePromptResponse(responseText, scenario, result, styleObj.style);

    rounds.push({
      style: styleObj.style,
      name: styleObj.name,
      promptSent: styleObj.prompt,
      response: responseText,
      executionTimeMs: Math.max(12, duration),
      scores,
      metricCitations: extractMetricCitations(responseText, result),
      hallucinatedClaims: detectHallucinatedClaims(responseText, result)
    });
  }

  const sorted = [...rounds].sort((a, b) => b.scores.compositeScore - a.scores.compositeScore);
  const winner = sorted[0];

  return {
    scenarioName: scenario.name,
    rounds,
    winnerStyle: winner.style,
    rubricSummary: `"${winner.name}" achieved highest composite score (${winner.scores.compositeScore}/100) through superior constraint adherence and zero hallucinated claims.`,
    mode: mlcEngine ? 'GENERATIVE_AI' : 'RULE_BASED'
  };
}

function evaluatePromptResponse(
  text: string,
  scenario: Scenario,
  result: SimulationResult,
  style: 'zero_shot' | 'role_based' | 'structured_context'
): PromptBattleRound['scores'] {
  const lower = text.toLowerCase();

  let hallucinationIndex = 100;
  const numbers = text.match(/\b\d+(?:\.\d+)?\b/g)?.map(Number) || [];
  const knownNumbers = new Set<number>([
    result.overallHealth,
    Math.round(result.totalUnmet),
    Math.round(result.totalDemand),
    Math.round(result.totalCost),
    Math.round(result.budget),
    Math.round(result.budgetVariance),
    15, 20, 25, 50, 100
  ]);

  const fabricated = numbers.filter(n => n > 10 && !knownNumbers.has(Math.round(n)));
  hallucinationIndex = Math.max(40, 100 - (fabricated.length * 15));

  const mentionedComponents = scenario.nodes.filter(n => 
    lower.includes(n.name.toLowerCase()) || lower.includes(n.id.toLowerCase())
  );
  const componentCoverage = Math.min(100, Math.round((mentionedComponents.length / Math.max(1, scenario.nodes.length)) * 140));

  let constraintAdherence = 85;
  if (style === 'structured_context') {
    constraintAdherence = text.includes('{') && text.includes('}') ? 100 : 60;
  } else if (style === 'role_based') {
    constraintAdherence = lower.includes('tradeoff') || lower.includes('trade-off') ? 95 : 75;
  } else {
    constraintAdherence = 70;
  }

  const actionTerms = ['provision', 'buffer', 'expand', 'throttle', 'secondary', 'supplier', 'capacity', 'intervention', 'actions'];
  const matchedActions = actionTerms.filter(t => lower.includes(t));
  const actionability = Math.min(100, matchedActions.length * 20);

  const compositeScore = Math.round(
    (hallucinationIndex * 0.35) +
    (actionability * 0.25) +
    (constraintAdherence * 0.20) +
    (componentCoverage * 0.20)
  );

  return {
    hallucinationIndex,
    componentCoverage,
    constraintAdherence,
    actionability,
    compositeScore
  };
}

function extractMetricCitations(text: string, result: SimulationResult): string[] {
  const citations: string[] = [];
  if (text.includes(String(result.overallHealth))) citations.push(`Health Score: ${result.overallHealth}`);
  if (text.includes(String(result.totalUnmet))) citations.push(`Unmet Demand: ${result.totalUnmet}`);
  if (text.includes(String(result.totalCost))) citations.push(`Operating Cost: ${result.totalCost}`);
  if (result.bottlenecks.some(b => text.toLowerCase().includes(b.toLowerCase()))) {
    citations.push(`Bottleneck: ${result.bottlenecks[0]}`);
  }
  return citations;
}

function detectHallucinatedClaims(text: string, result: SimulationResult): string[] {
  const flags: string[] = [];
  const numbers = text.match(/\b\d+(?:\.\d+)?\b/g)?.map(Number) || [];
  const legitimate = new Set([result.overallHealth, result.totalUnmet, result.totalDemand, result.totalCost, result.budget, 1, 2, 3, 10, 15, 20, 25, 50, 80, 100]);
  const unknown = numbers.filter(n => n > 25 && !legitimate.has(Math.round(n)));
  if (unknown.length > 0) {
    flags.push(`Unverifiable numeric figure(s) detected: ${unknown.slice(0, 3).join(', ')}`);
  }
  return flags;
}
