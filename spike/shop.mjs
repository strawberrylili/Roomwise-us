// Spike 0b: real products -> LLM picks per budget -> code validates -> product-referenced render.
// Usage: node --env-file=.env.local spike/shop.mjs <photo> <budget> [<budget>...]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const PLANNER_MODEL = "gpt-5.5";
const RENDER_MODEL = "gpt-image-2.5-sunburst";
const MAX_PLAN_ATTEMPTS = 3;
const OUT = "spike/out";
const UA = { "User-Agent": "Mozilla/5.0" };

const [photo, ...budgetArgs] = process.argv.slice(2);
const budgets = budgetArgs.map(Number);
if (!photo || budgets.length === 0 || budgets.some(Number.isNaN)) {
  console.error("usage: shop.mjs <photo> <budget USD> [<budget>...]");
  process.exit(1);
}

const ROOM = `Small rental bedroom (~9x10 ft). White walls, white roller blind on the right-wall window, sliding closet door on the left, wood-look vinyl floor, single recessed ceiling light (cool white).
Bed: full/double mattress on a black metal platform frame, no headboard. Black nightstand right of bed. Tall arched floor mirror leaning on left wall. Currently: plain white fitted sheet, two striped pillows, no duvet cover, no rug, no lamp.`;
const BRIEF = `Cozy. Beige or lighter colours. Wants blankets. Renting: no paint, no drilling. Keep bed frame, nightstand, mirror.`;

// Real IKEA US listings. `size` narrows bedding to the user's mattress.
const CATEGORIES = [
  { cat: "duvet_cover", q: "duvet cover", size: /full\/queen/i },
  { cat: "fitted_sheet", q: "fitted sheet", size: /full|double/i },
  { cat: "bedspread", q: "bedspread" },
  { cat: "throw", q: "throw blanket" },
  { cat: "cushion_cover", q: "cushion cover" },
  { cat: "cushion", q: "cushion" },
  { cat: "faux_fur", q: "faux sheepskin" },
  { cat: "rug", q: "rug" },
  { cat: "table_lamp", q: "table lamp" },
  { cat: "bulb", q: "LED bulb warm" },
];

async function searchIkea({ cat, q, size }) {
  const url = `https://sik.search.blue.cdtapps.com/us/en/search-result-page?q=${encodeURIComponent(q)}&size=40&types=PRODUCT`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`IKEA search ${q}: ${res.status}`);
  const items = (await res.json()).searchResultPage.products.main.items ?? [];
  return items
    .map((i) => i.product)
    .filter((p) => p?.onlineSellable && p.salesPrice?.numeral && p.mainImageUrl)
    .filter((p) => !size || size.test(p.itemMeasureReferenceText ?? ""))
    .slice(0, 14)
    .map((p) => ({
      id: p.itemNo,
      cat,
      name: p.name,
      type: p.typeName,
      colour: p.colors?.map((c) => c.name).join("/") || "",
      size: p.itemMeasureReferenceText || "",
      price: p.salesPrice.numeral,
      rating: p.ratingValue ? `${p.ratingValue} (${p.ratingCount})` : "",
      material: p.quickFacts?.map((f) => f.name).join(", ") || "",
      image: p.mainImageUrl,
      url: p.pipUrl,
    }));
}

async function loadCatalog() {
  const path = `${OUT}/catalog.json`;
  if (existsSync(path)) return JSON.parse(await readFile(path, "utf8"));
  const results = await Promise.allSettled(CATEGORIES.map(searchIkea));
  const catalog = results.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`  search failed for ${CATEGORIES[i].cat}: ${r.reason.message}`);
    return [];
  });
  await writeFile(path, JSON.stringify(catalog, null, 2));
  return catalog;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["concept", "items", "skipped_ideas"],
  properties: {
    concept: { type: "string", description: "2-3 sentence design direction" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "qty", "placement", "why"],
        properties: {
          id: { type: "string" },
          qty: { type: "integer" },
          placement: { type: "string", description: "where it goes in the room, concretely" },
          why: { type: "string" },
        },
      },
    },
    skipped_ideas: { type: "string", description: "what you'd add with more budget" },
  },
};

async function callPlanner(input) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      reasoning: { effort: "medium" },
      input,
      text: { format: { type: "json_schema", name: "bedroom_plan", schema: PLAN_SCHEMA, strict: true } },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`planner ${res.status}: ${body.error?.message}`);
  const text = body.output.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text;
  return JSON.parse(text);
}

// Deterministic checks the LLM must satisfy; failures are fed back as the next turn.
function validate(plan, catalog, budget) {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const errors = [];
  const lines = [];
  for (const it of plan.items) {
    const p = byId.get(it.id);
    if (!p) errors.push(`id ${it.id} is not in the catalog`);
    else if (it.qty < 1) errors.push(`qty for ${it.id} must be >= 1`);
    else lines.push({ ...p, qty: it.qty, placement: it.placement, why: it.why });
  }
  const total = +lines.reduce((s, l) => s + l.price * l.qty, 0).toFixed(2);
  if (total > budget) errors.push(`total $${total} exceeds budget $${budget} by $${(total - budget).toFixed(2)}`);
  if (total < budget * 0.6) errors.push(`total $${total} uses under 60% of the $${budget} budget; add impactful items`);
  const cats = new Set(lines.map((l) => l.cat));
  if (!["throw", "bedspread", "faux_fur"].some((c) => cats.has(c))) errors.push("user explicitly wants blankets; include at least one throw/bedspread/faux fur");
  return { errors, lines, total };
}

async function plan(catalog, budget) {
  const compact = catalog.map(({ image, url, ...rest }) => rest);
  const input = [
    {
      role: "system",
      content: "You are an interior designer selecting real products for a bedroom makeover. Only use catalog ids. Prices are USD before tax. Favour visual impact per dollar; coordinate colours and textures into one cohesive look.",
    },
    {
      role: "user",
      content: `ROOM:\n${ROOM}\n\nBRIEF:\n${BRIEF}\n\nBUDGET: $${budget} USD (pre-tax)\n\nCATALOG:\n${JSON.stringify(compact)}`,
    },
  ];
  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    const draft = await callPlanner(input);
    const check = validate(draft, catalog, budget);
    console.log(`  [$${budget}] plan attempt ${attempt}: $${check.total}, ${check.lines.length} items, ${check.errors.length} errors`);
    if (check.errors.length === 0) return { ...draft, ...check, attempts: attempt };
    input.push({ role: "assistant", content: JSON.stringify(draft) });
    input.push({ role: "user", content: `Validation failed:\n- ${check.errors.join("\n- ")}\nRevise the plan.` });
  }
  throw new Error(`[$${budget}] no valid plan after ${MAX_PLAN_ATTEMPTS} attempts`);
}

async function render(roomImage, result, budget) {
  const form = new FormData();
  form.append("model", RENDER_MODEL);
  form.append("image[]", roomImage, basename(photo));
  const refs = [];
  for (const [i, l] of result.lines.entries()) {
    const res = await fetch(l.image, { headers: UA });
    if (!res.ok) continue; // a missing reference shouldn't sink the render
    form.append("image[]", new Blob([await res.arrayBuffer()], { type: "image/jpeg" }), `ref${i}.jpg`);
    refs.push(`Image ${refs.length + 2}: ${l.type} "${l.name}" (${l.colour}) x${l.qty} — place: ${l.placement}`);
  }
  form.append(
    "prompt",
    `Image 1 is the user's real bedroom. Edit Image 1 only — same camera, framing, architecture (walls, ceiling, recessed light, closet door, window + white roller blind, floor), the black metal bed frame, black nightstand, arched floor mirror (reflection shows the room only, no person), and the teddy bear on the bed.

Add these exact real products, matching each reference image's colour, pattern, texture and shape as closely as possible:
${refs.join("\n")}

Design direction: ${result.concept}
Remove floor clutter. Warm, cozy evening light. Photorealistic phone-camera photo.`,
  );
  form.append("size", "1024x1536");
  form.append("quality", "high");
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`render ${res.status}: ${body.error?.message}`);
  const out = `${OUT}/shop-${budget}.png`;
  await writeFile(out, Buffer.from(body.data[0].b64_json, "base64"));
  console.log(`  [$${budget}] render ok in ${((Date.now() - t0) / 1000).toFixed(1)}s with ${refs.length} product refs -> ${out}`);
}

await mkdir(OUT, { recursive: true });
const catalog = await loadCatalog();
console.log(`catalog: ${catalog.length} real IKEA US products across ${new Set(catalog.map((p) => p.cat)).size} categories`);
const roomImage = new Blob([await readFile(photo)], { type: "image/jpeg" });

await Promise.all(
  budgets.map(async (budget) => {
    try {
      const result = await plan(catalog, budget);
      await writeFile(`${OUT}/shop-${budget}.json`, JSON.stringify(result, null, 2));
      await render(roomImage, result, budget);
    } catch (e) {
      console.error(`  [$${budget}] FAILED: ${e.message}`);
    }
  }),
);
