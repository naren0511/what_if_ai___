# MASTER ANTIGRAVITY PROMPT — WHATIF AI

You are acting as the complete product engineering team for **WHATIF AI**: product architect, senior frontend engineer, simulation/algorithm engineer, backend/API integration engineer where applicable, QA engineer, UI designer and deployment engineer.

Your job is to turn the current workspace into a complete, polished, functional and locally runnable hackathon prototype. Do not stop at a plan, scaffold, screenshot or non-functional UI. Inspect the existing files first, preserve working functionality, then implement, run, test, fix and package the application.

## 0. Non-negotiable delivery requirements

1. Deliver a working prototype, not a mockup.
2. Start the local development server and provide the exact local URL reported by the running process. For the Vite application this is normally `http://localhost:5173/`. Keep the server running after starting it.
3. Create a ZIP of the complete source project named `whatif-ai-prototype.zip` in the project root or a clearly identified `release/` folder. Exclude `node_modules`, `.git`, temporary files, build caches and secrets. Include the README, source, tests, configuration, and design reference.
4. Run the production build and the available tests. Do not claim success unless commands actually pass.
5. Do not fabricate a deployment URL, API connection, test result, AI response, or feature that has not been implemented and verified.
6. Do not request or introduce paid API keys. Core simulation must work without internet, a backend service, or a third-party inference API.
7. The user will deploy to Vercel. Prepare and verify the Vercel-ready production build and configuration; do not claim a Vercel deployment unless one is actually performed and verified.
8. Keep implementation within a realistic seven-hour solo hackathon scope. Prioritize a polished working vertical slice over excessive features.

## 1. Product definition

**Product:** WHATIF AI

**Title:** An Intelligent Multi-Domain Decision Simulation, Ripple Effect Analysis and AI-Powered Decision Intelligence Platform

**Tagline:** Explore the Consequences. Compare the Possibilities. Make Better-Informed Decisions.

WHATIF AI helps individuals and organizations explore how hypothetical decisions and disruptions may affect interconnected operational systems. It represents an operation as components (nodes), directed typed dependencies (edges), capacities, demand, availability, costs, delays and constraints. A user changes one or more variables; a deterministic engine recalculates the system; a ripple engine identifies downstream effects; alternative strategies are compared; and the application explains its assumptions and trade-offs.

The product is a decision-support simulator. It is **not** a guaranteed future predictor, autonomous decision maker, or scientifically validated operational forecasting system.

## 2. Architecture principles

### Simulation-first, AI-assisted

- Deterministic TypeScript calculations are the source of truth for all numerical outcomes.
- A language model must never invent, calculate, or override capacity, fulfilment, unmet demand, cost, budget, utilization, or delay figures.
- Recommendations must be traceable to calculated findings and explicit assumptions.
- Dependency influence values are user-configurable modelling assumptions, not probabilities unless calibrated with evidence.
- Same inputs must produce the same outputs.

### Backend and API decisions

The core product is intentionally client-side. It does not require a conventional backend, database server, authentication service or remote API to simulate scenarios. Do not create needless backend infrastructure merely to claim that the product is full stack.

Act as backend/API engineer as well: inspect each requested capability and implement an API/service abstraction only where genuinely needed. The initial persistence layer is browser-local storage. Optional local model inference runs in the browser. No secrets or paid API keys are required. Clearly document this architecture decision.

If a local LLM is integrated, isolate it behind an `AIProvider` interface and validate all model output with a schema before use. The app must work when the provider is unavailable.

## 3. Existing project and workspace inspection

1. Inspect the entire workspace and read `README.md`, `src/`, `standalone/`, and `MASTER_ANTIGRAVITY_PROMPT.md` if present.
2. Preserve the selected visual direction and all working prototype features.
3. Use `docs/futuristic-glass-theme-reference.png` as the primary UI reference if available.
4. Identify incomplete or duplicated implementations before changing files.
5. Do not overwrite user files unrelated to this application.

## 4. Required technology stack

- React + Vite + TypeScript.
- Tailwind CSS or the existing CSS system; do not rewrite working styles without reason.
- Lucide React icons.
- React Flow (`@xyflow/react`) for the interactive dependency map.
- Recharts for analytics and scenario comparisons.
- Zod for input and structured-output validation.
- React Context or Zustand for state management if needed.
- localStorage for local persistence.
- Optional WebLLM or Transformers.js adapter for local in-browser LLM inference.
- Vercel static hosting configuration.

Use the dependency versions already in `package.json` when compatible. Avoid adding large libraries unless needed.

## 5. Visual design — Futuristic Glass theme

Apply the selected **Futuristic Glass** design consistently to every screen. This selection replaces the earlier Aurora-only design direction.

Design properties:
- Deep midnight navy base background.
- Translucent glass cards and panels with subtle blur.
- Electric blue, cyan, violet and purple accent gradients.
- Soft glowing borders, subtle depth and restrained neon highlights.
- High-contrast readable typography.
- Clean spacing, rounded cards, clear visual hierarchy.
- Responsive desktop, tablet and mobile layouts.
- Avoid excessive glow, unreadable text, or decorative visual clutter.

Keep navigation and visual language consistent across Dashboard, Scenario Builder, What-If Simulator, Decision Map, Compare Scenarios, Reports, History and Prompt Studio.

Design reference: `docs/futuristic-glass-theme-reference.png`.

## 6. Universal scenario data model

Use a common scenario structure for every domain. Validate it with Zod.

A scenario contains:
- id, name, domain, description, budget.
- nodes/components.
- typed directed edges/dependencies.
- created/updated timestamps.

Each node should support:
- id, name, type, description.
- demand (non-negative number).
- capacity (non-negative number).
- availability (0 to 1).
- unitCost (non-negative number).
- baseDelayHours (non-negative number).
- priority: low, medium, high.
- optional domain-specific metadata.

Each edge should support:
- id, source node id, target node id.
- type: `supplies`, `requires`, `supports`, `delays`, or `increases_cost`.
- influence between 0 and 1.

Changes should support:
- target node id.
- variable: demand, capacity, availability, unitCost or baseDelayHours.
- operation: set, add or multiply.
- non-negative value with availability clamped between 0 and 1.
- human-readable label.

## 7. Required domain templates

Implement three functioning templates using the same simulation engine.

### A. Campus and Event Operations

Components may include registration, participants, volunteers, venue, equipment and event experience. Model attendance changes, volunteer shortages, venue capacity reductions and resource unavailability.

### B. Small Business Operations

Components may include supplier, inventory, staff, orders and customer fulfilment. Model demand surges, stock shortages, staff absences, supplier delays and unit-cost changes.

### C. Supply Chain and Logistics

Components may include primary supplier, warehouse, transport fleet and customer fulfilment. Model supplier capacity reduction, warehouse constraints, transport delays and demand changes.

Also implement a controlled custom scenario builder allowing users to add/remove nodes and directed dependencies, edit scenario title/description/budget, and save their model locally.

Do not claim all industries are universally supported. The initial implementation supports these three templates and custom models within the supplied variable and dependency types.

## 8. Simulation engine requirements

Implement simulation as pure, testable TypeScript functions independent of React components.

### Graph validation

- Validate that every edge references existing nodes.
- Reject self-loops unless explicitly supported.
- Detect directed cycles using DFS or Kahn's algorithm.
- Display the involved node ids/names and block simulation when a cycle exists.
- Calculate a topological processing order for valid DAGs.

### Typed dependency propagation

Do not use one generic multiplication rule for all dependency types.

Implement explicit behaviour for:
- `supplies`: upstream shortage reduces downstream supply availability/capacity according to edge influence.
- `requires`: upstream shortage reduces downstream capability according to edge influence.
- `supports`: upstream shortage reduces supported downstream capacity according to edge influence.
- `delays`: upstream delay and shortage propagate a configured downstream delay effect.
- `increases_cost`: represent cost pressure transparently; if the initial MVP cannot model a surcharge without an explicit parameter, display it as a qualitative warning and do not silently add arbitrary cost.

For each node, calculate:
- availability-adjusted capacity.
- dependency-adjusted effective capacity.
- fulfilled demand = min(demand, effective capacity).
- unmet demand = max(0, demand - fulfilled).
- utilization with safe handling of zero capacity.
- estimated cost using explicitly documented unit-cost semantics.
- propagated delay.
- direct impact and downstream affected status.
- calculation trace and upstream edge explanations.

Avoid double-counting or misleading aggregate metrics. If nodes represent different units or process stages, explain that aggregate demand/cost is a model-level sum and should be interpreted by domain. Prefer domain-level metrics where practical.

### Assumption transparency

Every important result should expose:
- original and changed input values.
- formula and intermediate values.
- dependency type and influence.
- relevant source node/edge ids.
- all modelling assumptions.
- short human-readable explanation.

### Scenario changes

Always clone the baseline scenario before applying a change. Never mutate the original saved scenario when simulating a disruption.

## 9. Uncertainty and sensitivity

Implement transparent, deterministic stress-test variants:
- Optimistic.
- Base.
- Pessimistic.

Allow users to specify input multipliers or explicit alternative values. Run each variant independently through the same engine. Label these as user-defined scenario ranges, not probabilities or a statistically calibrated forecast.

Implement sensitivity analysis for selected inputs and dependency weights. Show the effect on one or more selected outcomes and identify high-sensitivity assumptions. Do not claim statistical significance.

## 10. Alternative decision evaluation

Generate editable intervention options, such as:
- activate backup supplier.
- add capacity buffer.
- increase inventory buffer.
- reduce demand temporarily.
- adjust delivery arrangements.

For each option:
1. Clone the same baseline scenario.
2. Apply only that option's explicit parameter changes.
3. Run the same deterministic simulation.
4. Evaluate configured hard constraints (budget, capacity, availability, delivery deadline where modelled).
5. Compare fulfilled demand, unmet demand, cost, budget variance, delays, bottlenecks and health score.

Use a transparent weighted score only as a ranking aid. Expose its component weights. A high score must not mask a hard constraint violation. Label the winner as `best among tested alternatives`, not globally optimal.

## 11. Decision Intelligence Advisor

Implement traceable rules that respond to real simulation outcomes. Examples:
- unmet demand -> inspect relevant bottlenecks and test capacity increase or demand reduction.
- budget exceeded -> review unit cost or sourcing alternatives.
- high utilization -> examine buffer capacity.
- upstream disruption affects multiple downstream nodes -> prioritize the shared upstream bottleneck.
- unsupported assumptions -> request user confirmation.

Each recommendation must contain:
- problem detected.
- evidence from actual calculated results.
- proposed action.
- trade-off.
- assumption or missing data.

Do not generate generic recommendations unrelated to the current simulation.

## 12. Optional local Generative AI integration

This is optional and must not endanger the working MVP.

If time and compatible hardware allow, implement a browser-based local model provider using WebLLM or Transformers.js. Keep the provider behind a clean interface such as:
- `isSupported()`
- `initialize(onProgress)`
- `interpretScenario(text, scenarioSchema)`
- `generateStrategies(context)`
- `explainResult(context)`

Requirements:
- no paid API keys.
- no remote inference provider.
- first-time model download progress and clear notice.
- model status and compatibility check.
- handle unsupported WebGPU, download failures, timeouts, malformed JSON and memory errors.
- validate model output using Zod.
- require user confirmation before proposed changes are applied.
- never allow the LLM to calculate or overwrite simulation metrics.
- preserve complete deterministic fallback when model initialization fails.
- clearly distinguish actual local model output from rule-based output and prompt templates.

Do not label prompt templates or rule-based text as Generative AI. If local LLM integration cannot be completed and tested, ship the deterministic product and describe local AI integration as a future/optional capability.

## 13. Prompt Studio / PromptWars demonstration

Implement a Prompt Studio with clearly labelled templates:
- zero-shot scenario analyst.
- role-based operations analyst.
- context + constraints + structured-output prompt.

Each prompt should include the relevant scenario facts, explicit constraints, output schema and a no-invented-data instruction. Allow copying and exporting the prompt text.

If an actual local LLM is available, allow users to run the same task with each prompt and compare the actual outputs using deterministic checks (schema validity, unsupported claims, required-field coverage, preservation of supplied values). If no LLM is available, display prompt blueprints only and explicitly state that they have not been executed.

Do not display chain-of-thought or request hidden reasoning. Display concise rationales and evidence.

## 14. Required application screens

### Dashboard
- active scenario and domain.
- number of components and dependencies.
- baseline metrics calculated from current scenario.
- recent saved runs.
- templates and quick actions.
- clearly labelled sample/demo activity chart if it contains illustrative data.

### Scenario Builder
- edit title, description and budget.
- list/edit/remove components.
- add a component with validated properties.
- list/add/remove typed dependencies.
- configure influence values.
- graph validation and cycle warnings.
- save and reload scenarios.

### What-If Simulator
- select component, variable, operation and value.
- queue multiple changes.
- run/reset simulation.
- display before/after KPI cards and node table.
- display affected components and warnings.
- expandable calculation traces.
- optimistic/base/pessimistic test controls.

### Decision Map
- React Flow graph showing nodes and typed edges.
- fit view, zoom and pan.
- distinct node states: normal, directly changed, downstream impacted, bottleneck.
- highlight impacted paths after simulation.
- legend and dependency influence information.

### Compare Scenarios
- baseline and alternatives.
- same engine and constraints for each alternative.
- comparison table and charts.
- hard constraint warnings.
- clearly stated scoring assumptions.

### Reports
- summary, affected nodes, calculation traces, recommendations, constraints and assumptions.
- JSON export and readable Markdown export.

### History
- save/load/delete prior scenarios and runs in localStorage.
- show timestamp and result summary.
- handle corrupted or old local storage safely.

### Prompt Studio
- structured prompt templates.
- current scenario context preview.
- copy/export prompt.
- if a local LLM exists, prompt-run comparisons with real outputs and observable evaluation checks.

## 15. Persistence and data handling

- Use localStorage for scenario definitions and saved runs.
- Add schema/version handling and safe parsing.
- Avoid storing secrets.
- Explain that local data belongs to the current browser/device and is not synchronized.
- Provide JSON export/import if feasible within the deadline.

## 16. Testing requirements

Create automated unit tests for the simulation engine and graph validation. At minimum test:
1. normal baseline scenario.
2. demand greater than capacity.
3. availability reduction.
4. supply dependency shortage propagation.
5. requires/supports dependency propagation.
6. delay propagation.
7. increases-cost relationship handling and no fabricated surcharge.
8. independent node with no incoming edges.
9. zero capacity and zero demand edge cases.
10. invalid edge references.
11. circular graph rejection.
12. deterministic repeatability.
13. change application does not mutate the baseline.
14. optimistic/base/pessimistic variants.
15. alternative comparison and hard constraint warnings.
16. history save/load/delete.
17. report exports.
18. invalid/malformed local model output if local AI is integrated.

Use the sample supplier calculation as a known check: supplier capacity 200, demand 200, availability 50%, supplier-to-warehouse edge influence 0.8, warehouse capacity 200 and demand 200. Supplier fulfilment ratio is 0.5, edge factor is `1 - 0.8 * (1 - 0.5) = 0.6`, and warehouse effective capacity is 120 under this simplified rule. Keep this test aligned with the implemented typed-edge semantics.

Run all tests and production build. Fix failures. Do not state tests passed unless they were actually run.

## 17. Local run and localhost link

- Ensure `npm install` succeeds.
- Ensure `npm run dev -- --host 0.0.0.0` starts cleanly.
- Start the development server and keep it running.
- Provide the exact URL printed by Vite, normally `http://localhost:5173/`.
- If that port is busy, use the actual Vite-assigned port and provide that URL.
- Verify the page loads and that core actions work.
- Provide a fallback command to run the dependency-free `standalone/` demo with Python if dependencies or the dev server cannot be installed.

## 18. Production build and Vercel preparation

- Run `npm run build`.
- Run the preview server and smoke-test the built app.
- Confirm the output directory is `dist`.
- Add/verify `vercel.json` SPA rewrite configuration.
- No environment variables should be required for the core app.
- If local model assets are used, ensure paths and worker files work in production; avoid shipping unnecessarily large model weights with the app.
- Provide Vercel settings: framework Vite, build `npm run build`, output `dist`, install `npm install`.
- The user will carry out Vercel deployment. Do not invent a live production URL.

## 19. Create the source ZIP

Create `release/whatif-ai-prototype.zip` (or `whatif-ai-prototype.zip` at the project root). Include:
- `src/`, `standalone/`, `public/`, `docs/`, tests, package files, `README.md`, this master prompt, `vite.config.ts`, `tsconfig.json`, `vercel.json` and scripts.

Exclude:
- `node_modules/`
- `.git/`
- `dist/` unless explicitly requested as a separate production bundle.
- `.env`, secrets, API keys, cache and log files.

Use Python `zipfile`, PowerShell `Compress-Archive`, or an installed ZIP tool. Verify the archive exists and can be listed/opened after creation. Report the actual ZIP path.

## 20. Seven-hour execution order

1. Inspect workspace and run the existing app.
2. Verify/fix deterministic model, graph validation and tests.
3. Finish dashboard and scenario builder.
4. Finish simulator, ripple analysis and trace view.
5. Finish React Flow decision map and scenario comparison.
6. Finish reports, local history and prompt studio.
7. Add optional local LLM only if core features, test suite and build are already stable.
8. Polish responsive layout and accessibility.
9. Run tests and production build.
10. Start local dev server, verify localhost URL, create and verify ZIP.

If time runs short, preserve the working deterministic simulation, ripple map, assumption traces, comparison and export. Do not sacrifice a functioning application for decorative features or an unverified LLM integration.

## 21. Final response format

When done, provide:
- concise summary of implemented features.
- exact localhost URL and confirmation that the server is still running.
- commands to restart locally.
- test command and actual test outcome.
- production build outcome.
- exact ZIP file location.
- Vercel build/output settings.
- honest list of anything not completed or not verified.

Begin now. Inspect the existing workspace, then implement and verify the application end to end.
