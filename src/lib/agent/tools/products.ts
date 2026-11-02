import { z } from "zod";
import { structured } from "../../ai/openai";
import { searchIkea } from "../../catalog/ikea";
import { config } from "../../config";
import { bump, roomTypeOf, selectedDirection } from "../../domain/project";
import { ProductCategory, ShoppingItem, type Product } from "../../domain/schemas";
import { matchesBedSize, validateShoppingList } from "../../domain/validators";
import { errorMessage, now } from "../../util";
import { defineTool, RetryableError } from "../types";

const CATALOG_CAP = 400;

export const searchProducts = defineTool({
  name: "search_products",
  description:
    "Search real retail products (IKEA US, live prices in USD) and add them to the project catalog. One query per category; use plain retail terms ('throw blanket', 'high pile rug', 'linen duvet cover'). Returns counts and samples; empty results mean you should broaden or rephrase.",
  parameters: z.object({
    queries: z.array(z.object({ category: ProductCategory, query: z.string() })).min(1).max(10),
  }),
  mutates: true,
  async execute(ctx, args) {
    const results = await Promise.allSettled(args.queries.map((q) => searchIkea(q.query, q.category)));
    const found: Product[] = [];
    const report = results.map((r, i) => {
      const q = args.queries[i];
      if (r.status === "rejected") return { ...q, ok: false, error: errorMessage(r.reason) };
      found.push(...r.value);
      const prices = r.value.map((p) => p.price);
      return {
        ...q,
        ok: true,
        count: r.value.length,
        priceRange: prices.length ? [Math.min(...prices), Math.max(...prices)] : null,
        sample: r.value.slice(0, 6).map((p) => ({ id: p.id, name: p.name, type: p.type, colour: p.colour, size: p.size, price: p.price })),
        hint: r.value.length === 0 ? "No results — try a broader or different term." : undefined,
      };
    });
    if (results.every((r) => r.status === "rejected")) {
      throw new RetryableError(`All product searches failed: ${report.map((r) => ("error" in r ? r.error : "")).join("; ")}`);
    }
    let added = 0;
    await ctx.mutate((proj) => {
      const byId = new Map(proj.catalog.map((p) => [p.id, p]));
      for (const p of found) {
        const existing = byId.get(p.id);
        if (!existing) added++;
        // Fresh price/availability, but keep any fit score already computed.
        byId.set(p.id, { ...p, fit: existing?.fit ?? null });
      }
      proj.catalog = [...byId.values()].slice(-CATALOG_CAP);
    });
    return { ok: true, summary: `${found.length} products found (${added} new) across ${args.queries.length} queries`, data: report };
  },
});

const FitScores = z.object({
  scores: z.array(z.object({ id: z.string(), score: z.number().describe("0-10 fit"), reason: z.string().describe("max 15 words") })),
});

export const compareProducts = defineTool({
  name: "compare_products",
  description:
    "Rank catalog products for the selected design direction, for one or more categories at once (scored in parallel). Hard filters run in code (bed-size fit for bedding, price within budget); aesthetic fit is scored by looking at the actual product photos (catches patterns/colours that names hide). Returns a ranked shortlist per category.",
  parameters: z.object({ categories: z.array(ProductCategory).min(1).max(10), top: z.number().int().min(1).max(10).default(5) }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const dir = selectedDirection(p);
    if (!dir) return { ok: false, error: "Select a design direction first." };
    if (!p.brief) return { ok: false, error: "No brief yet." };
    const brief = p.brief;

    const perCategory = args.categories.map((category) => {
      const inCat = p.catalog.filter((x) => x.category === category);
      const excluded: string[] = [];
      const candidates = inCat.filter((x) => {
        if (brief.budget !== null && x.price > brief.budget) return excluded.push(`${x.name}: over total budget`), false;
        if (["duvet_cover", "fitted_sheet", "bedspread"].includes(x.category) && p.room && matchesBedSize(x, p.room.bedSize) === false)
          return excluded.push(`${x.name}: wrong bed size (${x.size})`), false;
        return true;
      });
      return { category, inCat: inCat.length, candidates, excluded };
    });

    const scored = await Promise.allSettled(
      perCategory.map(async ({ candidates }) => {
        const toScore = candidates.filter((x) => x.fit?.directionId !== dir.id).slice(0, 16);
        if (!toScore.length) return [];
        const out = await structured({
          model: config.models.fast,
          schema: FitScores,
          name: "product_fit",
          effort: "low",
          detail: "low",
          images: toScore.map((x) => ({ url: x.image })),
          system: "You are an interior designer judging whether products fit a design direction. Judge from the photos — colour, pattern, texture, shape — not just names.",
          prompt: `Direction: ${dir.name} — ${dir.summary}. Palette: ${dir.palette.map((c) => `${c.name} ${c.hex}`).join(", ")}. Materials: ${dir.materials.join(", ")}.
Client avoids: ${brief.avoid.join(", ") || "nothing stated"}.
Score each product 0-10 for fit. Images are in this order:
${toScore.map((x, i) => `${i + 1}. id=${x.id} ${x.name} — ${x.type}, ${x.colour}, $${x.price}`).join("\n")}`,
        });
        return out.scores;
      }),
    );
    await ctx.mutate((proj) => {
      for (const r of scored) {
        if (r.status !== "fulfilled") continue;
        for (const s of r.value) {
          const prod = proj.catalog.find((x) => x.id === s.id);
          if (prod) prod.fit = { score: s.score, reason: s.reason, directionId: dir.id };
        }
      }
    });

    const fresh = new Map((await ctx.get()).catalog.map((x) => [x.id, x]));
    const results = perCategory.map(({ category, inCat, candidates, excluded }, i) => {
      if (inCat === 0) return { category, error: "No products in catalog — call search_products for this category." };
      if (candidates.length === 0) return { category, error: `All ${inCat} products failed hard filters`, excluded };
      const failed = scored[i].status === "rejected" ? `Scoring failed: ${errorMessage((scored[i] as PromiseRejectedResult).reason)}` : undefined;
      const ranked = candidates
        .map((c) => fresh.get(c.id)!)
        .filter((x) => x.fit?.directionId === dir.id)
        .sort((a, b) => b.fit!.score - a.fit!.score || a.price - b.price)
        .slice(0, args.top)
        .map((x) => ({ id: x.id, name: x.name, type: x.type, colour: x.colour, size: x.size, price: x.price, rating: x.rating, fit: x.fit!.score, why: x.fit!.reason }));
      return { category, ranked, excluded: excluded.slice(0, 5), error: failed };
    });
    const okCount = results.filter((r) => "ranked" in r && r.ranked && r.ranked.length).length;
    if (okCount === 0) {
      const transient = scored.some((r) => r.status === "rejected");
      if (transient) throw new RetryableError(`Product scoring failed for all categories`);
      return { ok: false, error: "No rankable products in these categories", data: results };
    }
    return {
      ok: true,
      summary: `Ranked ${okCount}/${args.categories.length} categories: ${results.map((r) => ("ranked" in r && r.ranked?.[0] ? `${r.category}→${r.ranked[0].name} ${r.ranked[0].fit}/10` : `${r.category}→none`)).join(", ")}`,
      data: results,
    };
  },
});

export const optimizeBudget = defineTool({
  name: "optimize_budget",
  description:
    "Propose the shopping list (catalog product ids + qty + placement + impact) — the closest real products to the selected concept's pieces. Code validates it: budget, bed-size fit, bulb/lamp compatibility, lamp surfaces, must-haves, avoid-list. If invalid you get errors and cheaper alternatives — revise and call again. If valid it is saved with a category breakdown.",
  parameters: z.object({
    items: z.array(ShoppingItem).min(1).max(25),
    strategy: z.string().describe("one line: how the budget is being spent and why"),
  }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const dir = selectedDirection(p);
    if (!dir) return { ok: false, error: "Select a design direction first." };
    if (!p.brief) return { ok: false, error: "No brief yet." };
    const v = validateShoppingList(args.items, p.catalog, p.brief, p.room, roomTypeOf(p));
    await ctx.emit({
      type: "validator",
      tool: "optimize_budget",
      ok: v.errors.length === 0,
      summary: v.errors.length ? `${v.errors.length} problem(s): ${v.errors[0]}` : `Valid: $${v.total}${p.brief.budget ? ` of $${p.brief.budget}` : ""}`,
      data: { errors: v.errors, warnings: v.warnings },
    });
    if (v.errors.length) {
      return { ok: false, error: `Shopping list rejected:\n- ${v.errors.join("\n- ")}`, data: { total: v.total, budget: p.brief.budget, alternatives: v.alternatives, warnings: v.warnings } };
    }
    await ctx.mutate((proj) => {
      proj.shoppingList = { directionId: dir.id, lines: v.lines, total: v.total, budget: proj.brief!.budget, breakdown: v.breakdown, warnings: v.warnings, createdAt: now() };
      bump(proj, "shopping");
    });
    return { ok: true, summary: `Shopping list saved: ${v.lines.length} items, $${v.total}${p.brief.budget ? ` of $${p.brief.budget}` : " (no budget limit)"}`, data: { breakdown: v.breakdown, warnings: v.warnings, strategy: args.strategy } };
  },
});
