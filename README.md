# Viaphoton Interview Answers

**Live app:** https://viaphoton-ilia.vercel.app/

This repo bundles the three deliverables for the Viaphoton interview:

1. A working solution (and web UI) to the **Nuts Across the Desert** problem.
2. A write-up of a piece of code I'm proud of, with supporting source samples.
3. A write-up of the processes / tools / methodologies I use to build and evolve products.

---

## Question 1 — Nuts across the desert

> A pile of `N` kg of nuts sits at an oasis `D` km from town. A cart carrying at most
> `C` kg is pulled by a horse that burns `F` kg of nuts per km regardless of load.
> Compute `X`, the maximum kg of nuts that can be delivered to town.

**Code:** [src/computeX.js](src/computeX.js) — `computeX(D, N, F, C)` returns `X`; `processInput(text)` and `formatResults(results)` handle multi-line input in the exact shape the brief asks for (one output line per input line, malformed lines flagged, blanks preserved).

**Tests:** [src/computeX.test.js](src/computeX.test.js) — covers the hint case (`D·F > C`), multi-stage shuttles, decimal inputs, `F = 0`, `D = 0`, invalid inputs, and the batch parser.

**Web UI:** [src/App.jsx](src/App.jsx) with a single-run calculator and a batch textarea. Entry point [index.html](index.html) → [src/main.jsx](src/main.jsx). Styling in [src/styles.css](src/styles.css).

### Approach

With `n` kg on hand and `n > C`, the horse needs `k = ⌈n / C⌉` forward trips plus `k − 1` returns, burning `F·(2k − 1)` kg per km of forward progress. The greedy optimum travels forward just far enough to drop the remaining pile to `(k − 1)·C`, then repeats with one fewer round trip. Once `n ≤ C`, a single final dash reaches the town. See [src/computeX.js:1-48](src/computeX.js#L1-L48).

### Run it

```bash
pnpm install
pnpm test        # vitest run — verifies computeX + parser
pnpm dev         # vite dev server for the UI
pnpm build       # production build
```

---

## Question 2 — A piece of code I'm proud of

**Write-up:** [interview-proud-code.md](interview-proud-code.md) — the `SmartItem` base class from the Web 3D engine (TypeScript + Babylon.js + Valtio + Colyseus).

**Supporting source samples:**

- [code-samples/partal/smart-items/smart-item.ts](code-samples/partal/smart-items/smart-item.ts) — the base class itself.
- [code-samples/partal/character-controller/character-controller.ts](code-samples/partal/character-controller/character-controller.ts) — a peer system that shows how `SmartItem` plugs into the rest of the engine.

---

## Question 3 — Processes, tools, methodologies

**Main answer:** [building-vs-evolving-answer.md](building-vs-evolving-answer.md) — same stack, different defaults. Building from scratch optimizes for speed of learning; evolving a live product optimizes for not breaking the customers you already have.

---

## Repo layout

```
index.html                     # Vite entry
src/
  App.jsx                      # Single-run + batch UI
  computeX.js                  # computeX, processInput, formatResults
  computeX.test.js             # Vitest suite
  main.jsx, styles.css
code-samples/partal/           # Source extracts referenced by Question 2
interview-proud-code.md        # Question 2 answer
building-vs-evolving-answer.md # Question 3 answer
```
