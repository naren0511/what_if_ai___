import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, BrainCircuit,
  Check, CheckCircle2, ChevronDown, CircleHelp, Clock, Copy, Download,
  ExternalLink, FileText, GitBranch, GraduationCap, History, Home,
  Layers, Lightbulb, Network, Play, Plus, RefreshCw, Save, Scale,
  ShieldCheck, SlidersHorizontal, Sparkles, Star, Store, Trash2, Truck,
  Workflow, X, Zap, Sun, Moon, Bell, Info, Edit3, UploadCloud,
  Bot, Cpu, Flame, MessageSquare, Send
} from 'lucide-react';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, LineChart, Line } from 'recharts';
import { templates } from './data/templates.ts';
import { detectCycle, formatCurrency, simulate, validateGraph, DEFAULT_UNCERTAINTY_SETTINGS, simulateUncertaintyBands } from './engine/simulation.ts';
import { evaluateAlternatives, getRecommendations } from './engine/advisor.ts';
import {
  checkAICapabilities,
  initializeLocalAI,
  isLocalAIReady,
  unloadLocalAI,
  processNaturalLanguageQuery,
  interpretNaturalLanguageScenario,
  executeSimulationWithAIExplanation,
  type SimulationExecutionWithAI,
  generateRecoveryStrategies,
  generateDecisionExplanation,
  executePromptBattle
} from './engine/aiProvider.ts';
import {
  SUPPORTED_LOCAL_MODELS,
  type AICapabilities,
  type AIProgress,
  type AIModelId,
  type NLConversationResponse,
  type NLScenarioProposal,
  type AIRecoveryProposal,
  type AIDecisionExplanation,
  type PromptBattleResult
} from './types/ai.ts';
import { ScenarioSchema, SimNodeSchema, SimEdgeSchema } from './types/schema.ts';
import type {
  Domain,
  Scenario,
  ScenarioChange,
  SimEdge,
  SimNode,
  SimulationResult,
  SavedRun,
  DependencyType,
  ConfigurableUncertaintySettings,
  UncertaintyBandResult,
  DetailedRecommendation,
  AlternativeEvaluation
} from './types/index.ts';
import {
  loadSafeHistory,
  saveSafeHistory,
  loadSafeScenarios,
  saveSafeScenarios,
  createBackupJSON,
  parseAndValidateBackup
} from './utils/storage.ts';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'builder', label: 'Scenario Builder', icon: Workflow },
  { id: 'simulator', label: 'What-If Simulator', icon: Play },
  { id: 'map', label: 'Decision Map', icon: Network },
  { id: 'compare', label: 'Compare Scenarios', icon: Scale },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'history', label: 'History', icon: History },
  { id: 'prompt', label: 'Prompt Studio', icon: BrainCircuit }
] as const;

type Page = typeof navItems[number]['id'];
const copyScenario = (s: Scenario): Scenario => JSON.parse(JSON.stringify(s));

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [scenario, setScenario] = useState<Scenario>(() => copyScenario(templates[0]));
  const [changes, setChanges] = useState<ScenarioChange[]>([]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [history, setHistory] = useState<SavedRun[]>(() => loadSafeHistory());
  const [savedScenarios, setSavedScenarios] = useState<Scenario[]>(() => loadSafeScenarios());
  const [lastExecTimeMs, setLastExecTimeMs] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [isLightMode, setIsLightMode] = useState(false);

  // Builder form state
  const [changeNode, setChangeNode] = useState(templates[0].nodes[0]?.id || '');
  const [changeVar, setChangeVar] = useState<ScenarioChange['variable']>('demand');
  const [changeOperation, setChangeOperation] = useState<ScenarioChange['operation']>('set');
  const [changeValue, setChangeValue] = useState('350');
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeType, setNewNodeType] = useState('process');
  const [newNodeCapacity, setNewNodeCapacity] = useState('200');
  const [newNodeDemand, setNewNodeDemand] = useState('180');
  const [newNodeUnitCost, setNewNodeUnitCost] = useState('50');
  const [newNodePriority, setNewNodePriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newEdgeSource, setNewEdgeSource] = useState('');
  const [newEdgeTarget, setNewEdgeTarget] = useState('');
  const [newEdgeType, setNewEdgeType] = useState<DependencyType>('requires');
  const [newEdgeInfluence, setNewEdgeInfluence] = useState('0.7');
  const [activeTrace, setActiveTrace] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [uncertaintySettings, setUncertaintySettings] = useState<ConfigurableUncertaintySettings>(DEFAULT_UNCERTAINTY_SETTINGS);

  useEffect(() => {
    saveSafeHistory(history);
  }, [history]);

  useEffect(() => {
    saveSafeScenarios(savedScenarios);
  }, [savedScenarios]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (!scenario.nodes.some(n => n.id === changeNode)) {
      setChangeNode(scenario.nodes[0]?.id || '');
    }
  }, [scenario, changeNode]);

  const baseline = useMemo(() => {
    try {
      return simulate(scenario, [], 'Baseline');
    } catch {
      return null;
    }
  }, [scenario]);

  const recommendations = result ? getRecommendations(result) : [];

  function selectTemplate(id: string) {
    const found = templates.find(t => t.id === id) || savedScenarios.find(s => s.id === id);
    if (!found) return;
    setScenario(copyScenario(found));
    setChanges([]);
    setResult(null);
    setToast(`${found.name} loaded`);
  }

  function runSimulation() {
    const t0 = performance.now();
    try {
      const r = simulate(scenario, changes, 'Disrupted scenario');
      const duration = Math.max(1, Math.round(performance.now() - t0));
      setLastExecTimeMs(duration);
      setResult(r);
      setPage('simulator');
      setToast(`Simulation completed in ${duration}ms`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Simulation could not run');
    }
  }

  function addChange() {
    if (!changeNode) return;
    const value = Number(changeValue);
    if (!Number.isFinite(value) || value < 0) {
      setToast('Enter a valid non-negative number');
      return;
    }
    const node = scenario.nodes.find(n => n.id === changeNode);
    const label = `${node?.name || 'Component'} · ${changeVar} ${changeOperation} ${value}`;
    setChanges(old => [...old, {
      id: crypto.randomUUID(),
      nodeId: changeNode,
      variable: changeVar,
      operation: changeOperation,
      value,
      label
    }]);
    setResult(null);
    setToast('Change added to scenario');
  }

  function saveRun(r = result) {
    if (!r) {
      setToast('Run a simulation first');
      return;
    }
    const run: SavedRun = {
      id: crypto.randomUUID(),
      scenario: copyScenario(scenario),
      result: r,
      savedAt: new Date().toISOString(),
      durationMs: lastExecTimeMs ?? undefined
    };
    setHistory(old => [run, ...old].slice(0, 50));
    setToast('Simulation run saved to history');
  }

  function exportBackup() {
    const json = createBackupJSON(savedScenarios, history);
    downloadFile(`whatif-ai-backup-${Date.now()}.json`, json, 'application/json');
    setToast('Complete backup exported successfully');
  }

  function importBackup(file: File) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = String(e.target?.result || '');
        const restored = parseAndValidateBackup(text);
        setSavedScenarios(restored.scenarios);
        setHistory(restored.history);
        saveSafeScenarios(restored.scenarios);
        saveSafeHistory(restored.history);
        setToast(`Restored ${restored.scenarios.length} scenario(s) and ${restored.history.length} simulation run(s)`);
      } catch (err: any) {
        setToast(`Backup error: ${err.message}`);
      }
    };
    reader.onerror = () => setToast('Failed to read the backup file');
    reader.readAsText(file);
  }

  function saveScenario() {
    const parseRes = ScenarioSchema.safeParse(scenario);
    if (!parseRes.success) {
      setToast(`Validation error: ${parseRes.error.errors[0]?.message}`);
      return;
    }
    const updated = {
      ...copyScenario(scenario),
      id: scenario.id.startsWith('custom') ? scenario.id : `custom-${crypto.randomUUID().slice(0, 8)}`,
      domain: 'custom' as Domain
    };
    setScenario(updated);
    setSavedScenarios(old => [updated, ...old.filter(s => s.id !== updated.id)]);
    setToast('Scenario saved to local models');
  }

  function addNode() {
    const name = newNodeName.trim();
    const capacity = Number(newNodeCapacity);
    const demand = Number(newNodeDemand);
    const unitCost = Number(newNodeUnitCost);
    if (!name || !Number.isFinite(capacity) || capacity <= 0) {
      setToast('Enter a valid component name and positive capacity');
      return;
    }
    const id = `node-${crypto.randomUUID().slice(0, 8)}`;
    const node: SimNode = {
      id,
      name,
      type: newNodeType,
      quantityUnit: 'units',
      operatingPeriod: 'day',
      costCurrency: scenario.currency || 'INR',
      costBasis: 'per_fulfilled',
      fixedCost: 0,
      demand: Math.max(0, demand),
      capacity,
      availability: 1,
      unitCost: Math.max(0, unitCost),
      baseDelayHours: 0,
      priority: newNodePriority,
      description: 'Custom component'
    };
    setScenario(s => ({ ...s, nodes: [...s.nodes, node], domain: 'custom' }));
    setNewNodeName('');
    setToast('Component added to scenario');
  }

  function addEdge() {
    if (!newEdgeSource || !newEdgeTarget || newEdgeSource === newEdgeTarget) {
      setToast('Choose two distinct components');
      return;
    }
    const edge: SimEdge = {
      id: `edge-${crypto.randomUUID().slice(0, 8)}`,
      source: newEdgeSource,
      target: newEdgeTarget,
      type: newEdgeType,
      influence: Math.max(0, Math.min(1, Number(newEdgeInfluence)))
    };
    const proposed = { ...scenario, edges: [...scenario.edges, edge] };
    const validation = validateGraph(proposed.nodes, proposed.edges);
    if (!validation.valid) {
      setToast(`Graph error: ${validation.errors.join('; ')}`);
      return;
    }
    setScenario(proposed);
    setToast('Dependency added');
  }

  function exportJSON() {
    if (!result) {
      setToast('Run a simulation before exporting');
      return;
    }
    downloadFile(
      `whatif-report-${scenario.id}-${Date.now()}.json`,
      JSON.stringify({ scenario, changes, result, recommendations, exportedAt: new Date().toISOString() }, null, 2),
      'application/json'
    );
  }

  function exportMarkdown() {
    if (!result) {
      setToast('Run a simulation before exporting');
      return;
    }
    const text = `# WHATIF AI — Scenario Decision Report

**Scenario:** ${scenario.name} (${scenario.domain.toUpperCase()})  
**Simulation Label:** ${result.label}  
**Overall Heuristic Health Index:** ${result.overallHealth}/100  
**Report Timestamp:** ${new Date().toLocaleString()}  

---

## Executive Summary
- **Overall Health Index:** ${result.overallHealth}/100 (Heuristic scenario health index)
- **Total Demand:** ${result.totalDemand.toLocaleString()}
- **Fulfilled Demand:** ${result.totalFulfilled.toFixed(1)} (${((result.totalFulfilled / Math.max(1, result.totalDemand)) * 100).toFixed(1)}%)
- **Unmet Demand:** ${result.totalUnmet.toFixed(1)}
- **Estimated Operating Cost:** ${formatCurrency(result.totalCost)}
- **Configured Budget:** ${formatCurrency(result.budget)} (Variance: ${formatCurrency(result.budgetVariance)})
- **Average Utilization:** ${result.averageUtilization.toFixed(1)}%

---

## Heuristic Scenario Health Score Breakdown
- **Fulfilment Ratio Score (50% weight):** ${result.healthBreakdown.fulfilmentScore}/100
- **Budget Compliance Score (25% weight):** ${result.healthBreakdown.budgetScore}/100
- **Capacity Utilization Score (15% weight):** ${result.healthBreakdown.utilizationScore}/100
- **Lead-time Delay Score (10% weight):** ${result.healthBreakdown.delayScore}/100
- **Constraint Overrun Penalty:** -${result.healthBreakdown.penalty} pts
${result.healthBreakdown.notes.length ? result.healthBreakdown.notes.map(n => `  * ${n}`).join('\n') : '  * No penalties applied.'}

---

## Ranked Bottlenecks (Transparent Impact Scoring)
${result.rankedBottlenecks.length > 0 ? result.rankedBottlenecks.map((b, i) => `### ${i + 1}. ${b.name} [${b.severity.toUpperCase()}]
- **Impact Score:** ${b.impactScore}
- **Unmet Demand:** ${b.unmetDemand.toFixed(1)} units
- **Capacity Utilization:** ${b.utilization.toFixed(0)}%
- **Downstream Components Affected:** ${b.downstreamImpactCount}
- **Diagnostic Reason:** ${b.reason}
`).join('\n') : '- No active bottlenecks detected.'}

---

## Active Disruption & Changes
${result.changeSummary.length ? result.changeSummary.map(x => `- ${x}`).join('\n') : '- Baseline run (no changes applied)'}

---

## Component Level Results
| Component | Effective Capacity | Fulfilled | Unmet Demand | Utilization | Delay | Impact Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${result.nodes.map(n => `| ${n.name} | ${n.effectiveCapacity.toFixed(1)} | ${n.fulfilled.toFixed(1)} | ${n.unmetDemand.toFixed(1)} | ${n.utilization.toFixed(0)}% | ${n.delayHours.toFixed(1)}h | ${n.directImpact ? 'Direct Disruption' : n.affected ? 'Downstream Impacted' : 'Stable'} |`).join('\n')}

---

## Decision Intelligence Recommendations
${recommendations.map(r => `### ${r.problem} [${r.severity.toUpperCase()} · ${r.feasibilityStatus.toUpperCase()}]
- **Relevant Component:** ${r.component}
- **Numerical Evidence:** ${r.numericalEvidence}
- **Suggested Intervention:** ${r.suggestedIntervention}
- **Expected Benefit:** ${r.expectedBenefit}
- **Cost / Operational Trade-off:** ${r.tradeoff}
- **Underlying Assumption:** ${r.assumption}
`).join('\n')}

---

## Calculation Traces & Explainability
${result.nodes.filter(n => n.trace.length > 0).map(n => `### ${n.name}
${n.trace.map(t => `- ${t}`).join('\n')}
`).join('\n') || '- No upstream dependency traces.'}

---

## Modeling Assumptions & Limitations
${result.assumptionNotes.map(a => `- ${a}`).join('\n')}
`;
    downloadFile(`whatif-report-${scenario.id}-${Date.now()}.md`, text, 'text/markdown');
  }

  function downloadFile(name: string, body: string, type: string) {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`app-shell ${isLightMode ? 'light-mode' : ''}`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand-section">
          <div className="brand-logo-glow">
            <BrainCircuit size={26} />
          </div>
          <div>
            <div className="brand-title">WHATIF <span>AI</span></div>
            <div className="brand-tagline">Simulate. Decide. Plan Ahead.</div>
          </div>
        </div>

        <nav className="nav-menu">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = page === item.id;
            return (
              <button
                key={item.id}
                className={`nav-link ${isActive ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Bottom Card matching Reference */}
        <div className="sidebar-cta-card">
          <div className="sidebar-orb">
            <BrainCircuit size={28} />
          </div>
          <div className="sidebar-cta-text">
            Think Ahead.<br />With WHATIF AI.
          </div>
          <button
            className="sidebar-cta-btn"
            title="Explore Simulations"
            onClick={() => setPage('simulator')}
          >
            <ArrowRight size={15} />
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="main-wrapper">
        {page === 'dashboard' && (
          <DashboardScreen
            scenario={scenario}
            baseline={baseline}
            history={history}
            lastExecTimeMs={lastExecTimeMs}
            savedScenarios={savedScenarios}
            onSelectTemplate={(id: string) => {
              selectTemplate(id);
              setPage('simulator');
            }}
            onOpenRun={(run: SavedRun) => {
              setScenario(copyScenario(run.scenario));
              setResult(run.result);
              setChanges([]);
              setPage('reports');
            }}
            onNavigate={setPage}
            isLightMode={isLightMode}
            setIsLightMode={setIsLightMode}
          />
        )}

        {page === 'builder' && (
          <BuilderScreen
            scenario={scenario}
            setScenario={setScenario}
            savedScenarios={savedScenarios}
            newNodeName={newNodeName}
            setNewNodeName={setNewNodeName}
            newNodeType={newNodeType}
            setNewNodeType={setNewNodeType}
            newNodeCapacity={newNodeCapacity}
            setNewNodeCapacity={setNewNodeCapacity}
            newNodeDemand={newNodeDemand}
            setNewNodeDemand={setNewNodeDemand}
            newNodeUnitCost={newNodeUnitCost}
            setNewNodeUnitCost={setNewNodeUnitCost}
            newNodePriority={newNodePriority}
            setNewNodePriority={setNewNodePriority}
            addNode={addNode}
            newEdgeSource={newEdgeSource}
            setNewEdgeSource={setNewEdgeSource}
            newEdgeTarget={newEdgeTarget}
            setNewEdgeTarget={setNewEdgeTarget}
            newEdgeType={newEdgeType}
            setNewEdgeType={setNewEdgeType}
            newEdgeInfluence={newEdgeInfluence}
            setNewEdgeInfluence={setNewEdgeInfluence}
            addEdge={addEdge}
            saveScenario={saveScenario}
            onLoad={selectTemplate}
          />
        )}

        {page === 'simulator' && (
          <SimulatorScreen
            scenario={scenario}
            changes={changes}
            setChanges={setChanges}
            changeNode={changeNode}
            setChangeNode={setChangeNode}
            changeVar={changeVar}
            setChangeVar={setChangeVar}
            changeOperation={changeOperation}
            setChangeOperation={setChangeOperation}
            changeValue={changeValue}
            setChangeValue={setChangeValue}
            addChange={addChange}
            result={result}
            baseline={baseline}
            runSimulation={runSimulation}
            saveRun={saveRun}
            activeTrace={activeTrace}
            setActiveTrace={setActiveTrace}
            uncertaintySettings={uncertaintySettings}
            setUncertaintySettings={setUncertaintySettings}
          />
        )}

        {page === 'map' && (
          <DecisionMapScreen
            scenario={scenario}
            result={result}
            baseline={baseline}
          />
        )}

        {page === 'compare' && (
          <CompareScreen
            scenario={scenario}
            changes={changes}
            result={result}
            baseline={baseline}
            onRun={runSimulation}
          />
        )}

        {page === 'reports' && (
          <ReportsScreen
            result={result}
            scenario={scenario}
            recommendations={recommendations}
            exportJSON={exportJSON}
            exportMarkdown={exportMarkdown}
            onGo={() => setPage('simulator')}
          />
        )}

        {page === 'history' && (
          <HistoryScreen
            history={history}
            onOpen={(run: SavedRun) => {
              setScenario(copyScenario(run.scenario));
              setResult(run.result);
              setChanges([]);
              setPage('reports');
            }}
            onDelete={(id: string) => setHistory(h => h.filter(r => r.id !== id))}
            onClear={() => {
              setHistory([]);
              setToast('History cleared');
            }}
            exportBackup={exportBackup}
            importBackup={importBackup}
          />
        )}

        {page === 'prompt' && (
          <PromptStudioScreen
            scenario={scenario}
            changes={changes}
            result={result}
            copied={promptCopied}
            setCopied={setPromptCopied}
            onQueueChange={(newChange: ScenarioChange) => {
              setChanges(prev => [...prev, newChange]);
              setToast(`Queued scenario change: ${newChange.label}`);
            }}
            onSwitchToSimulator={() => setPage('simulator')}
          />
        )}
      </main>

      {/* Floating Glass Toast */}
      {toast && (
        <div className="toast-glass">
          <CheckCircle2 size={18} color="#00f0ff" />
          <span>{toast}</span>
          <button onClick={() => setToast('')} style={{ marginLeft: 8, opacity: 0.7 }}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// 1. DASHBOARD SCREEN (Matches Reference Image Exactly)
// ----------------------------------------------------
function DashboardScreen({
  scenario,
  baseline,
  history,
  lastExecTimeMs,
  savedScenarios,
  onSelectTemplate,
  onOpenRun,
  onNavigate,
  isLightMode,
  setIsLightMode
}: {
  scenario: Scenario;
  baseline: SimulationResult | null;
  history: SavedRun[];
  lastExecTimeMs: number | null;
  savedScenarios: Scenario[];
  onSelectTemplate: (id: string) => void;
  onOpenRun: (run: SavedRun) => void;
  onNavigate: (p: Page) => void;
  isLightMode: boolean;
  setIsLightMode: (v: boolean) => void;
}) {
  const totalSimulations = history.length;
  const successfulRuns = history.filter(h => h.result.totalUnmet === 0 && h.result.budgetVariance <= 0);
  const successRate = totalSimulations > 0 ? Math.round((successfulRuns.length / totalSimulations) * 100) : null;

  const timings = history
    .map(h => h.durationMs)
    .filter((t): t is number => typeof t === 'number');
  const avgExecutionTime = timings.length > 0
    ? `${Math.round(timings.reduce((a, b) => a + b, 0) / timings.length)}ms`
    : lastExecTimeMs
      ? `${lastExecTimeMs}ms`
      : null;

  const decisionsOptimized = history.reduce((count, h) => {
    try {
      const alts = evaluateAlternatives(h.scenario, []);
      return count + alts.filter(a => a.isViable && a.strategyKey !== 'baseline').length;
    } catch {
      return count;
    }
  }, 0);

  const chartData = [
    { day: 'Mon', simulations: 3, optimizations: 2 },
    { day: 'Tue', simulations: 6, optimizations: 4 },
    { day: 'Wed', simulations: 8, optimizations: 6 },
    { day: 'Thu', simulations: 8, optimizations: 5 },
    { day: 'Fri', simulations: 11, optimizations: 8 },
    { day: 'Sat', simulations: 13, optimizations: 10 },
    { day: 'Sun', simulations: 12, optimizations: 8 }
  ];

  return (
    <>
      {/* Top Header */}
      <header className="top-header">
        <div className="welcome-title-wrap">
          <h1 className="welcome-heading">Welcome Back, <span>Developer!</span></h1>
          <div className="welcome-accent-line" />
          <p className="welcome-subtext">
            Explore the ripple effects of your decisions with AI-powered simulations.
          </p>
        </div>

        {/* 3D Holographic Cube Art from Reference */}
        <div className="hologram-container">
          <div className="holo-orbit-ring holo-orbit-1" />
          <div className="holo-orbit-ring holo-orbit-2" />
          <div className="holo-cube">?</div>
        </div>

        <div className="top-user-actions">
          <div
            className="theme-toggle-pill"
            onClick={() => setIsLightMode(!isLightMode)}
            style={{ cursor: 'pointer' }}
          >
            <Sun size={14} color={isLightMode ? '#00f0ff' : '#64748b'} />
            <div className="toggle-track">
              <div
                className="toggle-thumb"
                style={{ right: isLightMode ? 'auto' : '2px', left: isLightMode ? '2px' : 'auto' }}
              />
            </div>
            <Moon size={14} color={!isLightMode ? '#a855f7' : '#64748b'} />
          </div>

          <button className="top-icon-btn" title="System Ready">
            <Bell size={18} />
            <span className="notif-badge">{history.length}</span>
          </button>

          <div className="user-avatar-circle">JD</div>
        </div>
      </header>

      {/* Row 1: KPI Metrics Cards */}
      <div className="kpi-row">
        {/* Card 1: Total Simulations */}
        <div className="glass-panel kpi-card">
          <div className="kpi-icon-circle kpi-icon-purple">
            <Zap size={22} />
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Total Simulations</div>
            <div className="kpi-value-row">
              <span className="kpi-value">{totalSimulations}</span>
              <span className="kpi-trend trend-up" style={{ fontSize: 11 }}>
                {totalSimulations > 0 ? `${totalSimulations} run(s) saved` : 'Empty state (no runs)'}
              </span>
            </div>
          </div>
          {/* Neon mini wave SVG */}
          <svg className="kpi-wave-svg" viewBox="0 0 60 25" fill="none">
            <path d="M2 18 Q 15 5, 30 14 T 58 4" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        {/* Card 2: Success Rate */}
        <div className="glass-panel kpi-card">
          <div className="kpi-icon-circle kpi-icon-green">
            <Check size={22} />
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Success Rate</div>
            <div className="kpi-value-row">
              <span className="kpi-value">{successRate !== null ? `${successRate}%` : '—'}</span>
              <span className="kpi-trend trend-up" style={{ fontSize: 11 }}>
                {successRate !== null ? '0 unmet & on budget' : 'Simulate to compute'}
              </span>
            </div>
          </div>
          <svg className="kpi-wave-svg" viewBox="0 0 60 25" fill="none">
            <path d="M2 20 Q 18 8, 35 15 T 58 6" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        {/* Card 3: Avg Response Time */}
        <div className="glass-panel kpi-card">
          <div className="kpi-icon-circle kpi-icon-blue">
            <Clock size={22} />
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Avg. Execution Time</div>
            <div className="kpi-value-row">
              <span className="kpi-value">{avgExecutionTime !== null ? avgExecutionTime : '—'}</span>
              <span className="kpi-trend trend-up" style={{ fontSize: 11 }}>
                {avgExecutionTime !== null ? 'Measured runtime' : 'Pending runs'}
              </span>
            </div>
          </div>
          <svg className="kpi-wave-svg" viewBox="0 0 60 25" fill="none">
            <path d="M2 6 Q 16 19, 32 10 T 58 20" stroke="#00f0ff" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        {/* Card 4: Decisions Optimized */}
        <div className="glass-panel kpi-card">
          <div className="kpi-icon-circle kpi-icon-gold">
            <Star size={22} />
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Decisions Optimized</div>
            <div className="kpi-value-row">
              <span className="kpi-value">{decisionsOptimized}</span>
              <span className="kpi-trend trend-up" style={{ fontSize: 11 }}>
                {decisionsOptimized > 0 ? 'Viable alternatives' : 'Run comparison'}
              </span>
            </div>
          </div>
          <svg className="kpi-wave-svg" viewBox="0 0 60 25" fill="none">
            <path d="M2 18 Q 15 4, 30 12 T 58 5" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Row 2: Middle Split (Recent Scenarios & Simulation Overview) */}
      <div className="mid-row">
        {/* Left Card: Your Recent Scenarios */}
        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          <div className="panel-header">
            <div className="panel-header-left">
              <div className="panel-icon-circle" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#c084fc' }}>
                <Zap size={18} />
              </div>
              <h3 className="panel-title">Your Recent Scenarios</h3>
            </div>
            <button className="panel-action-link" onClick={() => onNavigate('history')}>
              View All <ArrowRight size={14} />
            </button>
          </div>

          <div className="scenario-list">
            {history.length > 0 ? (
              history.slice(0, 3).map((run) => (
                <div
                  key={run.id}
                  className="scenario-item-card"
                  onClick={() => onOpenRun(run)}
                >
                  <div className="scenario-item-left">
                    <div className="scenario-thumb">
                      {run.scenario.domain === 'campus' ? <GraduationCap size={24} color="#00f0ff" /> :
                       run.scenario.domain === 'business' ? <Store size={24} color="#d946ef" /> :
                       <Truck size={24} color="#f59e0b" />}
                    </div>
                    <div>
                      <div className="scenario-info-title">{run.scenario.name}</div>
                      <div className="scenario-info-sub">{new Date(run.savedAt).toLocaleDateString()} · {run.result.label}</div>
                    </div>
                  </div>
                  <div className="scenario-item-right">
                    <span className="status-badge-completed">{run.result.overallHealth}/100 Health</span>
                    <span className="icon-open-btn"><ExternalLink size={16} /></span>
                  </div>
                </div>
              ))
            ) : (
              <>
                {/* Item 1: Campus Event Demo */}
                <div
                  className="scenario-item-card"
                  onClick={() => onSelectTemplate('campus-demo')}
                >
                  <div className="scenario-item-left">
                    <div className="scenario-thumb">
                      <GraduationCap size={24} color="#00f0ff" />
                    </div>
                    <div>
                      <div className="scenario-info-title">Campus Event – Tech Symposium</div>
                      <div className="scenario-info-sub">Starter Demonstration Template</div>
                    </div>
                  </div>
                  <div className="scenario-item-right">
                    <span className="priority-pill priority-medium" style={{ fontSize: 10 }}>Demo Template</span>
                    <span className="icon-open-btn"><ExternalLink size={16} /></span>
                  </div>
                </div>

                {/* Item 2: Retail Business Demo */}
                <div
                  className="scenario-item-card"
                  onClick={() => onSelectTemplate('business-demo')}
                >
                  <div className="scenario-item-left">
                    <div className="scenario-thumb">
                      <Store size={24} color="#d946ef" />
                    </div>
                    <div>
                      <div className="scenario-info-title">Retail Business – Holiday Rush</div>
                      <div className="scenario-info-sub">Starter Demonstration Template</div>
                    </div>
                  </div>
                  <div className="scenario-item-right">
                    <span className="priority-pill priority-medium" style={{ fontSize: 10 }}>Demo Template</span>
                    <span className="icon-open-btn"><ExternalLink size={16} /></span>
                  </div>
                </div>

                {/* Item 3: Supply Chain Demo */}
                <div
                  className="scenario-item-card"
                  onClick={() => onSelectTemplate('supply-demo')}
                >
                  <div className="scenario-item-left">
                    <div className="scenario-thumb">
                      <Truck size={24} color="#f59e0b" />
                    </div>
                    <div>
                      <div className="scenario-info-title">Supply Chain – Delivery Delay</div>
                      <div className="scenario-info-sub">Starter Demonstration Template</div>
                    </div>
                  </div>
                  <div className="scenario-item-right">
                    <span className="priority-pill priority-medium" style={{ fontSize: 10 }}>Demo Template</span>
                    <span className="icon-open-btn"><ExternalLink size={16} /></span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Card: Simulation Overview Chart */}
        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          <div className="panel-header">
            <div className="panel-header-left">
              <div className="panel-icon-circle" style={{ background: 'rgba(0, 240, 255, 0.2)', color: '#00f0ff' }}>
                <Activity size={18} />
              </div>
              <h3 className="panel-title">Simulation Overview</h3>
            </div>
            <div className="chart-legend-wrap">
              <span className="priority-pill priority-low" style={{ fontSize: 10 }}>
                {history.length > 0 ? `${history.length} Live Runs Recorded` : 'Starter Demonstration Telemetry'}
              </span>
            </div>
          </div>

          <div className="chart-container-inner">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255, 255, 255, 0.08)" vertical={false} />
                <XAxis
                  dataKey="day"
                  stroke="#64748b"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  stroke="#64748b"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  domain={[0, 15]}
                  ticks={[0, 5, 10, 15]}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(10, 16, 42, 0.95)',
                    border: '1px solid rgba(0, 240, 255, 0.4)',
                    borderRadius: 12,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    color: '#fff',
                    fontSize: 12
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="simulations"
                  stroke="#00f0ff"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#00f0ff', strokeWidth: 2, stroke: '#ffffff' }}
                  activeDot={{ r: 6, fill: '#00f0ff', stroke: '#ffffff' }}
                />
                <Line
                  type="monotone"
                  dataKey="optimizations"
                  stroke="#b052ff"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#b052ff', strokeWidth: 2, stroke: '#ffffff' }}
                  activeDot={{ r: 6, fill: '#b052ff', stroke: '#ffffff' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 3: Bottom Split (Explore Domains & Quick Actions) */}
      <div className="bottom-row">
        {/* Left: Explore Domains */}
        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          <div className="panel-header" style={{ marginBottom: 8 }}>
            <div className="panel-header-left">
              <div className="panel-icon-circle" style={{ background: 'rgba(0, 240, 255, 0.2)', color: '#00f0ff' }}>
                <BrainCircuit size={18} />
              </div>
              <h3 className="panel-title">Explore Domains</h3>
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>
            Choose a domain to start simulating
          </p>

          <div className="domain-grid-4">
            {/* Campus & Events */}
            <div
              className="domain-glass-card"
              onClick={() => onSelectTemplate('campus-demo')}
            >
              <div className="domain-icon-box" style={{ background: 'rgba(0, 240, 255, 0.15)', color: '#00f0ff' }}>
                <GraduationCap size={24} />
              </div>
              <div className="domain-name-text">Campus &<br />Events</div>
              <span className="domain-arrow-btn"><ArrowRight size={15} /></span>
            </div>

            {/* Small Business */}
            <div
              className="domain-glass-card"
              onClick={() => onSelectTemplate('business-demo')}
            >
              <div className="domain-icon-box" style={{ background: 'rgba(217, 70, 239, 0.15)', color: '#d946ef' }}>
                <Store size={24} />
              </div>
              <div className="domain-name-text">Small<br />Business</div>
              <span className="domain-arrow-btn"><ArrowRight size={15} /></span>
            </div>

            {/* Supply Chain */}
            <div
              className="domain-glass-card"
              onClick={() => onSelectTemplate('supply-demo')}
            >
              <div className="domain-icon-box" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                <Truck size={24} />
              </div>
              <div className="domain-name-text">Supply<br />Chain</div>
              <span className="domain-arrow-btn"><ArrowRight size={15} /></span>
            </div>

            {/* Custom Scenario */}
            <div
              className="domain-glass-card"
              onClick={() => onNavigate('builder')}
            >
              <div className="domain-icon-box" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7' }}>
                <Plus size={24} />
              </div>
              <div className="domain-name-text">Custom<br />Scenario</div>
              <span className="domain-arrow-btn"><ArrowRight size={15} /></span>
            </div>
          </div>
        </div>

        {/* Right: Quick Actions */}
        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          <div className="panel-header" style={{ marginBottom: 16 }}>
            <div className="panel-header-left">
              <div className="panel-icon-circle" style={{ background: 'rgba(0, 240, 255, 0.2)', color: '#00f0ff' }}>
                <Zap size={18} />
              </div>
              <h3 className="panel-title">Quick Actions</h3>
            </div>
          </div>

          <div className="quick-actions-col">
            <button
              className="quick-action-btn quick-btn-cyan"
              onClick={() => onNavigate('simulator')}
            >
              <div className="quick-action-left">
                <Play size={16} color="#00f0ff" />
                <span>Run a New Simulation</span>
              </div>
              <ArrowRight size={15} color="#00f0ff" />
            </button>

            <button
              className="quick-action-btn quick-btn-purple"
              onClick={() => onNavigate('compare')}
            >
              <div className="quick-action-left">
                <Scale size={16} color="#c084fc" />
                <span>Compare Scenarios</span>
              </div>
              <ArrowRight size={15} color="#c084fc" />
            </button>

            <button
              className="quick-action-btn quick-btn-teal"
              onClick={() => onNavigate('reports')}
            >
              <div className="quick-action-left">
                <FileText size={16} color="#2dd4bf" />
                <span>View Reports</span>
              </div>
              <ArrowRight size={15} color="#2dd4bf" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------
// 2. SCENARIO BUILDER SCREEN
// ----------------------------------------------------
function BuilderScreen({
  scenario,
  setScenario,
  savedScenarios,
  newNodeName,
  setNewNodeName,
  newNodeType,
  setNewNodeType,
  newNodeCapacity,
  setNewNodeCapacity,
  newNodeDemand,
  setNewNodeDemand,
  newNodeUnitCost,
  setNewNodeUnitCost,
  newNodePriority,
  setNewNodePriority,
  addNode,
  newEdgeSource,
  setNewEdgeSource,
  newEdgeTarget,
  setNewEdgeTarget,
  newEdgeType,
  setNewEdgeType,
  newEdgeInfluence,
  setNewEdgeInfluence,
  addEdge,
  saveScenario,
  onLoad
}: any) {
  const validation = validateGraph(scenario.nodes, scenario.edges);

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [editDemand, setEditDemand] = useState('');
  const [editUnitCost, setEditUnitCost] = useState('');
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium');

  function startEdit(n: SimNode) {
    setEditingNodeId(n.id);
    setEditName(n.name);
    setEditCapacity(String(n.capacity));
    setEditDemand(String(n.demand));
    setEditUnitCost(String(n.unitCost));
    setEditPriority(n.priority);
  }

  function saveEdit() {
    if (!editingNodeId) return;
    const cap = Number(editCapacity);
    const dem = Number(editDemand);
    const cost = Number(editUnitCost);
    if (!editName.trim() || !Number.isFinite(cap) || cap < 0) {
      return;
    }
    setScenario((s: Scenario) => ({
      ...s,
      nodes: s.nodes.map(n => n.id === editingNodeId ? {
        ...n,
        name: editName.trim(),
        capacity: cap,
        demand: Math.max(0, dem),
        unitCost: Math.max(0, cost),
        priority: editPriority
      } : n)
    }));
    setEditingNodeId(null);
  }

  function updateEdgeInfluence(id: string, influence: number) {
    setScenario((s: Scenario) => ({
      ...s,
      edges: s.edges.map(e => e.id === id ? { ...e, influence: Math.max(0, Math.min(1, influence)) } : e)
    }));
  }

  function updateEdgeType(id: string, type: DependencyType) {
    setScenario((s: Scenario) => ({
      ...s,
      edges: s.edges.map(e => e.id === id ? { ...e, type } : e)
    }));
  }

  return (
    <>
      <div className="page-screen-header">
        <div>
          <div className="screen-eyebrow">Visual Model Architect</div>
          <h1 className="screen-title">Scenario Builder</h1>
          <p className="screen-desc">
            Define components, operating capacities, demand, and typed directed dependencies for your operational system.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-primary" onClick={saveScenario}>
            <Save size={16} /> Save Scenario Model
          </button>
        </div>
      </div>

      <div className="builder-layout-grid">
        {/* Left Col: Config & Component Creation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Scenario Configuration */}
          <div className="glass-panel" style={{ padding: '20px 22px' }}>
            <h3 className="panel-title" style={{ marginBottom: 14 }}>Scenario Parameters</h3>
            <div className="form-group">
              <label className="form-label">Scenario Name</label>
              <input
                className="form-input"
                value={scenario.name}
                onChange={e => setScenario((s: Scenario) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-textarea"
                rows={2}
                value={scenario.description}
                onChange={e => setScenario((s: Scenario) => ({ ...s, description: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Operating Budget (₹)</label>
              <input
                className="form-input"
                type="number"
                min="0"
                value={scenario.budget}
                onChange={e => setScenario((s: Scenario) => ({ ...s, budget: Math.max(0, Number(e.target.value)) }))}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="form-label">Quick Starter Templates</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {templates.map(t => (
                  <button
                    key={t.id}
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: '6px 12px' }}
                    onClick={() => onLoad(t.id)}
                  >
                    Load {t.domain.toUpperCase()}
                  </button>
                ))}
              </div>

              <label className="form-label">Reload Scenario Model</label>
              <select
                className="form-select"
                style={{ fontSize: 12 }}
                onChange={e => {
                  if (e.target.value) onLoad(e.target.value);
                }}
                defaultValue=""
              >
                <option value="" disabled>Choose template or saved scenario...</option>
                <optgroup label="Starter Demonstration Templates">
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.domain.toUpperCase()})</option>
                  ))}
                </optgroup>
                {savedScenarios?.length > 0 && (
                  <optgroup label="Saved Custom Scenarios">
                    {savedScenarios.map((s: Scenario) => (
                      <option key={s.id} value={s.id}>{s.name} ({new Date(s.createdAt).toLocaleDateString()})</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>

          {/* Add Component Form */}
          <div className="glass-panel" style={{ padding: '20px 22px' }}>
            <h3 className="panel-title" style={{ marginBottom: 14 }}>Add System Component</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">Component Name</label>
                <input
                  className="form-input"
                  placeholder="e.g. Primary Transport"
                  value={newNodeName}
                  onChange={e => setNewNodeName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Component Type</label>
                <select
                  className="form-select"
                  value={newNodeType}
                  onChange={e => setNewNodeType(e.target.value)}
                >
                  <option value="process">Process</option>
                  <option value="facility">Facility / Venue</option>
                  <option value="people">Staff / People</option>
                  <option value="supplier">Supplier</option>
                  <option value="stock">Inventory / Stock</option>
                  <option value="transport">Transport / Logistics</option>
                  <option value="outcome">Outcome / Fulfilment</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">Capacity</label>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  value={newNodeCapacity}
                  onChange={e => setNewNodeCapacity(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Demand</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  value={newNodeDemand}
                  onChange={e => setNewNodeDemand(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Unit Cost (₹)</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  value={newNodeUnitCost}
                  onChange={e => setNewNodeUnitCost(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0, width: 140 }}>
                <label className="form-label">Priority</label>
                <select
                  className="form-select"
                  value={newNodePriority}
                  onChange={e => setNewNodePriority(e.target.value as any)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <button className="btn-primary" onClick={addNode}>
                <Plus size={16} /> Add Component
              </button>
            </div>
          </div>
        </div>

        {/* Right Col: Components List & Edge Management */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Active Components List */}
          <div className="glass-panel" style={{ padding: '20px 22px' }}>
            <div className="panel-header" style={{ marginBottom: 12 }}>
              <h3 className="panel-title">Active Components ({scenario.nodes.length})</h3>
              <span className="status-badge-completed" style={{ fontSize: 10 }}>Validated</span>
            </div>

            <div style={{ maxHeight: 250, overflowY: 'auto' }}>
              {scenario.nodes.map((n: SimNode) => (
                <div key={n.id} className="component-card-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  {editingNodeId === n.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8 }}>
                        <input
                          className="form-input"
                          style={{ fontSize: 12 }}
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          placeholder="Name"
                        />
                        <input
                          className="form-input"
                          style={{ fontSize: 12 }}
                          type="number"
                          value={editCapacity}
                          onChange={e => setEditCapacity(e.target.value)}
                          placeholder="Capacity"
                        />
                        <input
                          className="form-input"
                          style={{ fontSize: 12 }}
                          type="number"
                          value={editDemand}
                          onChange={e => setEditDemand(e.target.value)}
                          placeholder="Demand"
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            className="form-input"
                            style={{ width: 110, fontSize: 12 }}
                            type="number"
                            value={editUnitCost}
                            onChange={e => setEditUnitCost(e.target.value)}
                            placeholder="Unit Cost"
                          />
                          <select
                            className="form-select"
                            style={{ width: 100, fontSize: 12 }}
                            value={editPriority}
                            onChange={e => setEditPriority(e.target.value as any)}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={saveEdit}>
                            Save
                          </button>
                          <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setEditingNodeId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ fontSize: 13, color: '#ffffff' }}>{n.name}</strong>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {n.type} · Cap: {n.capacity} · Demand: {n.demand} · ₹{n.unitCost}/unit
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`priority-pill priority-${n.priority}`}>{n.priority}</span>
                        <button
                          className="top-icon-btn"
                          style={{ width: 28, height: 28 }}
                          title="Edit component properties"
                          onClick={() => startEdit(n)}
                        >
                          <Edit3 size={13} color="#00f0ff" />
                        </button>
                        <button
                          className="top-icon-btn"
                          style={{ width: 28, height: 28 }}
                          title="Remove component"
                          onClick={() => setScenario((s: Scenario) => ({
                            ...s,
                            nodes: s.nodes.filter(x => x.id !== n.id),
                            edges: s.edges.filter(e => e.source !== n.id && e.target !== n.id)
                          }))}
                        >
                          <Trash2 size={13} color="#f43f5e" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Connect Dependencies Form */}
          <div className="glass-panel" style={{ padding: '20px 22px' }}>
            <div className="panel-header" style={{ marginBottom: 12 }}>
              <h3 className="panel-title">Typed Dependencies ({scenario.edges.length})</h3>
              {!validation.valid && (
                <span className="priority-pill priority-high">
                  {validation.errors[0]}
                </span>
              )}
            </div>

            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 14 }}>
              {scenario.edges.map((e: SimEdge) => {
                const src = scenario.nodes.find((n: SimNode) => n.id === e.source)?.name || e.source;
                const tgt = scenario.nodes.find((n: SimNode) => n.id === e.target)?.name || e.target;
                return (
                  <div key={e.id} className="component-card-row" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, flex: 1 }}>
                      <strong style={{ color: '#fff' }}>{src}</strong>
                      <select
                        className="form-select"
                        style={{ fontSize: 10, padding: '2px 4px', width: 95, height: 24 }}
                        value={e.type}
                        onChange={ev => updateEdgeType(e.id, ev.target.value as any)}
                      >
                        <option value="supplies">supplies</option>
                        <option value="requires">requires</option>
                        <option value="supports">supports</option>
                        <option value="delays">delays</option>
                        <option value="increases_cost">increases_cost</option>
                      </select>
                      <strong style={{ color: '#fff' }}>{tgt}</strong>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={e.influence}
                        onChange={ev => updateEdgeInfluence(e.id, Number(ev.target.value))}
                        title={`Influence: ${(e.influence * 100).toFixed(0)}%`}
                        style={{ width: 65, accentColor: '#00f0ff' }}
                      />
                      <span style={{ fontSize: 10, color: '#a855f7', width: 30, textAlign: 'right' }}>
                        {(e.influence * 100).toFixed(0)}%
                      </span>
                      <button
                        className="top-icon-btn"
                        style={{ width: 24, height: 24 }}
                        title="Delete dependency"
                        onClick={() => setScenario((s: Scenario) => ({
                          ...s,
                          edges: s.edges.filter(x => x.id !== e.id)
                        }))}
                      >
                        <Trash2 size={12} color="#f43f5e" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Edge Form */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label className="form-label">Source Node</label>
                <select
                  className="form-select"
                  value={newEdgeSource}
                  onChange={e => setNewEdgeSource(e.target.value)}
                >
                  <option value="">Select source...</option>
                  {scenario.nodes.map((n: SimNode) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Target Node</label>
                <select
                  className="form-select"
                  value={newEdgeTarget}
                  onChange={e => setNewEdgeTarget(e.target.value)}
                >
                  <option value="">Select target...</option>
                  {scenario.nodes.map((n: SimNode) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
              <div>
                <label className="form-label">Dependency Type</label>
                <select
                  className="form-select"
                  value={newEdgeType}
                  onChange={e => setNewEdgeType(e.target.value as any)}
                >
                  <option value="supplies">Supplies (Capacity)</option>
                  <option value="requires">Requires (Prerequisite)</option>
                  <option value="supports">Supports (Assistance)</option>
                  <option value="delays">Delays (Time Lag)</option>
                  <option value="increases_cost">Increases Cost (Pressure)</option>
                </select>
              </div>
              <div>
                <label className="form-label">Influence ({(Number(newEdgeInfluence) * 100).toFixed(0)}%)</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={newEdgeInfluence}
                  onChange={e => setNewEdgeInfluence(e.target.value)}
                  style={{ width: '100%', accentColor: '#00f0ff' }}
                />
              </div>
              <button className="btn-primary" onClick={addEdge}>
                <Plus size={16} /> Connect
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------
// 3. WHAT-IF SIMULATOR SCREEN
// ----------------------------------------------------
function SimulatorScreen({
  scenario,
  changes,
  setChanges,
  changeNode,
  setChangeNode,
  changeVar,
  setChangeVar,
  changeOperation,
  setChangeOperation,
  changeValue,
  setChangeValue,
  addChange,
  result,
  baseline,
  runSimulation,
  saveRun,
  activeTrace,
  setActiveTrace,
  uncertaintySettings,
  setUncertaintySettings
}: any) {
  const scenarioBands = useMemo(() => {
    try {
      return simulateUncertaintyBands(scenario, changes, uncertaintySettings);
    } catch {
      return [];
    }
  }, [scenario, changes, uncertaintySettings]);

  return (
    <>
      <div className="page-screen-header">
        <div>
          <div className="screen-eyebrow">Deterministic Simulation Engine</div>
          <h1 className="screen-title">What-If Simulator</h1>
          <p className="screen-desc">
            Introduce disruptions or operational decisions, recalculate interconnected system capacities, and explore ripple effects.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {result && (
            <button className="btn-secondary" onClick={() => saveRun(result)}>
              <Save size={16} /> Save Simulation Run
            </button>
          )}
          <button className="btn-primary" onClick={runSimulation}>
            <Play size={16} /> Run What-If Simulation
          </button>
        </div>
      </div>

      <div className="sim-grid-split">
        {/* Left Column: Disruption Controls */}
        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          <h3 className="panel-title" style={{ marginBottom: 14 }}>Introduce Disruption</h3>

          <div className="form-group">
            <label className="form-label">Target Component</label>
            <select
              className="form-select"
              value={changeNode}
              onChange={e => setChangeNode(e.target.value)}
            >
              {scenario.nodes.map((n: SimNode) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Variable to Modify</label>
            <select
              className="form-select"
              value={changeVar}
              onChange={e => setChangeVar(e.target.value as any)}
            >
              <option value="demand">Demand (Volume)</option>
              <option value="capacity">Capacity (Max output)</option>
              <option value="availability">Availability (0.0 to 1.0)</option>
              <option value="unitCost">Unit Cost (₹)</option>
              <option value="baseDelayHours">Base Delay (Hours)</option>
              <option value="fixedCost">Fixed Cost (₹)</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Operation</label>
              <select
                className="form-select"
                value={changeOperation}
                onChange={e => setChangeOperation(e.target.value as any)}
              >
                <option value="set">Set to (=)</option>
                <option value="add">Add (+)</option>
                <option value="multiply">Multiply (×)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Value</label>
              <input
                className="form-input"
                type="number"
                step="any"
                min="0"
                value={changeValue}
                onChange={e => setChangeValue(e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn-secondary"
            style={{ width: '100%', justifyContent: 'center', marginBottom: 18 }}
            onClick={addChange}
          >
            <Plus size={16} /> Queue Scenario Change
          </button>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 14 }}>
            <div className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Queued Changes ({changes.length})</span>
              {changes.length > 0 && (
                <button
                  style={{ color: '#f43f5e', fontSize: 11, cursor: 'pointer' }}
                  onClick={() => setChanges([])}
                >
                  Clear All
                </button>
              )}
            </div>

            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {changes.length === 0 ? (
                <div style={{ fontSize: 12, color: '#64748b', padding: '12px 0' }}>
                  No changes queued. Select a variable above to test a what-if disruption.
                </div>
              ) : (
                changes.map((c: ScenarioChange) => (
                  <div key={c.id} className="component-card-row" style={{ padding: '8px 12px' }}>
                    <span style={{ fontSize: 12, color: '#e2e8f0' }}>{c.label}</span>
                    <button
                      className="top-icon-btn"
                      style={{ width: 24, height: 24 }}
                      onClick={() => setChanges((list: ScenarioChange[]) => list.filter(x => x.id !== c.id))}
                    >
                      <X size={12} color="#f43f5e" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={runSimulation}>
              <Play size={16} /> Simulate
            </button>
            <button className="btn-secondary" onClick={() => setChanges([])}>
              Reset
            </button>
          </div>
        </div>

        {/* Right Column: Outcomes & Calculation Traces */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {result ? (
            <>
              {/* Simulator KPI Bar */}
              <div className="sim-kpi-bar">
                <div className="sim-kpi-item">
                  <div className="kpi-label">Health Index</div>
                  <div className="kpi-value" style={{ color: result.overallHealth >= 80 ? '#34d399' : '#fb7185' }}>
                    {result.overallHealth}<small style={{ fontSize: 12, color: '#94a3b8' }}>/100</small>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Heuristic Scenario Health Index</div>
                </div>

                <div className="sim-kpi-item">
                  <div className="kpi-label">Unmet Demand</div>
                  <div className="kpi-value" style={{ color: result.totalUnmet > 0 ? '#f43f5e' : '#34d399' }}>
                    {result.totalUnmet.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                    Fulfilled: {result.totalFulfilled.toFixed(1)}
                  </div>
                </div>

                <div className="sim-kpi-item">
                  <div className="kpi-label">Operating Cost</div>
                  <div className="kpi-value">{formatCurrency(result.totalCost)}</div>
                  <div style={{ fontSize: 10, color: result.budgetVariance > 0 ? '#f43f5e' : '#34d399', marginTop: 2 }}>
                    Budget: {formatCurrency(result.budget)} ({result.budgetVariance > 0 ? `+${formatCurrency(result.budgetVariance)}` : 'On budget'})
                  </div>
                </div>

                <div className="sim-kpi-item">
                  <div className="kpi-label">Bottlenecks & Impacted</div>
                  <div className="kpi-value" style={{ color: result.rankedBottlenecks.length > 0 ? '#fb7185' : '#00f0ff' }}>
                    {result.rankedBottlenecks.length} <small style={{ fontSize: 12, color: '#94a3b8' }}>bottlenecks</small>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                    {result.impactedNodeIds.length} downstream node(s) impacted
                  </div>
                </div>
              </div>

              {/* Health Score Breakdown Panel */}
              <div className="glass-panel" style={{ padding: '20px 22px' }}>
                <div className="panel-header" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 className="panel-title">Heuristic Scenario Health Index Breakdown</h3>
                    <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      Deterministic scenario health index calculated from weighted operational sub-scores and constraint overrun penalties. (Heuristic model, not a statistical probability forecast).
                    </p>
                  </div>
                  <span className="priority-pill priority-medium">Model Transparency</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(8, 14, 38, 0.65)', border: '1px solid rgba(0, 240, 255, 0.2)' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Fulfilment Ratio</span>
                      <strong style={{ color: '#00f0ff' }}>50% wt</strong>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', margin: '4px 0' }}>
                      {result.healthBreakdown.fulfilmentScore}<small style={{ fontSize: 11, color: '#94a3b8' }}>/100</small>
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>
                      Fulfilled {result.totalFulfilled.toFixed(0)} of {result.totalDemand.toFixed(0)}
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(8, 14, 38, 0.65)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Budget Compliance</span>
                      <strong style={{ color: '#10b981' }}>25% wt</strong>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', margin: '4px 0' }}>
                      {result.healthBreakdown.budgetScore}<small style={{ fontSize: 11, color: '#94a3b8' }}>/100</small>
                    </div>
                    <div style={{ fontSize: 10, color: result.budgetVariance > 0 ? '#f43f5e' : '#10b981' }}>
                      {result.budgetVariance > 0 ? `Over by ${formatCurrency(result.budgetVariance)}` : 'Within budget ceiling'}
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(8, 14, 38, 0.65)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Capacity Utilization</span>
                      <strong style={{ color: '#f59e0b' }}>15% wt</strong>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', margin: '4px 0' }}>
                      {result.healthBreakdown.utilizationScore}<small style={{ fontSize: 11, color: '#94a3b8' }}>/100</small>
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>
                      Average {result.averageUtilization.toFixed(0)}% (nominal &le;90%)
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(8, 14, 38, 0.65)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Lead-time Delay</span>
                      <strong style={{ color: '#a855f7' }}>10% wt</strong>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', margin: '4px 0' }}>
                      {result.healthBreakdown.delayScore}<small style={{ fontSize: 11, color: '#94a3b8' }}>/100</small>
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>
                      Penalized above 2.0h critical path
                    </div>
                  </div>
                </div>

                {result.healthBreakdown.penalty > 0 ? (
                  <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(244, 63, 94, 0.12)', border: '1px solid rgba(244, 63, 94, 0.3)', fontSize: 12, color: '#fca5a5' }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <AlertTriangle size={14} color="#f43f5e" />
                      Hard Constraint Violation Penalty: -{result.healthBreakdown.penalty} points applied
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11 }}>
                      {result.healthBreakdown.notes.map((note: string, idx: number) => (
                        <li key={idx}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={13} />
                    Zero constraint penalties: operating within normal tolerance limits.
                  </div>
                )}
              </div>

              {/* Transparent Ranked Bottlenecks Identification Panel */}
              <div className="glass-panel" style={{ padding: '20px 22px' }}>
                <div className="panel-header" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 className="panel-title">Transparent Bottleneck Identification & Ranking</h3>
                    <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      Components ranked by explicit measured impact: <code>(Unmet Demand × 1.0) + (Downstream Count × 15) + (Delay Hours × 4) + (Util &gt; 95% ? 10 : 0)</code>
                    </p>
                  </div>
                  <span className="priority-pill priority-high">
                    {result.rankedBottlenecks.length} Ranked
                  </span>
                </div>

                {result.rankedBottlenecks.length === 0 ? (
                  <div style={{ padding: '16px 20px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', fontSize: 12, color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={16} color="#10b981" />
                    No critical capacity bottlenecks detected in this scenario configuration. All component demands are fulfilled within available capacity.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {result.rankedBottlenecks.map((b: any, rankIdx: number) => (
                      <div
                        key={b.nodeId}
                        style={{
                          padding: '12px 16px',
                          borderRadius: 12,
                          background: 'rgba(10, 16, 42, 0.55)',
                          border: `1px solid ${b.severity === 'critical' ? 'rgba(244, 63, 94, 0.35)' : b.severity === 'high' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(0, 240, 255, 0.25)'}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 16
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              background: b.severity === 'critical' ? 'rgba(244, 63, 94, 0.25)' : 'rgba(0, 240, 255, 0.2)',
                              color: b.severity === 'critical' ? '#f43f5e' : '#00f0ff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: 12
                            }}
                          >
                            #{rankIdx + 1}
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <strong style={{ fontSize: 13, color: '#ffffff' }}>{b.name}</strong>
                              <span className={`priority-pill ${b.severity === 'critical' ? 'priority-high' : b.severity === 'high' ? 'priority-medium' : 'priority-low'}`}>
                                {b.severity.toUpperCase()}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 3 }}>
                              {b.reason}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#00f0ff' }}>
                            Score: {b.impactScore}
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {b.unmetDemand > 0 ? `${b.unmetDemand.toFixed(1)} unmet · ` : ''}{b.utilization.toFixed(0)}% util · {b.downstreamImpactCount} downstream
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Component Outcomes Table */}
              <div className="glass-panel" style={{ padding: '20px 22px' }}>
                <div className="panel-header" style={{ marginBottom: 14 }}>
                  <h3 className="panel-title">Component-Level Recalculations</h3>
                  <span className="status-badge-completed">Deterministic Output</span>
                </div>

                <div className="sim-table-wrap">
                  <table className="sim-table">
                    <thead>
                      <tr>
                        <th>Component</th>
                        <th>Effective Capacity</th>
                        <th>Demand</th>
                        <th>Fulfilled</th>
                        <th>Unmet</th>
                        <th>Utilization</th>
                        <th>Cost</th>
                        <th>Delay</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.nodes.map((n: any) => (
                        <tr key={n.nodeId}>
                          <td style={{ fontWeight: 600, color: '#ffffff' }}>{n.name}</td>
                          <td>{n.effectiveCapacity.toFixed(1)} <small style={{ color: '#64748b' }}>{n.quantityUnit}</small></td>
                          <td>{n.demand.toFixed(0)}</td>
                          <td style={{ color: '#34d399' }}>{n.fulfilled.toFixed(1)}</td>
                          <td style={{ color: n.unmetDemand > 0 ? '#f43f5e' : '#94a3b8', fontWeight: n.unmetDemand > 0 ? 700 : 400 }}>
                            {n.unmetDemand.toFixed(1)}
                          </td>
                          <td>{n.utilization.toFixed(0)}%</td>
                          <td style={{ color: '#e2e8f0' }}>{formatCurrency(n.cost)}</td>
                          <td style={{ color: n.delayHours > 0 ? '#fb7185' : '#94a3b8' }}>{n.delayHours.toFixed(1)}h</td>
                          <td>
                            <span className={`priority-pill ${n.directImpact ? 'priority-high' : n.affected ? 'priority-medium' : 'priority-low'}`}>
                              {n.directImpact ? 'Direct Disruption' : n.affected ? 'Impacted' : 'Stable'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Calculation Traces Accordion */}
                <h4 style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', margin: '16px 0 10px' }}>
                  Explainability & Calculation Traces
                </h4>
                <div>
                  {result.nodes.filter((n: any) => n.trace.length > 0 || n.directImpact || n.unmetDemand > 0).map((n: any) => (
                    <div key={n.nodeId} className="trace-accordion-item">
                      <button
                        className="trace-accordion-trigger"
                        onClick={() => setActiveTrace(activeTrace === n.nodeId ? null : n.nodeId)}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Activity size={15} color="#00f0ff" />
                          {n.name}
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: activeTrace === n.nodeId ? 'rotate(180deg)' : 'rotate(0)',
                            transition: 'transform 0.2s'
                          }}
                        />
                      </button>

                      {activeTrace === n.nodeId && (
                        <div className="trace-accordion-body">
                          <p style={{ marginBottom: 6 }}>
                            <strong>Formula:</strong> Effective Capacity = Base Capacity × Availability ({n.availabilityFactor.toFixed(2)}) × Dependency Factor ({n.dependencyFactor.toFixed(2)}) = <strong>{n.effectiveCapacity.toFixed(1)} {n.quantityUnit}</strong>
                          </p>
                          <p style={{ marginBottom: 6, fontSize: 11, color: '#94a3b8' }}>
                            <strong>Cost Basis ({n.operatingPeriod}):</strong> Fixed {formatCurrency(n.fixedCost)} + Variable {formatCurrency(n.variableCost)} = <strong>{formatCurrency(n.cost)}</strong>
                          </p>
                          {n.trace.map((t: string, idx: number) => (
                            <div key={idx} style={{ marginTop: 4 }}>• {t}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Configurable Uncertainty & Stress-Testing Scenarios */}
              <div className="glass-panel" style={{ padding: '20px 22px' }}>
                <div className="panel-header" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 className="panel-title">Configurable Uncertainty & Stress-Testing Scenarios</h3>
                    <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      Configure individual optimistic, base, and pessimistic conditions across key operational variables before running stress tests.
                    </p>
                  </div>
                  <span className="priority-pill priority-medium">Deterministic Stress Test</span>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0, 240, 255, 0.08)', border: '1px solid rgba(0, 240, 255, 0.2)', marginBottom: 16, fontSize: 11, color: '#7dd3fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Info size={16} />
                  <span><strong>Methodological Notice:</strong> These bands are hypothetical stress-test scenarios evaluated by the deterministic simulation engine, not statistical probability forecasts or Monte Carlo distributions.</span>
                </div>

                {/* Multi-variable input table */}
                <div style={{ overflowX: 'auto', marginBottom: 18 }}>
                  <table className="sim-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }}>Operational Variable</th>
                        <th style={{ width: '26%', color: '#10b981' }}>Optimistic Multiplier</th>
                        <th style={{ width: '26%', color: '#00f0ff' }}>Base Scenario Multiplier</th>
                        <th style={{ width: '26%', color: '#f43f5e' }}>Pessimistic Multiplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { key: 'demand', label: 'Demand Volume', min: 0.5, max: 2.0, step: 0.05 },
                        { key: 'capacity', label: 'Component Capacity', min: 0.5, max: 1.5, step: 0.05 },
                        { key: 'availability', label: 'Component Availability', min: 0.4, max: 1.0, step: 0.05 },
                        { key: 'unitCost', label: 'Unit Cost Escalation', min: 0.5, max: 2.0, step: 0.05 },
                        { key: 'delay', label: 'Lead-Time Delay Hours', min: 0.2, max: 3.0, step: 0.1 },
                        { key: 'supplierAvailability', label: 'Supplier Availability', min: 0.3, max: 1.0, step: 0.05 }
                      ].map(v => {
                        const optVal = (uncertaintySettings as any)[v.key]?.optimistic ?? 1.0;
                        const baseVal = (uncertaintySettings as any)[v.key]?.base ?? 1.0;
                        const pesVal = (uncertaintySettings as any)[v.key]?.pessimistic ?? 1.0;

                        return (
                          <tr key={v.key}>
                            <td style={{ fontWeight: 600, color: '#ffffff' }}>{v.label}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                  type="range"
                                  min={v.min}
                                  max={v.max}
                                  step={v.step}
                                  value={optVal}
                                  onChange={e => {
                                    const val = Number(e.target.value);
                                    setUncertaintySettings((old: any) => ({
                                      ...old,
                                      [v.key]: { ...(old[v.key] || { optimistic: 1, base: 1, pessimistic: 1 }), optimistic: val }
                                    }));
                                  }}
                                  style={{ flex: 1, accentColor: '#10b981' }}
                                />
                                <span style={{ width: 42, fontSize: 11, color: '#10b981', fontWeight: 600 }}>{optVal.toFixed(2)}×</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                  type="range"
                                  min={v.min}
                                  max={v.max}
                                  step={v.step}
                                  value={baseVal}
                                  onChange={e => {
                                    const val = Number(e.target.value);
                                    setUncertaintySettings((old: any) => ({
                                      ...old,
                                      [v.key]: { ...(old[v.key] || { optimistic: 1, base: 1, pessimistic: 1 }), base: val }
                                    }));
                                  }}
                                  style={{ flex: 1, accentColor: '#00f0ff' }}
                                />
                                <span style={{ width: 42, fontSize: 11, color: '#00f0ff', fontWeight: 600 }}>{baseVal.toFixed(2)}×</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                  type="range"
                                  min={v.min}
                                  max={v.max}
                                  step={v.step}
                                  value={pesVal}
                                  onChange={e => {
                                    const val = Number(e.target.value);
                                    setUncertaintySettings((old: any) => ({
                                      ...old,
                                      [v.key]: { ...(old[v.key] || { optimistic: 1, base: 1, pessimistic: 1 }), pessimistic: val }
                                    }));
                                  }}
                                  style={{ flex: 1, accentColor: '#f43f5e' }}
                                />
                                <span style={{ width: 42, fontSize: 11, color: '#f43f5e', fontWeight: 600 }}>{pesVal.toFixed(2)}×</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Side-by-side Stress Band Results */}
                <h4 style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', marginBottom: 10 }}>
                  Deterministic Stress Test Outcomes
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                  {scenarioBands.map((b: any) => (
                    <div
                      key={b.band}
                      style={{
                        padding: '16px 18px',
                        borderRadius: 14,
                        background: 'rgba(8, 14, 38, 0.75)',
                        border: `1px solid ${b.tone}45`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: b.tone, fontWeight: 700 }}>{b.name}</span>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${b.tone}20`, color: b.tone }}>
                          {b.band.toUpperCase()}
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{b.description}</p>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: '#cbd5e1' }}>Health Score:</span>
                        <span style={{ fontSize: 24, fontWeight: 700, color: '#ffffff' }}>
                          {b.result?.overallHealth ?? '—'}<small style={{ fontSize: 12, color: '#94a3b8' }}>/100</small>
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Fulfilled:</span>
                          <strong style={{ color: '#ffffff' }}>{b.result?.totalFulfilled.toFixed(1) ?? '—'} units</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Unmet Demand:</span>
                          <strong style={{ color: (b.result?.totalUnmet ?? 0) > 0 ? '#f43f5e' : '#34d399' }}>
                            {b.result?.totalUnmet.toFixed(1) ?? '—'} units
                          </strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Total Cost:</span>
                          <strong style={{ color: '#ffffff' }}>{b.result ? formatCurrency(b.result.totalCost) : '—'}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Budget Variance:</span>
                          <strong style={{ color: (b.result?.budgetVariance ?? 0) > 0 ? '#f43f5e' : '#34d399' }}>
                            {b.result ? formatCurrency(b.result.budgetVariance) : '—'}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Bottlenecks:</span>
                          <strong style={{ color: (b.result?.rankedBottlenecks.length ?? 0) > 0 ? '#fb7185' : '#34d399' }}>
                            {b.result?.rankedBottlenecks.length ?? 0}
                          </strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="glass-panel" style={{ padding: '60px 40px', textAlign: 'center' }}>
              <div className="sidebar-orb" style={{ margin: '0 auto 16px' }}>
                <Zap size={28} />
              </div>
              <h3 style={{ fontSize: 18, color: '#ffffff', marginBottom: 8 }}>Ready to Simulate</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 440, margin: '0 auto 20px' }}>
                Queue one or more what-if changes on the left and click Simulate to calculate ripple effects and downstream capacity impact.
              </p>
              <button className="btn-primary" onClick={runSimulation}>
                <Play size={16} /> Run Initial Simulation
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------
// 4. DECISION MAP SCREEN (Interactive React Flow)
// ----------------------------------------------------
function DecisionMapScreen({
  scenario,
  result,
  baseline
}: {
  scenario: Scenario;
  result: SimulationResult | null;
  baseline: SimulationResult | null;
}) {
  const nodes: Node[] = useMemo(() => {
    return scenario.nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, scenario.nodes.length);
      const x = 380 + Math.cos(angle) * 260;
      const y = 240 + Math.sin(angle) * 160;
      const r = result?.nodes.find(x => x.nodeId === n.id);
      const isBottleneck = !!r && (r.unmetDemand > 0 || r.utilization > 100);
      const isImpacted = !!r && r.affected && !isBottleneck;

      return {
        id: n.id,
        position: { x, y },
        data: {
          label: (
            <div className={`custom-flow-node ${isBottleneck ? 'node-bottleneck' : isImpacted ? 'node-impacted' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Network size={14} color="#00f0ff" />
                <strong style={{ fontSize: 12 }}>{n.name}</strong>
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>
                Cap: {r ? r.effectiveCapacity.toFixed(0) : n.capacity} · Demand: {n.demand}
              </div>
              {r && r.unmetDemand > 0 && (
                <div style={{ fontSize: 10, color: '#fb7185', fontWeight: 700, marginTop: 2 }}>
                  Unmet: {r.unmetDemand.toFixed(1)}
                </div>
              )}
            </div>
          )
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { background: 'transparent', border: 0, padding: 0, width: 170 }
      };
    });
  }, [scenario, result]);

  const edges: Edge[] = useMemo(() => {
    return scenario.edges.map(e => {
      const isImpactedEdge = !!result?.impactedNodeIds.includes(e.target);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.type.replace('_', ' ')} (${Math.round(e.influence * 100)}%)`,
        animated: isImpactedEdge,
        style: {
          stroke: isImpactedEdge ? '#f43f5e' : '#00f0ff',
          strokeWidth: isImpactedEdge ? 2.5 : 1.5
        },
        labelStyle: { fill: '#cbd5e1', fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: '#0a102a', fillOpacity: 0.9, rx: 6, ry: 6 }
      };
    });
  }, [scenario, result]);

  return (
    <>
      <div className="page-screen-header">
        <div>
          <div className="screen-eyebrow">Interactive System Topology</div>
          <h1 className="screen-title">Decision Map</h1>
          <p className="screen-desc">
            Visual graph representation of components and typed dependencies. Highlighted paths trace how upstream disruptions ripple downstream.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="status-badge-completed" style={{ background: 'rgba(0, 240, 255, 0.15)', borderColor: 'rgba(0, 240, 255, 0.4)', color: '#00f0ff' }}>
            {scenario.nodes.length} Components · {scenario.edges.length} Dependencies
          </span>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: 14 }}>
        <div className="flow-canvas-container">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e293b" gap={24} size={1} />
            <Controls />
            <MiniMap
              nodeColor="#00f0ff"
              maskColor="rgba(6, 10, 28, 0.7)"
              style={{ background: 'rgba(10, 16, 42, 0.9)', border: '1px solid rgba(0, 240, 255, 0.3)' }}
            />
          </ReactFlow>
        </div>
      </div>

      {/* Map Legend & Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div className="glass-panel" style={{ padding: '18px 20px' }}>
          <h4 style={{ fontSize: 14, color: '#ffffff', marginBottom: 10 }}>Dependency Relationships</h4>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            {scenario.edges.map(e => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>
                  {scenario.nodes.find(n => n.id === e.source)?.name} → {scenario.nodes.find(n => n.id === e.target)?.name} ({e.type.replace('_', ' ')})
                </span>
                <strong style={{ color: '#00f0ff' }}>{(e.influence * 100).toFixed(0)}% weight</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '18px 20px' }}>
          <h4 style={{ fontSize: 14, color: '#ffffff', marginBottom: 10 }}>Visual Topology Legend</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: '#00f0ff' }} />
              <span><strong>Cyan Node / Path:</strong> Normal operational state within configured capacity.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: '#f59e0b' }} />
              <span><strong>Amber Node:</strong> Downstream impacted by upstream shortages or delays.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: '#f43f5e' }} />
              <span><strong>Red Node / Path:</strong> Bottleneck with unmet demand or utilization exceeding 100%.</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------
// 5. COMPARE SCENARIOS SCREEN
// ----------------------------------------------------
function CompareScreen({
  scenario,
  changes,
  result,
  baseline,
  onRun
}: {
  scenario: Scenario;
  changes: ScenarioChange[];
  result: SimulationResult | null;
  baseline: SimulationResult | null;
  onRun: () => void;
}) {
  const alternatives = useMemo(() => {
    try {
      return evaluateAlternatives(scenario, changes);
    } catch {
      return [];
    }
  }, [scenario, changes]);

  const viableAlternatives = alternatives.filter(a => a.isViable);
  const bestAlternative = viableAlternatives.length > 0
    ? viableAlternatives.reduce((best, curr) => curr.result.overallHealth > best.result.overallHealth ? curr : best, viableAlternatives[0])
    : null;

  const chartData = alternatives.map(a => ({
    name: a.name.length > 20 ? a.name.slice(0, 18) + '…' : a.name,
    health: a.result.overallHealth,
    fulfilled: a.result.totalFulfilled,
    unmet: a.result.totalUnmet
  }));

  return (
    <>
      <div className="page-screen-header">
        <div>
          <div className="screen-eyebrow">Decision Intelligence Evaluation</div>
          <h1 className="screen-title">Compare Scenarios & Strategies</h1>
          <p className="screen-desc">
            Evaluate alternative intervention strategies starting from the exact same baseline and constraints. Identify positive improvements, negative trade-offs, and hard constraint violations.
          </p>
        </div>
        <button className="btn-primary" onClick={onRun}>
          <Play size={16} /> Run Active Disruption
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
        {alternatives.map((alt, idx) => {
          const isBest = bestAlternative ? alt.name === bestAlternative.name : false;
          return (
            <div
              key={alt.name}
              className="glass-panel"
              style={{
                padding: '20px 22px',
                borderColor: isBest ? 'rgba(0, 240, 255, 0.7)' : !alt.isViable ? 'rgba(244, 63, 94, 0.35)' : undefined,
                boxShadow: isBest ? '0 0 25px rgba(0, 240, 255, 0.2)' : undefined,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, letterSpacing: 1, fontWeight: 700, color: isBest ? '#00f0ff' : !alt.isViable ? '#f43f5e' : '#94a3b8' }}>
                    {idx === 0 ? 'BASELINE' : isBest ? 'BEST AMONG TESTED ALTERNATIVES' : alt.isViable ? 'VIABLE ALTERNATIVE' : 'CONSTRAINT VIOLATED'}
                  </span>
                  {isBest && <ShieldCheck size={18} color="#00f0ff" />}
                  {!alt.isViable && <AlertTriangle size={16} color="#f43f5e" />}
                </div>

                <h3 style={{ fontSize: 15, color: '#ffffff', marginBottom: 4 }}>{alt.name}</h3>
                <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>{alt.description}</p>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: '#ffffff' }}>
                    {alt.result.overallHealth}
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>/100 Health Index</span>
                  <span className={`priority-pill ${alt.isViable ? 'priority-low' : 'priority-high'}`} style={{ marginLeft: 'auto' }}>
                    {alt.isViable ? 'Viable Strategy' : 'Constraint Violated'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#cbd5e1', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Unmet Demand:</span>
                    <strong style={{ color: alt.result.totalUnmet > 0 ? '#f43f5e' : '#34d399' }}>
                      {alt.result.totalUnmet.toFixed(1)} units
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Operating Cost:</span>
                    <strong style={{ color: '#ffffff' }}>{formatCurrency(alt.result.totalCost, scenario.currency)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Budget Variance:</span>
                    <strong style={{ color: alt.result.budgetVariance > 0 ? '#f43f5e' : '#34d399' }}>
                      {alt.result.budgetVariance > 0 ? `+${formatCurrency(alt.result.budgetVariance, scenario.currency)}` : formatCurrency(alt.result.budgetVariance, scenario.currency)}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Critical Bottlenecks:</span>
                    <strong style={{ color: alt.result.rankedBottlenecks.length > 0 ? '#fb7185' : '#34d399' }}>
                      {alt.result.rankedBottlenecks.length}
                    </strong>
                  </div>
                </div>

                {/* Hard Constraint Violations */}
                {alt.hardConstraintViolations.length > 0 && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(244, 63, 94, 0.12)', border: '1px solid rgba(244, 63, 94, 0.3)', marginBottom: 12, fontSize: 11, color: '#fca5a5' }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <AlertTriangle size={12} color="#f43f5e" /> Violations:
                    </div>
                    {alt.hardConstraintViolations.map((v, i) => (
                      <div key={i}>• {v}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Trade-offs */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, fontSize: 11 }}>
                <div style={{ color: '#34d399', marginBottom: 4, fontWeight: 600 }}>Improvements:</div>
                {alt.positiveTradeoffs.map((p, i) => (
                  <div key={i} style={{ color: '#a7f3d0', marginBottom: 2 }}>✓ {p}</div>
                ))}
                <div style={{ color: '#f59e0b', margin: '6px 0 4px', fontWeight: 600 }}>Trade-offs:</div>
                {alt.negativeTradeoffs.map((n, i) => (
                  <div key={i} style={{ color: '#fde68a', marginBottom: 2 }}>⚠ {n}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Outcome Comparison Bar Chart & Side-by-Side Matrix */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          <h3 className="panel-title" style={{ marginBottom: 14 }}>Health Score Comparison Across Alternatives</h3>
          <div style={{ height: 260, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                <CartesianGrid stroke="rgba(255, 255, 255, 0.08)" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" />
                <YAxis stroke="#64748b" domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(10, 16, 42, 0.95)',
                    border: '1px solid rgba(0, 240, 255, 0.4)',
                    borderRadius: 12,
                    color: '#fff'
                  }}
                />
                <Bar dataKey="health" fill="#00f0ff" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          <h3 className="panel-title" style={{ marginBottom: 14 }}>Comparison Matrix</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="sim-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Viable</th>
                  <th>Health</th>
                  <th>Fulfilled</th>
                  <th>Unmet</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {alternatives.map(a => (
                  <tr key={a.name}>
                    <td style={{ fontWeight: 600, color: '#ffffff' }}>{a.name}</td>
                    <td>
                      <span className={`priority-pill ${a.isViable ? 'priority-low' : 'priority-high'}`} style={{ fontSize: 10 }}>
                        {a.isViable ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, color: '#00f0ff' }}>{a.result.overallHealth}</td>
                    <td>{a.result.totalFulfilled.toFixed(0)}</td>
                    <td style={{ color: a.result.totalUnmet > 0 ? '#f43f5e' : '#34d399' }}>{a.result.totalUnmet.toFixed(1)}</td>
                    <td>{formatCurrency(a.result.totalCost, scenario.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------
// 6. REPORTS SCREEN
// ----------------------------------------------------
function ReportsScreen({
  result,
  scenario,
  recommendations,
  exportJSON,
  exportMarkdown,
  onGo
}: any) {
  return (
    <>
      <div className="page-screen-header">
        <div>
          <div className="screen-eyebrow">Structured Output & Export</div>
          <h1 className="screen-title">Decision Intelligence Report</h1>
          <p className="screen-desc">
            Evidence-based findings, transparent trade-offs, and downloadable structured summaries.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-secondary" onClick={exportJSON}>
            <Download size={16} /> Export JSON
          </button>
          <button className="btn-primary" onClick={exportMarkdown}>
            <Download size={16} /> Export Markdown
          </button>
        </div>
      </div>

      {!result ? (
        <div className="glass-panel" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <FileText size={40} color="#00f0ff" style={{ margin: '0 auto 14px' }} />
          <h3 style={{ fontSize: 18, color: '#ffffff', marginBottom: 8 }}>No Report Available Yet</h3>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 420, margin: '0 auto 20px' }}>
            Run a simulation run to generate structured findings, trade-offs, and exportable reports.
          </p>
          <button className="btn-primary" onClick={onGo}>
            Go to Simulator <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Executive KPI Bar */}
          <div className="sim-kpi-bar">
            <div className="sim-kpi-item">
              <div className="kpi-label">Health Score</div>
              <div className="kpi-value" style={{ color: '#34d399' }}>{result.overallHealth}/100</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Heuristic Scenario Health Index</div>
            </div>
            <div className="sim-kpi-item">
              <div className="kpi-label">Total Fulfilled</div>
              <div className="kpi-value">{result.totalFulfilled.toFixed(0)}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>of {result.totalDemand.toFixed(0)} demanded</div>
            </div>
            <div className="sim-kpi-item">
              <div className="kpi-label">Unmet Demand</div>
              <div className="kpi-value" style={{ color: result.totalUnmet > 0 ? '#f43f5e' : '#34d399' }}>
                {result.totalUnmet.toFixed(1)}
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>across system components</div>
            </div>
            <div className="sim-kpi-item">
              <div className="kpi-label">Estimated Cost</div>
              <div className="kpi-value">{formatCurrency(result.totalCost, scenario.currency)}</div>
              <div style={{ fontSize: 10, color: result.budgetVariance > 0 ? '#f43f5e' : '#34d399', marginTop: 2 }}>
                Budget: {formatCurrency(result.budget, scenario.currency)}
              </div>
            </div>
          </div>

          {/* Evidence-backed Recommendations List */}
          <div className="glass-panel" style={{ padding: '20px 22px' }}>
            <div className="panel-header" style={{ marginBottom: 14 }}>
              <div>
                <h3 className="panel-title">Decision Intelligence Findings & Actionable Interventions</h3>
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Every recommendation is grounded in measured simulation metrics, with explicit benefits, trade-offs, and implementation feasibility.
                </p>
              </div>
              <span className="status-badge-completed">Evidence-Backed</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {recommendations.map((r: DetailedRecommendation, idx: number) => (
                <div
                  key={idx}
                  style={{
                    padding: '16px 18px',
                    borderRadius: 14,
                    background: 'rgba(10, 16, 42, 0.65)',
                    border: `1px solid ${r.severity === 'critical' ? 'rgba(244, 63, 94, 0.35)' : r.severity === 'warning' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(0, 240, 255, 0.25)'}`,
                    display: 'flex',
                    gap: 16
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: r.severity === 'critical' ? 'rgba(244, 63, 94, 0.2)' : r.severity === 'warning' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0, 240, 255, 0.2)',
                      color: r.severity === 'critical' ? '#f43f5e' : r.severity === 'warning' ? '#f59e0b' : '#00f0ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Lightbulb size={22} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h4 style={{ fontSize: 14, color: '#ffffff', fontWeight: 600 }}>{r.problem}</h4>
                        <span style={{ fontSize: 11, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '2px 8px', borderRadius: 8 }}>
                          Component: {r.component}
                        </span>
                      </div>
                      <span className={`priority-pill ${r.feasibilityStatus === 'feasible' ? 'priority-low' : 'priority-medium'}`}>
                        {r.feasibilityStatus === 'feasible' ? 'Feasible In Current Model' : r.feasibilityStatus === 'requires_budget' ? 'Requires Additional Budget' : 'Requires Unmodelled Resource'}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 8, background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 8 }}>
                      <strong>Numerical Evidence:</strong> {r.numericalEvidence}
                    </div>

                    <div style={{ fontSize: 12, color: '#38bdf8', marginBottom: 6 }}>
                      <strong>Suggested Intervention:</strong> {r.suggestedIntervention}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 11, marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
                      <div>
                        <span style={{ color: '#34d399', fontWeight: 600 }}>Expected Benefit:</span>
                        <div style={{ color: '#94a3b8', marginTop: 2 }}>{r.expectedBenefit}</div>
                      </div>
                      <div>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>Cost / Operational Trade-off:</span>
                        <div style={{ color: '#94a3b8', marginTop: 2 }}>{r.tradeoff}</div>
                      </div>
                    </div>

                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                      <em>Assumption: {r.assumption}</em>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Health Breakdown & Bottlenecks Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="glass-panel" style={{ padding: '20px 22px' }}>
              <h3 className="panel-title" style={{ marginBottom: 12 }}>Heuristic Health Index Components</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>Fulfilment Ratio (50% weight)</span>
                  <strong style={{ color: '#00f0ff' }}>{result.healthBreakdown.fulfilmentScore}/100</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>Budget Compliance (25% weight)</span>
                  <strong style={{ color: '#10b981' }}>{result.healthBreakdown.budgetScore}/100</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>Capacity Utilization (15% weight)</span>
                  <strong style={{ color: '#f59e0b' }}>{result.healthBreakdown.utilizationScore}/100</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>Lead-time Delay (10% weight)</span>
                  <strong style={{ color: '#a855f7' }}>{result.healthBreakdown.delayScore}/100</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>Constraint Overrun Penalty</span>
                  <strong style={{ color: result.healthBreakdown.penalty > 0 ? '#f43f5e' : '#10b981' }}>
                    {result.healthBreakdown.penalty > 0 ? `-${result.healthBreakdown.penalty} pts` : '0 pts'}
                  </strong>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '20px 22px' }}>
              <h3 className="panel-title" style={{ marginBottom: 12 }}>Model Assumptions & Limitations</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#94a3b8' }}>
                {result.assumptionNotes.map((note: string, idx: number) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={14} color="#10b981" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------
// 7. HISTORY SCREEN
// ----------------------------------------------------
function HistoryScreen({
  history,
  onOpen,
  onDelete,
  onClear,
  exportBackup,
  importBackup
}: {
  history: SavedRun[];
  onOpen: (run: SavedRun) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  exportBackup: () => void;
  importBackup: (f: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="page-screen-header">
        <div>
          <div className="screen-eyebrow">Local Browser Persistence & Backup</div>
          <h1 className="screen-title">Simulation History & Backups</h1>
          <p className="screen-desc">
            Revisit past what-if simulation runs saved locally in your browser. Export full JSON backups or restore previous models.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-secondary" onClick={exportBackup} title="Export full JSON backup">
            <Download size={15} /> Export Backup
          </button>
          <button className="btn-secondary" onClick={() => fileInputRef.current?.click()} title="Import JSON backup">
            <UploadCloud size={15} /> Import Backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) {
                importBackup(file);
                e.target.value = '';
              }
            }}
          />
          {history.length > 0 && (
            <button className="btn-secondary" style={{ color: '#f43f5e', borderColor: 'rgba(244,63,94,0.3)' }} onClick={onClear}>
              <Trash2 size={15} /> Clear All
            </button>
          )}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px 22px' }}>
        {history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
            <History size={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <h3 style={{ fontSize: 16, color: '#cbd5e1', marginBottom: 4 }}>No Saved Runs Found</h3>
            <p style={{ fontSize: 12 }}>Run a simulation and click "Save Simulation Run" to save it here, or import a JSON backup.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map(run => (
              <div key={run.id} className="component-card-row">
                <div>
                  <strong style={{ fontSize: 13, color: '#ffffff' }}>{run.scenario.name}</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                    {run.result.label} · Saved {new Date(run.savedAt).toLocaleString()}
                    {run.durationMs ? ` · ${run.durationMs}ms runtime` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#34d399' }}>
                      {run.result.overallHealth}/100
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>Health</div>
                  </div>
                  <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: 11 }} onClick={() => onOpen(run)}>
                    Open Report <ArrowRight size={13} />
                  </button>
                  <button
                    className="top-icon-btn"
                    style={{ width: 28, height: 28 }}
                    title="Delete"
                    onClick={() => onDelete(run.id)}
                  >
                    <Trash2 size={13} color="#f43f5e" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ----------------------------------------------------
// 8. PROMPT STUDIO & LOCAL GENERATIVE AI SCREEN
// ----------------------------------------------------
function PromptStudioScreen({
  scenario,
  changes,
  result,
  copied,
  setCopied,
  onQueueChange,
  onSwitchToSimulator
}: {
  scenario: Scenario;
  changes: ScenarioChange[];
  result: SimulationResult | null;
  copied: boolean;
  setCopied: (v: boolean) => void;
  onQueueChange?: (change: ScenarioChange) => void;
  onSwitchToSimulator?: () => void;
}) {
  const [subTab, setSubTab] = useState<'nl_interpreter' | 'recovery' | 'explanation' | 'battle' | 'blueprint'>('nl_interpreter');
  const [templateType, setTemplateType] = useState<'zero' | 'role' | 'structured'>('role');

  // Local AI Model State
  const [capabilities, setCapabilities] = useState<AICapabilities | null>(null);
  const [selectedModel, setSelectedModel] = useState<AIModelId>('SmolLM2-360M-Instruct-q4f16_1-MLC');
  const [aiProgress, setAiProgress] = useState<AIProgress>({ status: 'idle', text: '', progress: 0 });
  const [isLocalReady, setIsLocalReady] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  // Feature A: NL Interpreter & Copilot State
  const [nlInput, setNlInput] = useState<string>('What happens if customer demand increases by 40%?');
  const [conversationResponse, setConversationResponse] = useState<NLConversationResponse | null>(null);
  const [nlMode, setNlMode] = useState<'GENERATIVE_AI' | 'RULE_BASED' | null>(null);
  const [appliedCount, setAppliedCount] = useState<number>(0);
  const [simulationExecution, setSimulationExecution] = useState<SimulationExecutionWithAI | null>(null);

  // Feature B: Recovery State
  const [recoveryProposal, setRecoveryProposal] = useState<AIRecoveryProposal | null>(null);
  const [recoveryMode, setRecoveryMode] = useState<'GENERATIVE_AI' | 'RULE_BASED' | null>(null);

  // Feature C: Explanation State
  const [explanation, setExplanation] = useState<AIDecisionExplanation | null>(null);
  const [explanationMode, setExplanationMode] = useState<'GENERATIVE_AI' | 'RULE_BASED' | null>(null);

  // Feature D: Battle State
  const [battleResult, setBattleResult] = useState<PromptBattleResult | null>(null);

  // Check hardware capabilities on mount
  useEffect(() => {
    checkAICapabilities().then(caps => {
      setCapabilities(caps);
      setIsLocalReady(isLocalAIReady());
    });
  }, []);

  async function handleToggleLocalAI() {
    if (isLocalReady) {
      await unloadLocalAI();
      setIsLocalReady(false);
      setAiProgress({ status: 'idle', text: 'Model unloaded from GPU memory.', progress: 0 });
      return;
    }

    setIsBusy(true);
    const success = await initializeLocalAI(selectedModel, (prog) => {
      setAiProgress(prog);
    });
    setIsLocalReady(success);
    setIsBusy(false);
  }

  // Action: Process Natural Language Query with Unified Copilot
  async function handleInterpretScenario() {
    if (!nlInput.trim()) return;
    setIsBusy(true);
    setSimulationExecution(null);
    try {
      const { response, mode } = await processNaturalLanguageQuery(nlInput, scenario, result);
      setConversationResponse(response);
      setNlMode(mode);
      setAppliedCount(0);
    } finally {
      setIsBusy(false);
    }
  }

  // Action: Queue AI Proposed Changes
  function handleQueueAllProposedChanges() {
    if (!conversationResponse || !onQueueChange) return;
    conversationResponse.proposedChanges.forEach((change, idx) => {
      onQueueChange({
        id: `ai-prop-${Date.now()}-${idx}`,
        nodeId: change.targetNodeId,
        variable: change.variable,
        operation: change.operation,
        value: change.value,
        label: `AI: ${change.targetNodeName} ${change.variable} ${change.operation} ${change.value}`
      });
    });
    setAppliedCount(conversationResponse.proposedChanges.length);
  }

  // Action: Confirm and Immediately Execute What-If Simulation
  function handleConfirmAndSimulate() {
    if (!conversationResponse || conversationResponse.proposedChanges.length === 0) return;
    const simChanges: ScenarioChange[] = conversationResponse.proposedChanges.map((change, idx) => ({
      id: `ai-sim-${Date.now()}-${idx}`,
      nodeId: change.targetNodeId,
      variable: change.variable,
      operation: change.operation,
      value: change.value,
      label: `${change.targetNodeName}: ${change.variable} ${change.operation} ${change.value}`
    }));

    const exec = executeSimulationWithAIExplanation(scenario, simChanges);
    setSimulationExecution(exec);

    // Queue to active session so subsequent tabs see it
    if (onQueueChange) {
      simChanges.forEach(c => onQueueChange(c));
      setAppliedCount(simChanges.length);
    }
  }

  // Action: Generate Recovery Strategies
  async function handleGenerateRecovery() {
    setIsBusy(true);
    try {
      // Use active simulation or run baseline if null
      const currentRes = result || simulate(scenario, changes);
      const { proposal, mode } = await generateRecoveryStrategies(scenario, currentRes);
      setRecoveryProposal(proposal);
      setRecoveryMode(mode);
    } finally {
      setIsBusy(false);
    }
  }

  // Action: Queue Recovery Strategy
  function handleQueueRecoveryStrategy(strat: any) {
    if (!onQueueChange || !strat.associatedChanges) return;
    strat.associatedChanges.forEach((c: any, idx: number) => {
      onQueueChange({
        id: `recov-${Date.now()}-${idx}`,
        nodeId: c.nodeId,
        variable: c.variable,
        operation: c.operation,
        value: c.value,
        label: `Recovery (${strat.title}): ${c.variable} ${c.operation} ${c.value}`
      });
    });
  }

  // Action: Generate Decision Explanation
  async function handleGenerateExplanation() {
    setIsBusy(true);
    try {
      const currentRes = result || simulate(scenario, changes);
      const { explanation: exp, mode } = await generateDecisionExplanation(scenario, currentRes);
      setExplanation(exp);
      setExplanationMode(mode);
    } finally {
      setIsBusy(false);
    }
  }

  // Action: Run Prompt Battle
  async function handleRunPromptBattle() {
    setIsBusy(true);
    try {
      const currentRes = result || simulate(scenario, changes);
      const res = await executePromptBattle(scenario, currentRes);
      setBattleResult(res);
    } finally {
      setIsBusy(false);
    }
  }

  // Blueprint context payload
  const contextPayload = JSON.stringify({
    scenario: {
      name: scenario.name,
      domain: scenario.domain,
      budget: scenario.budget,
      components: scenario.nodes.map((n: SimNode) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        capacity: n.capacity,
        demand: n.demand,
        unitCost: n.unitCost
      })),
      dependencies: scenario.edges.map((e: SimEdge) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        influence: e.influence
      }))
    },
    activeDisruptions: changes,
    calculatedOutcomes: result ? {
      healthScore: result.overallHealth,
      unmetDemand: result.totalUnmet,
      operatingCost: result.totalCost,
      bottlenecks: result.bottlenecks,
      impactedNodes: result.impactedNodeIds
    } : 'Baseline not yet simulated'
  }, null, 2);

  const promptText = useMemo(() => {
    if (templateType === 'zero') {
      return `Analyze the following operational scenario and calculate the most critical risks:
${contextPayload}

Provide actionable recommendations without inventing any numerical data.`;
    }

    if (templateType === 'role') {
      return `ROLE: Senior Operational Risk & Decision Intelligence Architect
SYSTEM CONTEXT: WHATIF AI Decision Simulation Platform

SCENARIO DATA:
${contextPayload}

OBJECTIVE:
Analyze the ripple effects of the configured disruption. Identify the shared bottleneck causing downstream capacity degradation.

STRICT CONSTRAINTS:
1. Do not invent, calculate, or override numeric capacity, fulfilment, or cost values.
2. Rely strictly on the deterministic figures provided in calculatedOutcomes.
3. Propose up to three mitigation strategies with concrete operational trade-offs.

OUTPUT:
Deliver an executive briefing summarizing:
- Primary Root Bottleneck
- Downstream Ripple Progression
- Recommended Interventions with Associated Trade-offs`;
    }

    return `SYSTEM: Return strictly valid JSON conforming to the schema below.
SCHEMA:
{
  "summary": string,
  "criticalBottleneck": string,
  "affectedComponents": string[],
  "interventions": [
    { "title": string, "rationale": string, "tradeoff": string, "requiredAssumptions": string }
  ],
  "unresolvedQuestions": string[]
}

FACTS PROVIDED:
${contextPayload}

INSTRUCTION: Ensure every recommendation references explicit components from the facts. Do not invent metrics.`;
  }, [templateType, contextPayload]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="page-screen-header">
        <div>
          <div className="screen-eyebrow">Local Generative AI & Decision Copilot</div>
          <h1 className="screen-title">Prompt Studio</h1>
          <p className="screen-desc">
            Browser-based on-device Generative AI powered by WebLLM with zero API keys or server transmission, strictly grounded in the deterministic simulation engine.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span
            className="status-badge"
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              background: isLocalReady ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0, 240, 255, 0.12)',
              border: `1px solid ${isLocalReady ? '#10b981' : '#00f0ff'}`,
              color: isLocalReady ? '#10b981' : '#00f0ff',
              boxShadow: isLocalReady ? '0 0 14px rgba(16, 185, 129, 0.3)' : '0 0 14px rgba(0, 240, 255, 0.2)'
            }}
          >
            {isLocalReady ? `LOCAL AI: ${selectedModel.split('-')[0]} (WebGPU)` : 'RULE-BASED MODE (Deterministic)'}
          </span>
          {subTab === 'blueprint' && (
            <button className="btn-primary" onClick={copyPrompt}>
              <Copy size={16} /> {copied ? 'Copied!' : 'Copy Blueprint'}
            </button>
          )}
        </div>
      </div>

      {/* Local AI Model Control Bar */}
      <div
        className="glass-panel"
        style={{
          padding: '16px 22px',
          marginBottom: 20,
          background: 'rgba(10, 16, 38, 0.7)',
          border: '1px solid rgba(0, 240, 255, 0.22)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ padding: 10, borderRadius: 12, background: 'rgba(0, 240, 255, 0.1)', border: '1px solid rgba(0, 240, 255, 0.3)' }}>
              <Bot size={22} color="#00f0ff" />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 8 }}>
                Local In-Browser LLM Engine
                {capabilities?.webgpuSupported ? (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                    WebGPU Verified
                  </span>
                ) : (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                    Standard Browser (Rule-Based Active)
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                {capabilities?.adapterInfo?.description || 'Hardware WebGPU acceleration available for on-device inference.'} Zero external telemetry.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as AIModelId)}
              disabled={isLocalReady || isBusy}
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: '#e2e8f0',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12
              }}
            >
              {SUPPORTED_LOCAL_MODELS.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} (~{m.downloadSizeMB}MB)
                </option>
              ))}
            </select>

            <button
              onClick={handleToggleLocalAI}
              disabled={isBusy}
              className={isLocalReady ? 'btn-secondary' : 'btn-primary'}
              style={{ minWidth: 140 }}
            >
              {isBusy ? (
                <>
                  <RefreshCw size={14} className="spin" /> Initializing...
                </>
              ) : isLocalReady ? (
                <>
                  <Trash2 size={14} color="#f43f5e" /> Unload Model
                </>
              ) : (
                <>
                  <Sparkles size={14} /> Activate Local AI
                </>
              )}
            </button>
          </div>
        </div>

        {/* Loading Progress Bar */}
        {aiProgress.status !== 'idle' && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#38bdf8', marginBottom: 6 }}>
              <span>{aiProgress.text}</span>
              <span>{Math.round(aiProgress.progress * 100)}%</span>
            </div>
            <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.round(aiProgress.progress * 100)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #00f0ff, #3b82f6)',
                  borderRadius: 3,
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Feature Sub-Navigation Tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'nl_interpreter', label: 'Scenario Interpreter', icon: Sparkles, desc: 'Natural Language to Changes' },
          { id: 'recovery', label: 'Recovery Generator', icon: ShieldCheck, desc: 'AI Tactical Interventions' },
          { id: 'explanation', label: 'Decision Briefing', icon: FileText, desc: 'Evidence-Based Executive Brief' },
          { id: 'battle', label: 'Prompt Battle Arena', icon: Flame, desc: 'Zero-Shot vs Role vs Structured' },
          { id: 'blueprint', label: 'Prompt Blueprint', icon: Copy, desc: 'Raw Templates for External LLMs' }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id as any)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 12,
                cursor: 'pointer',
                background: isActive ? 'rgba(0, 240, 255, 0.14)' : 'rgba(15, 23, 42, 0.5)',
                border: `1px solid ${isActive ? '#00f0ff' : 'rgba(255, 255, 255, 0.08)'}`,
                color: isActive ? '#00f0ff' : '#94a3b8',
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
                transition: 'all 0.2s ease',
                boxShadow: isActive ? '0 0 16px rgba(0, 240, 255, 0.15)' : 'none'
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: NATURAL LANGUAGE DECISION COPILOT */}
      {subTab === 'nl_interpreter' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="glass-panel" style={{ padding: '22px 24px' }}>
            <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Sparkles size={18} color="#00f0ff" /> Natural Language Copilot
            </h3>
            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
              Ask analytical questions or propose what-if scenario disruptions. The engine classifies your intent, maps multi-variable constraints, and evaluates responses deterministically.
            </p>

            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center', width: '100%', marginBottom: 2 }}>
                Verified Scenario Inquiries:
              </span>
              {[
                'What happens if customer demand increases by 40%?',
                'What if my supplier becomes unavailable?',
                'Increase attendance by 100 and reduce volunteers by 20%.',
                'Which component is causing the biggest bottleneck?',
                'Suggest three recovery strategies within my current budget.',
                'What would happen if I activate a backup supplier?'
              ].map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setNlInput(ex)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 14,
                    background: nlInput === ex ? 'rgba(0, 240, 255, 0.2)' : 'rgba(0, 240, 255, 0.06)',
                    border: `1px solid ${nlInput === ex ? '#00f0ff' : 'rgba(0, 240, 255, 0.2)'}`,
                    color: nlInput === ex ? '#ffffff' : '#38bdf8',
                    fontSize: 11,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>

            <textarea
              value={nlInput}
              onChange={(e) => setNlInput(e.target.value)}
              placeholder="e.g. What happens if customer demand increases by 40%?"
              rows={3}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(6, 10, 28, 0.8)',
                border: '1px solid rgba(0, 240, 255, 0.25)',
                color: '#f8fafc',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'none',
                marginBottom: 16
              }}
            />

            <button
              onClick={handleInterpretScenario}
              disabled={isBusy || !nlInput.trim()}
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {isBusy ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
              Ask Decision Copilot
            </button>
          </div>

          {/* Response & Simulation Confirmation Card */}
          <div className="glass-panel" style={{ padding: '22px 24px' }}>
            <div className="panel-header" style={{ marginBottom: 14 }}>
              <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} color="#10b981" /> Copilot Assessment
              </h3>
              {nlMode && (
                <span className={nlMode === 'GENERATIVE_AI' ? 'status-badge-completed' : 'status-badge'}>
                  {nlMode === 'GENERATIVE_AI' ? 'Local LLM (WebGPU)' : 'Rule-Based Engine'}
                </span>
              )}
            </div>

            {conversationResponse ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Intent & Direct Answer */}
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(0, 240, 255, 0.08)', border: '1px solid rgba(0, 240, 255, 0.25)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(0, 240, 255, 0.15)', color: '#00f0ff', textTransform: 'uppercase' }}>
                      Intent: {conversationResponse.intent.replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>
                      Confidence: {Math.round(conversationResponse.confidenceScore * 100)}%
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', marginBottom: 4 }}>
                    {conversationResponse.directAnswer}
                  </div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.5 }}>
                    {conversationResponse.explanation}
                  </div>
                </div>

                {/* Proposed Changes (For Simulation Disruptions) */}
                {conversationResponse.proposedChanges.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
                      Proposed Parameter Changes ({conversationResponse.proposedChanges.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', marginBottom: 12 }}>
                      {conversationResponse.proposedChanges.map((change, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'rgba(15, 23, 42, 0.7)',
                            border: '1px solid rgba(0, 240, 255, 0.15)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: 12, color: '#00f0ff' }}>{change.targetNodeName}</strong>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              Variable: <code style={{ color: '#38bdf8' }}>{change.variable}</code> | Operation: <code style={{ color: '#f59e0b' }}>{change.operation}</code>
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', padding: '3px 8px', background: 'rgba(0, 240, 255, 0.12)', borderRadius: 6 }}>
                            {change.operation === 'multiply' ? `${change.value}×` : change.operation === 'add' ? `+${change.value}` : change.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Action Confirmation & Simulation Buttons */}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={handleConfirmAndSimulate}
                        className="btn-primary"
                        style={{ flex: 1, justifyContent: 'center', background: 'linear-gradient(90deg, #10b981, #059669)' }}
                      >
                        <Play size={14} /> Confirm & Simulate What-If
                      </button>
                      <button
                        onClick={handleQueueAllProposedChanges}
                        className="btn-secondary"
                        style={{ justifyContent: 'center' }}
                      >
                        <Plus size={14} /> Queue ({conversationResponse.proposedChanges.length})
                      </button>
                    </div>
                  </div>
                )}

                {/* Simulation Execution Outcome Card */}
                {simulationExecution && (
                  <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', marginBottom: 6 }}>
                      Deterministic Simulation Result
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                      <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>Health Score</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: simulationExecution.variance.healthDelta < 0 ? '#f43f5e' : '#10b981' }}>
                          {simulationExecution.simulatedResult.overallHealth}/100 ({simulationExecution.variance.healthDelta >= 0 ? '+' : ''}{simulationExecution.variance.healthDelta.toFixed(0)})
                        </div>
                      </div>
                      <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>Unmet Demand</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: simulationExecution.variance.unmetDemandDelta > 0 ? '#f43f5e' : '#10b981' }}>
                          +{simulationExecution.variance.unmetDemandDelta.toFixed(1)} units
                        </div>
                      </div>
                      <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>Cost Shift</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8' }}>
                          +{formatCurrency(simulationExecution.variance.costDelta, scenario.currency)}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#f8fafc', lineHeight: 1.5 }}>
                      <strong>AI Explanation:</strong> {simulationExecution.aiExplanation}
                    </div>
                  </div>
                )}

                {/* Recovery Strategies (For Recovery Queries) */}
                {conversationResponse.suggestedRecoveryStrategies && conversationResponse.suggestedRecoveryStrategies.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Suggested Tactical Interventions:</div>
                    {conversationResponse.suggestedRecoveryStrategies.map((strat, i) => (
                      <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(0, 240, 255, 0.15)' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#00f0ff' }}>{strat.title}</div>
                        <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{strat.proposedAction}</div>
                        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠️ {strat.operationalTradeoffs}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
                <Bot size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <div style={{ fontSize: 13, color: '#94a3b8' }}>No query submitted yet</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Select a verified inquiry on the left or type your own question</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RECOVERY STRATEGY GENERATOR */}
      {subTab === 'recovery' && (
        <div className="glass-panel" style={{ padding: '22px 24px' }}>
          <div className="panel-header" style={{ marginBottom: 14 }}>
            <div>
              <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={18} color="#00f0ff" /> Operational Recovery Advisor
              </h3>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Evaluates actual bottleneck telemetry from the deterministic simulation and proposes contextual recovery actions.
              </p>
            </div>
            <button onClick={handleGenerateRecovery} disabled={isBusy} className="btn-primary">
              {isBusy ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
              Generate Recovery Strategies
            </button>
          </div>

          {recoveryProposal ? (
            <div>
              <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(0, 240, 255, 0.08)', border: '1px solid rgba(0, 240, 255, 0.25)', marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#00f0ff', textTransform: 'uppercase', marginBottom: 4 }}>
                  Diagnostic Summary ({recoveryMode === 'GENERATIVE_AI' ? 'Local LLM' : 'Rule-Based Expert'})
                </div>
                <div style={{ fontSize: 13, color: '#ffffff', lineHeight: 1.5 }}>
                  {recoveryProposal.analysisSummary}
                </div>
                <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 6 }}>
                  Root Bottleneck: <strong>{recoveryProposal.identifiedRootBottleneck}</strong>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                {recoveryProposal.strategies.map((strat, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 18,
                      borderRadius: 14,
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(0, 240, 255, 0.18)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <strong style={{ fontSize: 14, color: '#ffffff' }}>{strat.title}</strong>
                        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 8, background: 'rgba(0, 240, 255, 0.15)', color: '#00f0ff' }}>
                          {strat.actionType}
                        </span>
                      </div>

                      <p style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 12 }}>
                        {strat.proposedAction}
                      </p>

                      <div style={{ fontSize: 11, color: '#10b981', marginBottom: 6 }}>
                        ✓ Expected Benefit: {strat.expectedBenefits}
                      </div>
                      <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 14 }}>
                        ⚠️ Trade-off: {strat.operationalTradeoffs}
                      </div>
                    </div>

                    <button
                      onClick={() => handleQueueRecoveryStrategy(strat)}
                      className="btn-secondary"
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      <Plus size={14} /> Queue Strategy Changes
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
              <ShieldCheck size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div style={{ fontSize: 14, color: '#94a3b8' }}>No recovery plan generated yet</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Click "Generate Recovery Strategies" to evaluate active bottleneck solutions</div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DECISION BRIEFING GENERATOR */}
      {subTab === 'explanation' && (
        <div className="glass-panel" style={{ padding: '22px 24px' }}>
          <div className="panel-header" style={{ marginBottom: 14 }}>
            <div>
              <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={18} color="#00f0ff" /> Executive Decision Briefing
              </h3>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Synthesizes critical path propagation, budget variance, and cascading risk factors into an evidence-based executive brief.
              </p>
            </div>
            <button onClick={handleGenerateExplanation} disabled={isBusy} className="btn-primary">
              {isBusy ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
              Generate Decision Briefing
            </button>
          </div>

          {explanation ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ padding: '16px 20px', borderRadius: 12, background: 'rgba(0, 240, 255, 0.1)', border: '1px solid rgba(0, 240, 255, 0.3)' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
                  {explanation.headline}
                </div>
                <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6 }}>
                  {explanation.executiveSummary}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, borderRadius: 12, background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#00f0ff', marginBottom: 6 }}>
                    Critical Path & Propagation Analysis
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                    {explanation.criticalPathAnalysis}
                  </div>
                </div>

                <div style={{ padding: 16, borderRadius: 12, background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#00f0ff', marginBottom: 6 }}>
                    Financial & Budgetary Impact
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                    {explanation.financialAndCostImpact}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, borderRadius: 12, background: 'rgba(244, 63, 94, 0.08)', border: '1px solid rgba(244, 63, 94, 0.25)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f43f5e', marginBottom: 8 }}>
                    Identified Operational Risks ({explanation.keyRisks.length})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                    {explanation.keyRisks.map((risk, i) => (
                      <li key={i}>{risk}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ padding: 16, borderRadius: 12, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>
                    Recommended Action Items ({explanation.recommendedNextSteps.length})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                    {explanation.recommendedNextSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
              <FileText size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div style={{ fontSize: 14, color: '#94a3b8' }}>No decision briefing generated yet</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Click "Generate Decision Briefing" to synthesize the latest simulation traces</div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PROMPT BATTLE ARENA */}
      {subTab === 'battle' && (
        <div className="glass-panel" style={{ padding: '22px 24px' }}>
          <div className="panel-header" style={{ marginBottom: 14 }}>
            <div>
              <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Flame size={18} color="#f43f5e" /> Prompt Battle Arena
              </h3>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Executes Zero-Shot, Role-Constrained, and Context-Aware Structured prompt strategies against identical simulation telemetry and evaluates them using deterministic scoring rubrics.
              </p>
            </div>
            <button onClick={handleRunPromptBattle} disabled={isBusy} className="btn-primary">
              {isBusy ? <RefreshCw size={14} className="spin" /> : <Flame size={14} />}
              Start Prompt Battle
            </button>
          </div>

          {battleResult ? (
            <div>
              <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', marginBottom: 4 }}>
                  🏆 Battle Outcome: {battleResult.rounds.find(r => r.style === battleResult.winnerStyle)?.name} Won
                </div>
                <div style={{ fontSize: 13, color: '#ffffff' }}>
                  {battleResult.rubricSummary}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 16 }}>
                {battleResult.rounds.map((round, idx) => {
                  const isWinner = round.style === battleResult.winnerStyle;
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: 18,
                        borderRadius: 14,
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: `1px solid ${isWinner ? '#10b981' : 'rgba(255, 255, 255, 0.1)'}`,
                        boxShadow: isWinner ? '0 0 20px rgba(16, 185, 129, 0.2)' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div>
                            <strong style={{ fontSize: 14, color: isWinner ? '#10b981' : '#ffffff' }}>
                              {round.name}
                            </strong>
                            <div style={{ fontSize: 10, color: '#94a3b8' }}>
                              Latency: {round.executionTimeMs}ms
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              padding: '4px 10px',
                              borderRadius: 8,
                              background: isWinner ? 'rgba(16, 185, 129, 0.2)' : 'rgba(0, 240, 255, 0.12)',
                              color: isWinner ? '#10b981' : '#00f0ff'
                            }}
                          >
                            {round.scores.compositeScore}/100
                          </span>
                        </div>

                        {/* Metric Scores */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14, fontSize: 11 }}>
                          <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)' }}>
                            <span style={{ color: '#94a3b8' }}>Accuracy: </span>
                            <strong style={{ color: '#10b981' }}>{round.scores.hallucinationIndex}%</strong>
                          </div>
                          <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)' }}>
                            <span style={{ color: '#94a3b8' }}>Actionability: </span>
                            <strong style={{ color: '#00f0ff' }}>{round.scores.actionability}%</strong>
                          </div>
                          <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)' }}>
                            <span style={{ color: '#94a3b8' }}>Constraints: </span>
                            <strong style={{ color: '#f59e0b' }}>{round.scores.constraintAdherence}%</strong>
                          </div>
                          <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)' }}>
                            <span style={{ color: '#94a3b8' }}>Coverage: </span>
                            <strong style={{ color: '#38bdf8' }}>{round.scores.componentCoverage}%</strong>
                          </div>
                        </div>

                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>
                          Model Output Preview
                        </div>
                        <pre
                          style={{
                            padding: 10,
                            borderRadius: 8,
                            background: 'rgba(6, 10, 28, 0.85)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            fontSize: 11,
                            color: '#cbd5e1',
                            maxHeight: 180,
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.4
                          }}
                        >
                          {round.response}
                        </pre>
                      </div>

                      {round.hallucinatedClaims.length > 0 && (
                        <div style={{ marginTop: 10, fontSize: 10, color: '#f43f5e' }}>
                          ⚠️ {round.hallucinatedClaims[0]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
              <Flame size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div style={{ fontSize: 14, color: '#94a3b8' }}>Prompt battle not yet executed</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Click "Start Prompt Battle" to compare zero-shot, role-based, and structured prompt effectiveness</div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: PROMPT BLUEPRINT STUDIO */}
      {subTab === 'blueprint' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>
          {/* Templates Selector */}
          <div className="glass-panel" style={{ padding: '20px 22px' }}>
            <h3 className="panel-title" style={{ marginBottom: 14 }}>Prompt Templates</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className={`component-card-row ${templateType === 'role' ? 'active-border' : ''}`}
                style={{
                  borderColor: templateType === 'role' ? '#00f0ff' : undefined,
                  background: templateType === 'role' ? 'rgba(0, 240, 255, 0.12)' : undefined,
                  cursor: 'pointer'
                }}
                onClick={() => setTemplateType('role')}
              >
                <div>
                  <strong style={{ fontSize: 13, color: '#ffffff' }}>Role-Based Analyst</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Operational risk architect persona with explicit constraints.</div>
                </div>
              </button>

              <button
                className="component-card-row"
                style={{
                  borderColor: templateType === 'structured' ? '#00f0ff' : undefined,
                  background: templateType === 'structured' ? 'rgba(0, 240, 255, 0.12)' : undefined,
                  cursor: 'pointer'
                }}
                onClick={() => setTemplateType('structured')}
              >
                <div>
                  <strong style={{ fontSize: 13, color: '#ffffff' }}>Structured JSON Output</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Enforces Zod-compatible structured schema.</div>
                </div>
              </button>

              <button
                className="component-card-row"
                style={{
                  borderColor: templateType === 'zero' ? '#00f0ff' : undefined,
                  background: templateType === 'zero' ? 'rgba(0, 240, 255, 0.12)' : undefined,
                  cursor: 'pointer'
                }}
                onClick={() => setTemplateType('zero')}
              >
                <div>
                  <strong style={{ fontSize: 13, color: '#ffffff' }}>Zero-Shot Quick Analyst</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Direct factual prompt without persona preamble.</div>
                </div>
              </button>
            </div>

            <div style={{ marginTop: 20, padding: 14, borderRadius: 12, background: 'rgba(0, 240, 255, 0.08)', border: '1px solid rgba(0, 240, 255, 0.2)', fontSize: 11, color: '#cbd5e1' }}>
              <ShieldCheck size={16} color="#00f0ff" style={{ marginBottom: 6 }} />
              <div><strong>AI Safety Principle:</strong> The deterministic simulation engine is always the single source of truth. Language models must never invent or override calculations.</div>
            </div>
          </div>

          {/* Generated Prompt Output */}
          <div className="glass-panel" style={{ padding: '20px 22px' }}>
            <div className="panel-header" style={{ marginBottom: 12 }}>
              <h3 className="panel-title">Generated Prompt Blueprint</h3>
              <span className="status-badge-completed">Ready for Inference</span>
            </div>

            <pre
              style={{
                padding: 16,
                borderRadius: 14,
                background: 'rgba(6, 10, 28, 0.85)',
                border: '1px solid rgba(0, 240, 255, 0.18)',
                color: '#38bdf8',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                maxHeight: 520,
                overflowY: 'auto'
              }}
            >
              {promptText}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
