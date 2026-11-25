import type { Scenario, SavedRun, SimNode } from '../types/index.ts';
import { ScenarioSchema } from '../types/schema.ts';

export const STORAGE_VERSION = 1;
const STORAGE_KEYS = {
  HISTORY: 'whatif_v1_history',
  SCENARIOS: 'whatif_v1_scenarios',
  LEGACY_HISTORY: 'whatif-history',
  LEGACY_SCENARIOS: 'whatif-scenarios'
};

export interface BackupData {
  version: number;
  exportedAt: string;
  scenarios: Scenario[];
  history: SavedRun[];
}

/**
 * Normalizes a SimNode to ensure all standardized fields exist even in older schemas.
 */
export function normalizeNode(node: any, defaultCurrency = 'INR'): SimNode {
  return {
    id: String(node.id || `node-${crypto.randomUUID().slice(0, 8)}`),
    name: String(node.name || 'Component'),
    type: String(node.type || 'process'),
    quantityUnit: String(node.quantityUnit || 'units'),
    operatingPeriod: node.operatingPeriod || 'day',
    costCurrency: String(node.costCurrency || defaultCurrency),
    costBasis: node.costBasis || 'per_fulfilled',
    fixedCost: Math.max(0, Number(node.fixedCost || 0)),
    unitCost: Math.max(0, Number(node.unitCost || 0)),
    demand: Math.max(0, Number(node.demand || 0)),
    capacity: Math.max(0, Number(node.capacity || 0)),
    availability: Math.max(0, Math.min(1, Number(node.availability ?? 1))),
    baseDelayHours: Math.max(0, Number(node.baseDelayHours || 0)),
    priority: ['low', 'medium', 'high'].includes(node.priority) ? node.priority : 'medium',
    budget: node.budget ? Number(node.budget) : undefined,
    description: node.description ? String(node.description) : undefined
  };
}

/**
 * Normalizes a Scenario to ensure complete structural validity.
 */
export function normalizeScenario(s: any): Scenario | null {
  if (!s || typeof s !== 'object' || !s.id || !s.name || !Array.isArray(s.nodes)) {
    return null;
  }
  const currency = s.currency || 'INR';
  const nodes = s.nodes.map((n: any) => normalizeNode(n, currency));
  const edges = Array.isArray(s.edges)
    ? s.edges.map((e: any) => ({
        id: String(e.id || `edge-${crypto.randomUUID().slice(0, 8)}`),
        source: String(e.source || ''),
        target: String(e.target || ''),
        type: ['supplies', 'requires', 'supports', 'delays', 'increases_cost'].includes(e.type)
          ? e.type
          : 'requires',
        influence: Math.max(0, Math.min(1, Number(e.influence ?? 0.7))),
        aggregation: e.aggregation,
        basePropagationDelayHours: Number(e.basePropagationDelayHours || 0),
        shortageDelayHours: Number(e.shortageDelayHours || 0),
        additionalUnitCost: Number(e.additionalUnitCost || 0)
      }))
    : [];

  return {
    id: String(s.id),
    name: String(s.name),
    domain: ['campus', 'business', 'supply', 'custom'].includes(s.domain) ? s.domain : 'custom',
    description: String(s.description || ''),
    budget: Math.max(0, Number(s.budget || 0)),
    currency,
    nodes,
    edges,
    createdAt: String(s.createdAt || new Date().toISOString())
  };
}

/**
 * Safely loads simulation history from versioned localStorage with schema normalization and fallback.
 */
export function loadSafeHistory(): SavedRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY) || localStorage.getItem(STORAGE_KEYS.LEGACY_HISTORY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validRuns: SavedRun[] = [];
    for (const item of parsed) {
      if (item && item.id && item.result && item.scenario) {
        const normScenario = normalizeScenario(item.scenario);
        if (normScenario) {
          validRuns.push({
            id: String(item.id),
            scenario: normScenario,
            result: item.result,
            savedAt: String(item.savedAt || new Date().toISOString())
          });
        }
      }
    }
    return validRuns.slice(0, 50); // Cap history to 50 items
  } catch (err) {
    console.warn('[WHATIF AI] Could not load history from localStorage (corrupt JSON or unavailable):', err);
    return [];
  }
}

/**
 * Safely persists history with versioning.
 */
export function saveSafeHistory(history: SavedRun[]): void {
  try {
    const capped = history.slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(capped));
  } catch (err) {
    console.error('[WHATIF AI] Error persisting history to localStorage:', err);
  }
}

/**
 * Safely loads custom scenarios from versioned localStorage.
 */
export function loadSafeScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SCENARIOS) || localStorage.getItem(STORAGE_KEYS.LEGACY_SCENARIOS);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid: Scenario[] = [];
    for (const item of parsed) {
      const norm = normalizeScenario(item);
      if (norm) valid.push(norm);
    }
    return valid;
  } catch (err) {
    console.warn('[WHATIF AI] Could not load scenarios from localStorage:', err);
    return [];
  }
}

/**
 * Safely persists custom scenarios.
 */
export function saveSafeScenarios(scenarios: Scenario[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(scenarios));
  } catch (err) {
    console.error('[WHATIF AI] Error persisting scenarios to localStorage:', err);
  }
}

/**
 * Creates a complete JSON backup of the user's scenarios and simulation history.
 */
export function createBackupJSON(scenarios: Scenario[], history: SavedRun[]): string {
  const data: BackupData = {
    version: STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    scenarios,
    history
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Validates and restores a JSON backup file. Returns a clean object or throws a friendly error.
 */
export function parseAndValidateBackup(jsonString: string): { scenarios: Scenario[]; history: SavedRun[] } {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid file format: Backup file must be a valid JSON document.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Incompatible backup file: Root element must be an object.');
  }

  if (parsed.version && parsed.version > STORAGE_VERSION) {
    throw new Error(`Incompatible backup version: File was created by a newer version (v${parsed.version}) of WHATIF AI.`);
  }

  const rawScenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
  const rawHistory = Array.isArray(parsed.history) ? parsed.history : [];

  const restoredScenarios: Scenario[] = [];
  for (const s of rawScenarios) {
    const norm = normalizeScenario(s);
    if (norm) restoredScenarios.push(norm);
  }

  const restoredHistory: SavedRun[] = [];
  for (const h of rawHistory) {
    if (h && h.id && h.scenario && h.result) {
      const normScenario = normalizeScenario(h.scenario);
      if (normScenario) {
        restoredHistory.push({
          id: String(h.id),
          scenario: normScenario,
          result: h.result,
          savedAt: String(h.savedAt || new Date().toISOString())
        });
      }
    }
  }

  return {
    scenarios: restoredScenarios,
    history: restoredHistory
  };
}
