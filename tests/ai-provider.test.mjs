import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAICapabilities,
  cleanAndParseJSON,
  processNaturalLanguageQuery,
  interpretNaturalLanguageScenario,
  extractRuleBasedScenarioProposal,
  executeSimulationWithAIExplanation,
  generateRecoveryStrategies,
  generateRuleBasedRecoveryProposal,
  generateDecisionExplanation,
  generateRuleBasedDecisionExplanation,
  executePromptBattle
} from '../src/engine/aiProvider.ts';
import {
  NLConversationResponseSchema,
  NLScenarioProposalSchema,
  AIRecoveryProposalSchema,
  AIDecisionExplanationSchema
} from '../src/types/ai.ts';
import { simulate } from '../src/engine/simulation.ts';
import { templates } from '../src/data/templates.ts';

const clone = (obj) => JSON.parse(JSON.stringify(obj));
const getTemplate = (id) => clone(templates.find(t => t.id === id));

// ----------------------------------------------------
// 1. Capability & Environment Safety Tests
// ----------------------------------------------------

test('1. AI Capability check runs safely in any runtime environment without throwing', async () => {
  const caps = await checkAICapabilities();
  assert.ok(typeof caps.webgpuSupported === 'boolean');
  assert.ok(typeof caps.isCompatible === 'boolean');
  assert.ok(Array.isArray(caps.notes));
  assert.ok(caps.recommendedModel.length > 0);
});

// ----------------------------------------------------
// 2. Strict Zod Schema Parsing & Controlled Repair Tests
// ----------------------------------------------------

test('2. cleanAndParseJSON parses pristine JSON conforming to schema', () => {
  const pristine = JSON.stringify({
    interpretation: 'Supplier availability drops by 40%',
    proposedChanges: [
      {
        targetNodeId: 'supplier',
        targetNodeName: 'Primary Supplier',
        variable: 'availability',
        operation: 'multiply',
        value: 0.6,
        reasoning: '40% reduction'
      }
    ],
    confidenceScore: 0.95,
    unresolvedInformation: []
  });

  const res = cleanAndParseJSON(pristine, NLScenarioProposalSchema);
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.proposedChanges[0].value, 0.6);
    assert.equal(res.repaired, false);
  }
});

test('3. cleanAndParseJSON repairs markdown code fences and extraneous text', () => {
  const markdownFenced = `Here is the requested analysis:
\`\`\`json
{
  "interpretation": "Demand increases by 20%",
  "proposedChanges": [
    {
      "targetNodeId": "orders",
      "targetNodeName": "Customer Orders",
      "variable": "demand",
      "operation": "multiply",
      "value": 1.2,
      "reasoning": "20% surge"
    }
  ],
  "confidenceScore": 0.9,
  "unresolvedInformation": []
}
\`\`\`
Let me know if you need any adjustments!`;

  const res = cleanAndParseJSON(markdownFenced, NLScenarioProposalSchema);
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.proposedChanges[0].targetNodeId, 'orders');
    assert.equal(res.repaired, true);
  }
});

test('4. cleanAndParseJSON repairs trailing commas inside objects and arrays', () => {
  const trailingCommaJSON = `{
    "headline": "Bottleneck detected on Supplier",
    "executiveSummary": "Supplier capacity is degraded.",
    "criticalPathAnalysis": "Causes downstream starvation.",
    "financialAndCostImpact": "Budget overrun of ₹5000.",
    "keyRisks": ["Inventory exhaustion", "Delay propagation",],
    "recommendedNextSteps": ["Buffer capacity", "Demand throttle",],
  }`;

  const res = cleanAndParseJSON(trailingCommaJSON, AIDecisionExplanationSchema);
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.keyRisks.length, 2);
    assert.equal(res.repaired, true);
  }
});

test('5. cleanAndParseJSON rejects completely malformed non-JSON with informative error', () => {
  const garbage = 'I am an AI and cannot process this request right now.';
  const res = cleanAndParseJSON(garbage, NLScenarioProposalSchema);
  assert.equal(res.success, false);
  if (!res.success) {
    assert.ok(res.error.includes('No JSON object structure found'));
  }
});

// ----------------------------------------------------
// 3. Mandatory User Question Test Workflows
// ----------------------------------------------------

test('6. Mandatory Query 1: "What happens if customer demand increases by 40%?"', async () => {
  const scenario = getTemplate('supply-demo');
  const { response, mode } = await processNaturalLanguageQuery('What happens if customer demand increases by 40%?', scenario, null);

  assert.equal(response.intent, 'simulation_disruption');
  assert.equal(response.requiresSimulationConfirmation, true);
  assert.ok(response.proposedChanges.length > 0);

  const change = response.proposedChanges[0];
  assert.equal(change.targetNodeId, 'customers');
  assert.equal(change.variable, 'demand');
  assert.equal(change.operation, 'multiply');
  assert.equal(change.value, 1.4);
});

test('7. Mandatory Query 2: "What if my supplier becomes unavailable?"', async () => {
  const scenario = getTemplate('supply-demo');
  const { response } = await processNaturalLanguageQuery('What if my supplier becomes unavailable?', scenario, null);

  assert.equal(response.intent, 'simulation_disruption');
  assert.equal(response.requiresSimulationConfirmation, true);
  assert.ok(response.proposedChanges.length > 0);

  const change = response.proposedChanges[0];
  assert.equal(change.targetNodeId, 'supplier');
  assert.equal(change.variable, 'availability');
  assert.equal(change.operation, 'set');
  assert.equal(change.value, 0); // Complete outage
});

test('8. Mandatory Query 3: "Increase attendance by 100 and reduce volunteers by 20%."', async () => {
  const scenario = getTemplate('campus-demo');
  const { response } = await processNaturalLanguageQuery('Increase attendance by 100 and reduce volunteers by 20%.', scenario, null);

  assert.equal(response.intent, 'simulation_disruption');
  assert.equal(response.requiresSimulationConfirmation, true);
  assert.equal(response.proposedChanges.length, 2, 'Must extract both coordinated clauses');

  const attendChange = response.proposedChanges.find(c => c.targetNodeId === 'registration');
  const volChange = response.proposedChanges.find(c => c.targetNodeId === 'volunteers');

  assert.ok(attendChange && volChange);
  assert.equal(attendChange.variable, 'demand');
  assert.equal(attendChange.operation, 'add');
  assert.equal(attendChange.value, 100);

  assert.equal(volChange.variable, 'capacity');
  assert.equal(volChange.operation, 'multiply');
  assert.equal(volChange.value, 0.8); // 100% - 20% = 80% = 0.8
});

test('9. Mandatory Query 4: "Which component is causing the biggest bottleneck?"', async () => {
  const scenario = getTemplate('business-demo');
  // Induce bottleneck on supplier
  const simRes = simulate(scenario, [
    { id: 'c1', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.5, label: 'Supplier Shortage' }
  ]);

  const { response } = await processNaturalLanguageQuery('Which component is causing the biggest bottleneck?', scenario, simRes);

  assert.equal(response.intent, 'diagnostic_query');
  assert.equal(response.requiresSimulationConfirmation, false);
  assert.equal(response.proposedChanges.length, 0, 'Must NOT fabricate parameter changes for diagnostic questions');
  assert.ok(response.directAnswer.includes('Primary Supplier'));
  assert.ok(response.diagnosticDetails?.topBottleneck === 'Primary Supplier');
  assert.ok((response.diagnosticDetails?.unmetDemand ?? 0) > 0);
});

test('10. Mandatory Query 5: "Suggest three recovery strategies within my current budget."', async () => {
  const scenario = getTemplate('business-demo');
  const simRes = simulate(scenario, [
    { id: 'c1', nodeId: 'supplier', variable: 'availability', operation: 'set', value: 0.5, label: 'Supplier Shortage' }
  ]);

  const { response } = await processNaturalLanguageQuery('Suggest three recovery strategies within my current budget.', scenario, simRes);

  assert.equal(response.intent, 'recovery_request');
  assert.equal(response.requiresSimulationConfirmation, false);
  assert.ok(Array.isArray(response.suggestedRecoveryStrategies));
  assert.ok(response.suggestedRecoveryStrategies.length >= 3);
});

test('11. Mandatory Query 6: "What would happen if I activate a backup supplier?" (Unmodelled Component)', async () => {
  const scenario = getTemplate('supply-demo'); // Does not have a backup supplier
  const { response } = await processNaturalLanguageQuery('What would happen if I activate a backup supplier?', scenario, null);

  assert.equal(response.intent, 'counterfactual_query');
  assert.equal(response.requiresSimulationConfirmation, false);
  assert.equal(response.proposedChanges.length, 0);
  assert.ok(response.directAnswer.toLowerCase().includes('no backup supplier'));
  assert.equal(response.diagnosticDetails?.modelledComponentFound, false);
});

// ----------------------------------------------------
// 4. End-to-End Simulation Execution with AI Explanation
// ----------------------------------------------------

test('12. End-to-End Simulation Execution with AI Explanation calculates and grounds narrative', () => {
  const scenario = getTemplate('supply-demo');
  const changes = [
    { id: 'c1', nodeId: 'customers', variable: 'demand', operation: 'multiply', value: 1.4, label: 'Customer Demand Surge' }
  ];

  const exec = executeSimulationWithAIExplanation(scenario, changes);
  assert.ok(exec.baselineResult);
  assert.ok(exec.simulatedResult);
  assert.equal(exec.variance.unmetDemandDelta, 40);
  assert.equal(exec.variance.costDelta, 480);
  assert.ok(exec.aiExplanation.includes('unmet customer demand'));
  assert.ok(exec.aiExplanation.includes('Customer Delivery'));
});

// ----------------------------------------------------
// 5. Numerical Integrity Verification
// ----------------------------------------------------

test('13. INVARIANT: AI Copilot never mutates or overwrites simulation engine numbers', async () => {
  const scenario = getTemplate('campus-demo');
  const baseline = simulate(scenario, []);
  const initialCost = baseline.totalCost;
  const initialHealth = baseline.overallHealth;
  const initialUnmet = baseline.totalUnmet;

  await processNaturalLanguageQuery('What happens if customer demand increases by 40%?', scenario, baseline);
  await processNaturalLanguageQuery('Which component is causing the biggest bottleneck?', scenario, baseline);
  await processNaturalLanguageQuery('Suggest three recovery strategies within my current budget.', scenario, baseline);

  assert.equal(baseline.totalCost, initialCost);
  assert.equal(baseline.overallHealth, initialHealth);
  assert.equal(baseline.totalUnmet, initialUnmet);
});
