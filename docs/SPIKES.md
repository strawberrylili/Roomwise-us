# Spike results

## 0a — Image-edit structure preservation (2026-10-30)
Input: one real bedroom photo (rental, black metal bed frame, arched floor mirror, roller blind). Brief: cozy, beige/light, more blankets. Prompt-only edit, no product references. Script: `spike/render.mjs`.

| Model | Latency | Output tokens | Notes |
| --- | --- | --- | --- |
| gpt-image-2 | 65s | 5488 | Most exact geometry; cooler mood |
| gpt-image-2.5-flare | 20s | 1372 | Warmest; mirror reflection invented |
| gpt-image-2.5-sunburst | 28s | 1372 | **User pick.** Warm and balanced, faithful reflection |

Result: pass — all three preserved architecture, kept furniture, and honored "no person in mirror".
Decision: default render model `gpt-image-2.5-sunburst` (undocumented; keep `gpt-image-2` as configurable fallback).

## 0b — Real products → LLM plan → code validation → product-referenced render (2026-10-30)
Source: IKEA US public search endpoint (`sik.search.blue.cdtapps.com`), no key needed; 125 products across 10 categories. Planner `gpt-5.5` (structured output), renderer `gpt-image-2.5-sunburst` with room photo + up to 16 product images. Script: `spike/shop.mjs`.

| Budget | Spent | Items | Plan attempts | Render |
| --- | --- | --- | --- | --- |
| $300 | $298.72 | 10 | 1 | 32s, 10 refs |
| $500 | $377.71 | 12 | 1 | 34s, 12 refs |
| $800 | $640.86 | 16 | 2 (first under-spent at $304 → validator rejected) | 36s, 16 refs |

Result: pass. Products are recognizable in renders (tufted comforter, black/beige dot cushion, faux-fur rug, globe lamp); room structure preserved. Validator-feedback retry loop works.

Gaps found (feed into the real tools):
- **Planner is blind to product appearance** — catalog text lacks pattern info, so a cat-print cushion slipped into the $800 plan. Rank step needs vision over product images.
- **No compatibility checks** — a GU10 bulb was picked for E26 lamps; bedspread/rug sizes not checked against bed/room. Needs socket/size validators.
- **Two lamps, one nightstand** — placement feasibility should be validated against the room profile.
- Under-spending is legitimate sometimes ($500 → $378); budget floor should be a soft hint, not a hard error.

## 1 — Full redesign, no budget (2026-10-31)
User feedback: product-referenced renders felt like "recolouring with decor". Spike `spike/redesign.mjs`: `gpt-5.5` (effort high) writes 2 concepts using explicit design principles (focal wall, scale, 3 light layers, 60-30-10, texture, working layout); nothing kept but architecture. Renders with `gpt-image-2.5-sunburst`:
- **B — one-step**: edit original with "replace ALL furniture; preserve architecture only" + concept.
- **C — staged**: original → empty room → furnish (original passed as architecture reference).

Result: dramatic transformations in both pipelines; architecture preserved in all 4 images (empty room is clean and faithful).
- The **designer concept + permission to replace everything** is the main lever — B and C for the same concept came out nearly identical.
- Staging enabled a **layout change** (concept 2 rotates the bed to the window wall). Untested whether one-step can do that.
- Issues: concept 2 puts the bed against the window wall where the user said a baseboard heater is; ceiling-track curtains and wall-mounted mirror need drilling (not renter-safe); "custom" headboard/rug pieces won't map to IKEA products.
