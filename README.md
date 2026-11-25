# WHATIF AI — Decision Simulation Prototype

**Explore the Consequences. Compare the Possibilities. Make Better-Informed Decisions.**

WHATIF AI is a local-first, multi-domain decision simulation prototype. It models operational components and typed dependencies, applies hypothetical changes, computes deterministic ripple effects, compares alternatives, and explains the assumptions behind its results.

## What's included

- `standalone/` — dependency-free browser prototype. It can be opened directly or served locally with Python.
- `src/` — React + Vite + TypeScript implementation source for Antigravity to extend.
- `MASTER_ANTIGRAVITY_PROMPT.md` — detailed build, test, run, package and deployment instructions.
- `docs/futuristic-glass-theme-reference.png` — selected Futuristic Glass visual reference.
- `vercel.json` — SPA rewrite configuration for Vercel.

## Fastest way to run the prototype

### Option A — dependency-free standalone demo

1. Extract the ZIP.
2. Open a terminal in the extracted `whatif-ai-prototype` folder.
3. Run one of the following:

Windows PowerShell / Command Prompt:

```powershell
py -m http.server 4173 --directory standalone
```

macOS / Linux:

```bash
python3 -m http.server 4173 --directory standalone
```

4. Open **http://localhost:4173** in your browser.

You can also double-click `standalone/index.html`, but using the local server is recommended.

### Option B — React/Vite source

Requires Node.js 20 or newer and an internet connection for the first dependency installation.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally **http://localhost:5173**.

Production build:

```bash
npm run build
npm run preview
```

## Prototype features

- Campus and event, small business, and supply-chain templates.
- User-created components and typed dependencies.
- Cycle detection before simulation.
- What-if changes to demand, capacity, availability, unit cost and delay.
- Deterministic dependency propagation and ripple-effect view.
- Capacity, fulfilment, unmet-demand, utilization, cost and budget calculations.
- Calculation traces and assumption notes.
- Optimistic, base and pessimistic stress-test scenarios.
- Baseline and alternative comparison.
- Rule-based recommendations with trade-offs.
- Browser-local history.
- JSON and Markdown report export.
- Prompt Studio that creates reusable prompt blueprints.
- Futuristic Glass visual theme.

## Important AI/API clarification

The included prototype's core simulation and advisor use deterministic TypeScript/JavaScript rules. Prompt Studio generates reusable prompt text; it does **not** execute an LLM. There is no paid API requirement and no API key is needed. The master prompt asks Antigravity to add optional browser-based local inference (for example, WebLLM or Transformers.js) only after the deterministic MVP has been tested. The local model must never calculate or override numeric simulation results.

## Model assumptions and limitations

- This is a decision-support prototype, not a forecasting system.
- Dependency influence values are configurable modelling assumptions, not probabilities unless calibrated from evidence.
- Domain templates are simplified representations.
- The initial implementation uses user-defined optimistic/base/pessimistic stress-test values, not statistically calibrated probability distributions.
- Alternative comparison identifies the best among tested options; it does not prove global optimality.
- History uses browser localStorage and does not sync between devices.
- The sample dashboard activity chart is illustrative demo data and is labelled as such.

## Vercel deployment

For the React/Vite app:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

The included `vercel.json` rewrites application routes to `index.html`.

For the dependency-free standalone prototype, deploy the `standalone/` directory as a static site or copy its contents to the root of a separate static deployment. No environment variables are required.

## Suggested first demo

1. Load the **Regional Delivery Network** template.
2. Open **What-If Simulator**.
3. Select **Primary Supplier**.
4. Select **Availability (0–1)**, operation **Set value**, and enter `0.5`.
5. Add the change and run the simulation.
6. Open **Decision Map** to inspect impacted dependencies.
7. Open **Compare Scenarios** and **Reports** to review the alternatives and assumptions.

For a clearer numerical demonstration, the React/TypeScript source also has typed dependency simulation logic. Validate all results against the model assumptions before presenting them as operational facts.
