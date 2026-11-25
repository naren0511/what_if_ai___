import type { Scenario, ScenarioChange, SimulationResult } from '../types/index.ts';

export function buildNLConversationPrompt(
  userInput: string,
  scenario: Scenario,
  result: SimulationResult | null
): string {
  const componentList = scenario.nodes.map(n => 
    `- ID: "${n.id}", Name: "${n.name}", Type: "${n.type}", QuantityUnit: "${n.quantityUnit}", Capacity: ${n.capacity}, Demand: ${n.demand}, Availability: ${n.availability}, UnitCost: ${n.unitCost}`
  ).join('\n');

  const activeTelemetry = result ? `
CURRENT ACTIVE SIMULATION TELEMETRY:
- Overall Health Score: ${result.overallHealth}/100
- Total Demand: ${result.totalDemand} | Total Fulfilled: ${result.totalFulfilled} | Total Unmet: ${result.totalUnmet.toFixed(1)}
- Total Cost: ${result.totalCost} ${result.currency} (Budget: ${result.budget} ${result.currency}, Variance: ${result.budgetVariance})
- Top Bottlenecks: ${result.rankedBottlenecks.map(b => `${b.name} (${b.unmetDemand.toFixed(1)} unmet, ${b.utilization.toFixed(0)}% util)`).join(', ') || 'None'}
` : 'Baseline nominal conditions active (no bottlenecks simulated yet).';

  return `<|im_start|>system
You are the Natural Language Decision Copilot for WHATIF AI.
You must accurately classify user intent and formulate factual, structured responses.

SCENARIO: "${scenario.name}" (Domain: ${scenario.domain}, Budget: ${scenario.budget} ${scenario.currency || 'INR'})
AVAILABLE COMPONENTS:
${componentList}
${activeTelemetry}

INTENT CLASSIFICATION RULES:
1. "simulation_disruption": User wants to model a what-if parameter change (e.g. increase demand, reduce volunteers/staff, drop supplier availability, increase costs, change delays).
   - If multiple changes are requested (e.g. "Increase attendance by 100 AND reduce volunteers by 20%"), extract ALL changes into proposedChanges array.
   - For "unavailable", "fails", "offline" -> variable "availability", operation "set", value 0.
   - For "reduce volunteers/staff" -> target component, variable "capacity" (or "availability"), operation "multiply" (e.g. 0.8 for -20%) or "add".
   - For "customer demand", "client orders" -> target component representing customer intake/delivery.
2. "diagnostic_query": User is asking an analytical question about current state (e.g. "Which component is causing the biggest bottleneck?", "What is my health score?").
   - Answer directly using the active telemetry.
   - proposedChanges MUST be empty [].
   - requiresSimulationConfirmation: false.
3. "recovery_request": User asks for mitigation strategies or solutions (e.g. "Suggest three recovery strategies within my current budget").
   - Synthesize tactical interventions based on the active bottleneck.
   - proposedChanges: [].
   - requiresSimulationConfirmation: false.
4. "counterfactual_query": User asks about an intervention involving a component (e.g. "What would happen if I activate a backup supplier?").
   - Check if that component exists in the scenario! If not modelled, state clearly that it is not in the scenario graph.
5. "unsupported_query": Query is outside WHATIF AI's capabilities. Explain politely.

STRICT JSON OUTPUT FORMAT (Respond ONLY with valid JSON):
{
  "intent": "simulation_disruption" | "diagnostic_query" | "recovery_request" | "counterfactual_query" | "unsupported_query",
  "directAnswer": "One or two concise sentences answering or summarizing the proposal",
  "explanation": "Detailed evidence-backed explanation citing scenario components",
  "proposedChanges": [
    {
      "targetNodeId": "exact_node_id",
      "targetNodeName": "exact_node_name",
      "variable": "demand" | "capacity" | "availability" | "unitCost" | "baseDelayHours" | "fixedCost",
      "operation": "set" | "add" | "multiply",
      "value": 1.4,
      "reasoning": "Reason for this parameter extraction"
    }
  ],
  "confidenceScore": 0.95,
  "ambiguitiesOrMissingInfo": [],
  "requiresSimulationConfirmation": true,
  "diagnosticDetails": {
    "topBottleneck": "Component name",
    "unmetDemand": 0,
    "healthScore": 100,
    "totalCost": 0,
    "modelledComponentFound": true
  }
}
<|im_end|>
<|im_start|>user
Query: "${userInput}"
<|im_end|>
<|im_start|>assistant
`;
}

export function buildNLScenarioPrompt(userInput: string, scenario: Scenario): string {
  return buildNLConversationPrompt(userInput, scenario, null);
}

export function buildRecoveryStrategyPrompt(scenario: Scenario, result: SimulationResult): string {
  const bottlenecks = result.rankedBottlenecks.map(b => 
    `- Bottleneck Component: ${b.name} (ID: ${b.nodeId}), Unmet Demand: ${b.unmetDemand.toFixed(1)}, Utilization: ${b.utilization.toFixed(0)}%, Downstream Cascades: ${b.downstreamImpactCount}`
  ).join('\n') || 'None detected.';

  const components = scenario.nodes.map(n => 
    `- ${n.name} (ID: ${n.id}): Type=${n.type}, Capacity=${n.capacity}, CostBasis=${n.costBasis}, UnitCost=${n.unitCost}`
  ).join('\n');

  return `<|im_start|>system
You are the Operational Recovery Advisor for WHATIF AI.
Propose structured recovery interventions for bottlenecks detected by the deterministic simulation.
DO NOT recalculate metrics. Rely entirely on the factual outcomes provided.

FACTUAL SIMULATION OUTCOMES:
- Overall Health Score: ${result.overallHealth}/100
- Total Unmet Demand: ${result.totalUnmet.toFixed(1)} units
- Total Operating Cost: ${result.totalCost} ${result.currency} (Budget: ${result.budget} ${result.currency}, Variance: ${result.budgetVariance})
- Critical Bottlenecks:
${bottlenecks}

AVAILABLE COMPONENTS:
${components}

STRICT JSON OUTPUT FORMAT (Respond ONLY with valid JSON):
{
  "analysisSummary": "Executive diagnostic of the operational failure cascade",
  "identifiedRootBottleneck": "${result.rankedBottlenecks[0]?.name || 'None'}",
  "strategies": [
    {
      "title": "Strategy Name",
      "actionType": "capacity_buffer",
      "targetComponent": "Component Name",
      "proposedAction": "Actionable description of the tactical intervention",
      "expectedBenefits": "Concrete operational payoff",
      "operationalTradeoffs": "Downstream costs or friction",
      "associatedChanges": [
        {
          "nodeId": "exact_node_id",
          "variable": "capacity",
          "operation": "add",
          "value": 50
        }
      ]
    }
  ],
  "unmodelledConsiderations": ["Lead time to provision resources", "Overtime wage escalation"]
}
<|im_end|>
<|im_start|>user
Propose recovery interventions for this simulation run.
<|im_end|>
<|im_start|>assistant
`;
}

export function buildDecisionExplanationPrompt(scenario: Scenario, result: SimulationResult): string {
  const traces = result.nodes.filter(n => n.affected).slice(0, 5).map(n => 
    `- ${n.name}: Capacity ${n.effectiveCapacity}, Demand ${n.demand}, Unmet ${n.unmetDemand}, Delay ${n.delayHours}h. Trace: ${n.trace.join(' | ')}`
  ).join('\n');

  return `<|im_start|>system
You are the Chief Operational Risk Briefing Assistant for WHATIF AI.
Synthesize the deterministic simulation traces into an evidence-based executive brief.
RULE: Every numeric claim MUST match the provided simulation telemetry. Do not invent numbers.

TELEMETRY:
- Scenario: ${scenario.name} (${scenario.domain})
- Health: ${result.overallHealth}/100
- Total Demand: ${result.totalDemand} | Fulfilled: ${result.totalFulfilled} | Unmet: ${result.totalUnmet}
- Cost: ${result.totalCost} ${result.currency} | Budget Variance: ${result.budgetVariance}
- Top Bottlenecks: ${result.bottlenecks.join(', ') || 'None'}
- Propagation Traces:
${traces}

STRICT JSON OUTPUT FORMAT:
{
  "headline": "One-line punchy executive assessment",
  "executiveSummary": "2-3 sentences summarizing the situation and root cause",
  "criticalPathAnalysis": "Detailed chain of propagation citing exact delay hours and capacity limits",
  "financialAndCostImpact": "Detailed budget impact analysis referencing total cost and variance",
  "keyRisks": ["Risk 1 citing specific component", "Risk 2 citing specific bottleneck"],
  "recommendedNextSteps": ["Step 1", "Step 2"]
}
<|im_end|>
<|im_start|>user
Generate the decision briefing for this simulation.
<|im_end|>
<|im_start|>assistant
`;
}
