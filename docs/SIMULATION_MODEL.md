# WHATIF AI — Universal Simulation Mathematical Model & Specification

**Version:** 2.0 (Universal Accuracy Upgrade)  
**Status:** Approved & Verified  
**Engine Implementation:** `src/engine/simulation.ts` & `src/engine/advisor.ts`  

---

## 1. Core Principles & Architecture

WHATIF AI operates as a deterministic decision-support simulator. It is intentionally designed as a **simulation-first, client-side decision engine** with zero reliance on opaque statistical black boxes or non-deterministic large language models for numerical calculations.

1. **Deterministic Truth:** Identical scenario configurations and disruption sets produce identical component metrics, traces, costs, delays, and health scores across every execution.
2. **Explicit Semantics:** No hidden surcharges, arbitrary multipliers, or undocumented delay penalties exist within the engine. Every outcome is traceable to an explicit formula, input parameter, or user-configured assumption.
3. **Traceability & Explainability:** Every node calculation outputs a human-readable trace detailing its availability factor, dependency factor, and upstream edge explanations.

---

## 2. Standardized Node Model

Every operational component within WHATIF AI is defined by the following standardized parameters validated via Zod (`SimNodeSchema`):

| Parameter | Type | Valid Range | Default | Semantic Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `string` | Non-empty | — | Unique component identifier within the scenario. |
| `name` | `string` | Non-empty | — | Human-readable component name. |
| `type` | `string` | Non-empty | `'process'` | Functional category (e.g., `'supplier'`, `'facility'`, `'stock'`). |
| `quantityUnit` | `string` | Non-empty | `'units'` | Physical unit of throughput (e.g., `'attendee'`, `'case'`, `'pallet'`). |
| `operatingPeriod` | `enum` | `'event' \| 'day' \| 'week' \| 'month' \| 'quarter' \| 'year'` | `'day'` | Operational time horizon for demand and capacity. |
| `costCurrency` | `string` | ISO Currency Code | `'INR'` | Currency representation for fixed and variable costs. |
| `costBasis` | `enum` | `'per_fulfilled' \| 'per_demanded' \| 'per_capacity' \| 'fixed'` | `'per_fulfilled'` | Mathematical rule determining variable cost computation. |
| `fixedCost` | `number` | $[0, \infty)$ | `0` | Baseline standing operating cost incurred regardless of volume. |
| `unitCost` | `number` | $[0, \infty)$ | `0` | Cost coefficient applied according to `costBasis`. |
| `demand` | `number` | $[0, \infty)$ | `0` | Total incoming required workload or orders within `operatingPeriod`. |
| `capacity` | `number` | $[0, \infty)$ | `0` | Maximum rated throughput under 100% availability. |
| `availability` | `number` | $[0.0, 1.0]$ | `1.0` | Internal operational readiness ratio (0 = offline, 1 = nominal). |
| `baseDelayHours`| `number` | $[0, \infty)$ | `0` | Inherent internal processing duration before upstream propagation. |
| `priority` | `enum` | `'low' \| 'medium' \| 'high'` | `'medium'` | Criticality classification for bottleneck prioritization. |

---

## 3. Standardized Dependency Semantics

Directed dependencies connect upstream node $u$ to downstream node $v$ ($u \to v$). For any upstream node $u$, its **shortage ratio** is defined as:

$$\text{shortageRatio}_u = \begin{cases} 
\text{clamp}\left(1 - \frac{\text{fulfilled}_u}{\text{demand}_u}, 0, 1\right) & \text{if } \text{demand}_u > 0 \\ 
1.0 & \text{if } \text{demand}_u = 0 \text{ and } \text{effectiveCapacity}_u = 0 \text{ and } \text{availability}_u = 0 \\ 
0.0 & \text{otherwise} 
\end{cases}$$

### 3.1 `supplies` (Material / Capacity Supply)
Upstream shortages proportionally diminish downstream effective capacity:
$$\text{factor}_e = 1 - (\text{influence}_e \times \text{shortageRatio}_u)$$
- **Interpretation:** If upstream supplier suffers a 50% shortage with influence 0.8, downstream availability factor is $1 - (0.8 \times 0.5) = 0.60$.

### 3.2 `requires` (Strict Prerequisite)
Downstream capability is constrained by prerequisite completion:
$$\text{factor}_e = 1 - (\text{influence}_e \times \text{shortageRatio}_u)$$
- **Interpretation:** Missing volunteers or registration shortfalls constrain downstream event sessions according to influence.

### 3.3 `supports` (Auxiliary Support)
Assisting resources support downstream throughput:
$$\text{factor}_e = 1 - (\text{influence}_e \times \text{shortageRatio}_u)$$
- **Interpretation:** Partial staffing or IT assistance impairs, but does not totally halt, downstream capacity.

### 3.4 `delays` (Operational Lag Propagation)
Propagates upstream delays and shortage delays along the critical path:
$$\text{edgeDelay}_e = \Big(\text{delayHours}_u + \text{basePropagationDelayHours}_e + (\text{shortageRatio}_u \times \text{shortageDelayHours}_e)\Big) \times \text{influence}_e$$
- **Interpretation:** Upstream transit delay or manufacturing lag propagates downstream without arbitrary hardcoded magic constants.

### 3.5 `increases_cost` (Cost Pressure)
Models explicit unit cost surcharges or qualitative cost escalation:
$$\text{additionalCost}_e = \text{unmetDemand}_u \times \text{additionalUnitCost}_e \times \text{influence}_e$$
- **Rule:** If $\text{additionalUnitCost}_e = 0$ or undefined, no numerical surcharge is added; the engine records an explainable qualitative cost pressure warning.

---

## 4. Multi-Dependency Aggregation Rules

When node $v$ has multiple incoming dependencies $\text{incoming}(v)$, dependencies are **not** combined arbitrarily:

### 4.1 Strict Prerequisites (`requires` & `supplies`) — Leontief Bottleneck
Strict requirements evaluate using the limiting bottleneck rule:
$$\text{bottleneckFactor}_v = \min_{e \in (\text{supplies} \cup \text{requires})} \text{factor}_e$$
*(If no supply or requirement edges exist, $\text{bottleneckFactor}_v = 1.0$)*.

### 4.2 Auxiliary Support (`supports`) — Independent Factors
Assisting resources compound multiplicatively:
$$\text{supportFactor}_v = \prod_{e \in \text{supports}} \text{factor}_e$$

### 4.3 Total Dependency Factor
$$\text{dependencyFactor}_v = \text{clamp}\left(\text{bottleneckFactor}_v \times \text{supportFactor}_v, 0, 1\right)$$

### 4.4 Delay Aggregation — Critical Path Method (CPM)
Parallel upstream operational dependencies run concurrently. Therefore, parallel incoming delays are evaluated as the maximum incoming path rather than an additive sum:
$$\text{criticalIncomingDelay}_v = \max_{e \in \text{incoming}(v)} \text{edgeDelay}_e$$
$$\text{delayHours}_v = \text{baseDelayHours}_v + \text{criticalIncomingDelay}_v$$

---

## 5. Capacity, Fulfilment & Cost Calculations

For every node $v$ processed in topological DAG order:

### 5.1 Effective Capacity
$$\text{effectiveCapacity}_v = \max\Big(0, \text{capacity}_v \times \text{availability}_v \times \text{dependencyFactor}_v\Big)$$

### 5.2 Fulfilled Quantity & Unmet Demand
$$\text{fulfilled}_v = \min\Big(\text{demand}_v, \text{effectiveCapacity}_v\Big)$$
$$\text{unmetDemand}_v = \max\Big(0, \text{demand}_v - \text{fulfilled}_v\Big)$$

### 5.3 Utilization Percentage
$$\text{utilization}_v = \begin{cases} 
\frac{\text{demand}_v}{\text{effectiveCapacity}_v} \times 100 & \text{if } \text{effectiveCapacity}_v > 0 \\ 
100\% & \text{if } \text{effectiveCapacity}_v = 0 \text{ and } \text{demand}_v > 0 \\ 
0\% & \text{if } \text{effectiveCapacity}_v = 0 \text{ and } \text{demand}_v = 0 
\end{cases}$$

### 5.4 Operating Cost
$$\text{cost}_v = \text{fixedCost}_v + \text{variableCost}_v + \sum_{e \in \text{incoming}(v)} \text{additionalCost}_e$$

where $\text{variableCost}_v$ is determined by $\text{costBasis}_v$:
- `'per_fulfilled'`: $\text{fulfilled}_v \times \text{unitCost}_v$
- `'per_demanded'`: $\text{demand}_v \times \text{unitCost}_v$
- `'per_capacity'`: $\text{capacity}_v \times \text{unitCost}_v$
- `'fixed'`: $0$

---

## 6. System-Level Health Index

The overall system health index ($0 \dots 100$) provides a standardized summary without obscuring hard constraints:

$$\text{fulfilmentRatio} = \begin{cases} \frac{\sum \text{fulfilled}}{\sum \text{demand}} & \text{if } \sum \text{demand} > 0 \\ 1.0 & \text{otherwise} \end{cases}$$

$$\text{budgetScore} = \begin{cases} 1.0 & \text{if } \text{totalCost} \le \text{budget} \\ \frac{\text{budget}}{\text{totalCost}} & \text{if } \text{budget} > 0 \\ 0.0 & \text{otherwise} \end{cases}$$

$$\text{utilScore} = \begin{cases} 1.0 & \text{if } \text{avgUtil} \le 90\% \\ \max\left(0, 1 - \frac{\text{avgUtil} - 90}{100}\right) & \text{if } \text{avgUtil} > 90\% \end{cases}$$

$$\text{overallHealth} = \text{round}\Big(\text{clamp}(0.70 \times \text{fulfilmentRatio} + 0.20 \times \text{budgetScore} + 0.10 \times \text{utilScore}, 0, 1) \times 100\Big)$$

---

## 7. Mathematical Invariants Proven by Test Suite

The simulation engine satisfies and validates the following formal mathematical invariants:

1. **Demand Monotonicity:** $\text{demand}_A \uparrow \implies \text{unmetDemand}_A \uparrow \text{ or } = \text{ (never decreases)}$.
2. **Capacity Monotonicity:** $\text{capacity}_A \uparrow \implies \text{fulfilled}_A \uparrow \text{ or } = \text{ (never decreases)}$.
3. **Cost Independence:** $\text{unitCost}_A \uparrow$ affects only $\text{cost}$, never altering $\text{effectiveCapacity}$ or $\text{fulfilled}$.
4. **Availability Monotonicity:** $\text{availability}_A \downarrow \implies \text{effectiveCapacity}_A \downarrow \text{ or } = \text{ (never improves)}$.
5. **Zero Influence Invariance:** If $\text{influence}_e = 0$, then $\text{factor}_e = 1.0$ and propagates zero impact.
6. **Independence Invariance:** Unrelated components with unchanged inputs produce bitwise identical outputs before and after simulations.
7. **Deterministic Repeatability:** $\text{simulate}(S, C) \equiv \text{simulate}(S, C)$ for any valid scenario $S$ and change queue $C$.
8. **Critical Path Delay Bounds:** For parallel incoming delays $d_1, d_2$, propagated delay equals $\max(d_1, d_2)$ (never $d_1 + d_2$).
