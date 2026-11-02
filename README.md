# Roomwise AI

An autonomous interior-design agent for room makeovers — bedrooms, living rooms, dining areas, open living + dining spaces and bathrooms. Upload photos, describe the feeling and budget; Roomwise works out what the space is and asks what it should do, studies the room, proposes directions, finds real IKEA US products, renders your actual room with those products, checks the result, and hands you an ordered checklist.

Product spec: [docs/SPEC.md](docs/SPEC.md) · Revised plan: [docs/PLAN.md](docs/PLAN.md) · Spike results: [docs/SPIKES.md](docs/SPIKES.md)

## Run it

```bash
mise install                 # Node 22 (pinned in mise.toml)
npm install
echo "OPENAI_API_KEY=sk-..." > .env.local
npm run dev                  # http://127.0.0.1:3000 (loopback only)
```

Data is stored in `.data-us/` by default. Set `ROOMWISE_MOCK=1` to run the whole app offline: OpenAI and IKEA are replaced by deterministic mocks (`src/lib/mock/`), so you can click through every flow without spending credits. Storage sits behind the `Store` interface (`src/lib/store/types.ts`), so a database backend can be added later without touching the agent.

| Script | What it does |
| --- | --- |
| `npm test` | Unit, orchestrator and end-to-end agent journey tests — no API calls (journeys run with `ROOMWISE_MOCK=1`) |
| `npm run test:e2e` | Browser end-to-end tests (Playwright + local Chrome) against a mock-mode dev server on port 3002 |
| `npm run eval` | Runs the real agent on `eval/scenarios.json`, auto-answers its questions, applies a revision, scores the outcome → `eval/reports/` |
| `npm run eval -- --faults "search_products:1:retryable,generate_room_image:1"` | Same, with injected tool failures to test recovery |
| `npm run contrast` | WCAG contrast check of the design tokens, both themes |
| `node scripts/shot.mjs` / `scripts/ui-flow.mjs` | Headless screenshots / full UI flow via local Chrome |

## How the agent works

One orchestrator (`src/lib/agent/orchestrator.ts`) runs a tool-calling loop on the OpenAI Responses API. Each run starts from a compact **project snapshot** (room, brief, preferences, directions, list, renders, stale artifacts, goal-check gaps) plus recent conversation, so context survives across sessions without replaying transcripts.

**Tools** (`src/lib/agent/tools/`): `analyze_room`, `get_preferences`, `update_project`, `generate_design_plan`, `select_direction`, `search_products`, `compare_products`, `optimize_budget`, `generate_room_image`, `critique_render`, `create_tasks`, `ask_user`, `finish`.

**LLM decides, code verifies:**

- **Artifact graph** (`domain/project.ts`): room → brief → directions → shopping → render/tasks. Every artifact records the upstream versions it was built from; changes mark downstream work *stale*, which the agent sees and uses to redo only what a revision affects.
- **Shopping-list validator** (`domain/validators.ts`): budget, bed-size fit, bulb/lamp sockets, lamp surfaces, must-haves, avoid-list, duplicates, unknown ids. Rejections come back with cheaper same-category alternatives.
- **Goal check**: `finish(goalMet: true)` is refused while gaps exist; the agent must fix them or report them honestly.
- **Approvals** enforced in code: relaxing a user constraint needs a verbatim quote from the user's message or explicit approval; extra renders beyond 3 per request and switching away from a design the user picked need approval.
- **Recovery**: transient errors retry with backoff, any other exception gets one automatic retry; validation errors go back to the model; repeated identical failures and 3-in-a-row failures trigger a change-of-approach note; render model falls back to `gpt-image-2`; iteration cap (24).

**Autopilot** (toggle in the designer panel, saved per project): `ask_user` is refused in code, so the agent decides, records each assumption in the decision log and lists them in its summary. Constraint relaxations and approvals are still never self-granted — the agent skips those actions and says so.

**Renders** use the room photo plus product photos as references, so the image shows what's on the shopping list. `critique_render` scores structure / product fidelity / brief fit by vision; pass/fail is decided in code.

Runs execute in-process in the background and stream events over SSE (`/api/projects/:id/events`). For production, move `startRun` onto a durable queue (Inngest) — the interface stays the same.

## Models

Configured in `src/lib/config.ts`, overridable via env (`ROOMWISE_MODEL_*`): orchestrator/vision `gpt-5.5`, fast scoring `gpt-5.4-mini`, renders `gpt-image-2.5-sunburst` (undocumented; falls back to `gpt-image-2`).

## Security posture

Local, single-user: the server binds to `127.0.0.1`; identity is an anonymous http-only cookie (`src/proxy.ts`), and every API route and file checks project ownership. **This is not authentication** — before exposing it beyond localhost, add real auth and keep any database private (no public access, server-side credentials only).
