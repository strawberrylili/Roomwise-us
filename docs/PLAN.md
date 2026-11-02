# Roomwise AI — Implementation Plan (v2)

> Update: Supabase was removed from the MVP; storage is the local file store behind the `Store` interface.

Revises the approach in [SPEC.md](./SPEC.md). The product vision is unchanged; this changes the order of operations, where the agent gets autonomy, and what we build first.

## Key changes from the spec

### 1. Products before render
Spec order: concept image → product search. That produces an image full of furniture that doesn't exist and a shopping list that doesn't match it.

New order: **design direction → real products → render with product images as references.** The rendered room shows what the user can actually buy. Image/list consistency is a core quality metric.

### 2. Phases with targeted autonomy (not free-for-all tool selection)
The happy path is inherently ordered, so the project moves through explicit phases. The agent has real latitude *within and between* them:

```
intake → analyze → confirm_room → direction → source_products → budget_fit → render → review → plan_tasks
                                      ↑______________ revisions re-enter here ______________|
```

Where the agent decides:
- **Revision impact** — "make it warmer" → agent determines what's invalidated (palette? products? render?) and reruns only that. Driven by a dependency graph over project artifacts.
- **Budget recovery** — over budget → swap to alternatives, drop low-impact items, or ask the user which to cut.
- **Search recovery** — empty/poor results or dead links → broaden query, relax a non-hard constraint, try another category framing.
- **Render self-critique** — vision check of each render against the original photo and constraints (architecture preserved? kept furniture still present? rental rules respected? matches chosen products?) → regenerate with a corrected prompt, max N attempts.
- **Clarification** — low-confidence room observations become questions instead of assumptions.
- **Goal check** — before finishing a run, the agent evaluates the outcome against the brief and either iterates or reports gaps honestly.

### 3. LLM decides, code verifies
| Concern | Owner |
| --- | --- |
| Room analysis, design direction, product fit/aesthetic judgment, revision interpretation | LLM |
| Budget allocation and totals, constraint validation, dimension fit, link liveness, state persistence | Deterministic code |

Validators run after every relevant tool call; failures feed back into the loop as structured errors the agent must address.

### 4. Tools (revised)
| Tool | Kind | Notes |
| --- | --- | --- |
| `analyze_room` | LLM (vision) | Photos → `RoomProfile` with per-field confidence |
| `ask_user` | control | Clarifications + approvals; pauses the run |
| `propose_direction` | LLM | 2–3 strategies: palette, materials, priority changes, rationale |
| `search_products` | API + LLM extraction | Real listings: price, dims, image, URL, retailer |
| `rank_products` | code + LLM | Hard filters in code (budget, dims, availability), aesthetic fit by LLM |
| `fit_budget` | code | Allocation by impact/category; returns over/under + suggested cuts |
| `render_room` | image API | Original photo + product images + direction → render |
| `critique_render` | LLM (vision) | Scores render vs. original + constraints; returns fix instructions |
| `create_tasks` | LLM + code | Ordered checklist with dependencies (e.g. paint before furniture) |

Project state reads/writes are implicit in the runtime (every tool result is persisted), not agent-callable tools.

### 5. Human approval — defined
Approval required for:
- Render batches (cost) beyond the first concept per direction.
- Overwriting a design version the user marked as chosen.
- Relaxing a constraint the user stated (e.g. exceeding budget, removing kept furniture).

### 6. Infrastructure the spec implied but didn't state
- **Identity:** Supabase anonymous auth (upgradeable later) — needed for cross-session persistence.
- **Background runs:** agent runs + image generation exceed serverless request limits → runs execute as background jobs (Inngest) and stream events (tool started/finished, questions, artifacts) to the UI via Supabase Realtime.
- **Run log:** every step (tool, input, output, validator result, retry, tokens, latency) stored — powers the UI's "what the designer is doing" view and debugging.

## MVP scope

In:
- Bedroom only. Upload 1–5 photos (+ optional dimensions).
- Room analysis with confirm/correct step.
- Brief: style chips + free text + optional reference image, budget, constraints (rental, keep-list).
- Direction options → pick one.
- Real product sourcing + budget fit.
- Product-referenced render with self-critique loop.
- Conversational revisions with selective re-run.
- Shopping list, budget breakdown, ordered checklist with checkboxes.
- Persistence across sessions.

Post-MVP: progress photo review, preference learning from feedback, inspiration-board browsing, purchase tracking, multi-room.

## Evaluation
A fixed eval set of 5–10 real bedroom photos, each with a brief/budget/constraints. Every run is scored on:

1. Total within budget.
2. Hard constraints respected (rental-safe, kept furniture kept).
3. Room structure preserved in render (critic + manual spot-check).
4. Render ↔ shopping list consistency.
5. Product links live and products match stated dimensions/price.
6. Revision requests applied without unrelated changes.
7. Tool-failure recovery (inject failures: empty search, render error).

A `npm run eval` script runs the set headless and writes a report; regressions block changes to prompts/loop logic.

## Build order (derisk first)

| # | Milestone | Exit criterion |
| --- | --- | --- |
| 0 | **Image spike** — 3 bedroom photos, OpenAI image edit with product image references | Room structure visibly preserved; products recognizable. If not, rethink render strategy before building more. |
| 1 | **Product search spike** — evaluate Tavily/Serper/SerpAPI Shopping | ≥80% of results with valid price, image, live URL; pick provider |
| 2 | **Domain model** — Zod schemas for project state, artifacts, dependency graph; Supabase tables + storage | Round-trip a full project fixture |
| 3 | **Orchestrator** — phase machine, tool registry, validators, retries, iteration caps, approval pauses, run log | Full run on a fixture with mocked tools, including injected failures |
| 4 | **Real tools** — wire analyze, direction, search, rank, budget, render, critique, tasks | Eval set runs end-to-end |
| 5 | **Background runs + streaming** — Inngest + Realtime | UI receives live step events; runs survive page reload |
| 6 | **Studio UI** — Workspace, Design Studio, Shopping List, Execution Plan, AI Designer panel (vibe-ui) | Full MVP workflow usable in browser |
| 7 | **Revisions** — selective invalidation + re-run | Eval revision cases pass |
| 8 | **Eval hardening** — scoring report, prompt tuning | All eval metrics at target |

## Open decisions
- Product search provider (decided in milestone 1).
- OpenAI models: reasoning model for orchestrator; vision-capable model for analysis/critique; `gpt-image` for renders — confirm current model IDs at implementation time.
- Supabase: hosted project vs. local (needs Docker + CLI).
