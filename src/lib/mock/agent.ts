/**
 * Deterministic orchestrator for ROOMWISE_MOCK=1. It reads real project state and drives the real
 * tools in a sensible order, so end-to-end tests exercise the loop, tools, validators, storage,
 * events and UI without calling a model. One instance per run.
 */
import type { AgentModel, ModelInput, ModelTurn, ToolCall } from "../agent/model";
import { goalCheck, isStale, latestRender, roomTypeOf, selectedDirection } from "../domain/project";
import { ROOM_RULES, ROOM_TYPES } from "../domain/rooms";
import type { Project, ProductCategory } from "../domain/schemas";
import { getStore } from "../store";

const BEDROOM: ProductCategory[] = ["bed_frame", "nightstand", "table_lamp", "bulb", "rug", "duvet_cover", "throw", "curtain", "curtain_rod"];
const want = (p: Project, extra: ProductCategory[] = []) =>
  [...new Set([...(roomTypeOf(p) === "bedroom" ? BEDROOM : ROOM_RULES[roomTypeOf(p)].categories.slice(0, 9)), ...extra])].map((category) => ({ category, query: category.replace(/_/g, " ") }));
const LABEL_TO_TYPE = Object.fromEntries(ROOM_TYPES.map((t) => [ROOM_RULES[t].label.toLowerCase(), t]));

export class MockAgentModel implements AgentModel {
  private n = 0;
  private user = "";
  private asked = false;
  private revised = false;
  private lastFailed: string | null = null;
  /** Categories added after a validator said a must-have was missing. */
  private extra: ProductCategory[] = [];

  constructor(private projectId: string) {}

  async respond({ input }: { input: ModelInput[] }): Promise<ModelTurn> {
    this.n++;
    for (const i of input) {
      if (i.kind === "message" && i.role === "user") this.user = i.text;
      if (i.kind === "tool_output") this.lastFailed = i.output.startsWith('{"ok":false') ? i.output : null;
    }
    const p = (await getStore().getProject(this.projectId))!;
    const call = this.next(p);
    return { id: `mock_${this.n}`, text: "", calls: [{ callId: `call_${this.n}`, ...call }] };
  }

  private next(p: Project): Omit<ToolCall, "callId"> {
    const c = (name: string, args: object = {}) => ({ name, args: JSON.stringify(args) });
    const answering = /\(answering: /.test(this.user);
    const isRevision = !answering && !!latestRender(p, "inspiration") && /more|change|swap|make it/i.test(this.user);

    // Adapt to a must-have rejection by adding the first suggested category, then retry.
    const mustHave = this.lastFailed?.match(/include at least one of: (\w+)/)?.[1] as ProductCategory | undefined;
    if (mustHave && !this.extra.includes(mustHave)) {
      this.extra.push(mustHave);
      this.lastFailed = null;
    }
    if (this.lastFailed && !/needsApproval/.test(this.lastFailed)) {
      // Real models adapt to errors; the mock reports honestly instead of looping.
      return c("finish", { summary: `I hit a problem I couldn't work around: ${this.lastFailed.slice(0, 160)}`, goalMet: false, remainingGaps: ["A tool failed"] });
    }
    if (!p.room) return c("analyze_room");

    const open = p.room.questions.filter((q) => !q.answer);
    if (!p.room.confirmed && open.length) {
      if (answering && !p.autopilot) {
        const said = this.user.split("\n")[0];
        const roomType = LABEL_TO_TYPE[said.toLowerCase()];
        return c("update_project", {
          room: { answers: open.map((q) => ({ questionId: q.id, answer: said })), confirmed: true },
          ...(roomType ? { brief: { roomType, functions: roomType === "living_dining" ? ["Relax", "Dine"] : [] } } : {}),
          decision: "Room details confirmed",
        });
      }
      if (p.autopilot) {
        const pick = open[0].options[0] ?? "Assumed";
        const roomType = LABEL_TO_TYPE[pick.toLowerCase()];
        return c("update_project", {
          room: { answers: open.map((q) => ({ questionId: q.id, answer: q.options[0] ?? "Assumed" })), confirmed: true },
          ...(roomType ? { brief: { roomType } } : {}),
          decision: `Autopilot assumed: ${open.map((q) => `${q.question} → ${q.options[0] ?? "assumed"}`).join("; ")}`,
        });
      }
      if (!this.asked) {
        this.asked = true;
        return c("ask_user", { kind: "clarify", question: open.map((q, i) => `${i + 1}) ${q.question}`).join(" "), options: open[0].options });
      }
    }
    if (!p.room.confirmed) return c("update_project", { room: { confirmed: true } });

    if (!p.directions.length || isStale(p, "directions")) return c("generate_design_plan", { count: 2 });
    if (!selectedDirection(p)) {
      const named = p.directions.find((d) => this.user.toLowerCase().includes(d.name.split(" — ")[0].toLowerCase()));
      if (named) return c("select_direction", { directionId: named.id, reason: "The user chose it" });
      if (p.autopilot) return c("select_direction", { directionId: p.directions[0].id, reason: "Autopilot: strongest fit for the brief" });
      if (!this.asked) {
        this.asked = true;
        return c("ask_user", { kind: "choice", question: "Which concept should I render?", options: p.directions.map((d) => d.name.split(" — ")[0]) });
      }
      return c("select_direction", { directionId: p.directions[0].id, reason: "Best fit for the brief" });
    }

    const inspo = latestRender(p, "inspiration");
    if (isRevision && !this.revised) {
      this.revised = true;
      return c("render_concept", { revisionNote: this.user });
    }
    if (!inspo || isStale(p, "inspiration")) return c("render_concept");
    if (!inspo.critique) return c("critique_render", { renderId: inspo.id });

    const have = new Set(p.catalog.map((x) => x.category));
    const WANT = want(p, this.extra);
    const missing = WANT.filter((w) => !have.has(w.category));
    if (missing.length) return c("search_products", { queries: missing });
    const dirId = p.selectedDirectionId;
    const unscored = WANT.filter((w) => !p.catalog.some((x) => x.category === w.category && x.fit?.directionId === dirId));
    if (unscored.length && (!p.shoppingList || isStale(p, "shopping"))) {
      return c("compare_products", { categories: unscored.map((w) => w.category), top: 3 });
    }
    if (!p.shoppingList || isStale(p, "shopping") || this.extra.some((x) => !p.shoppingList!.lines.some((l) => l.product.category === x)))
      return c("optimize_budget", { items: this.pick(p), strategy: "Best-fitting piece per category" });

    const shop = latestRender(p, "shoppable");
    if (!shop || isStale(p, "render")) return c("generate_room_image");
    if (!shop.critique) return c("critique_render", { renderId: shop.id });
    if (!p.tasks.length || isStale(p, "tasks")) return c("create_tasks");

    const g = goalCheck(p);
    const assumptions = p.autopilot ? p.decisions.filter((d) => /Autopilot/.test(d.text)).map((d) => d.text.replace(/^Autopilot assumed: /, "")) : [];
    return c("finish", {
      summary: `Your ${selectedDirection(p)!.name.split(" — ")[0]} plan is ready: ${p.shoppingList.lines.length} pieces, $${p.shoppingList.total} total.${assumptions.length ? ` Assumptions I made: ${assumptions.join("; ")}.` : ""}`,
      goalMet: g.met,
      remainingGaps: g.gaps,
    });
  }

  /** Highest-fit product per wanted category (cheapest when there's a budget), bedding that fits. */
  private pick(p: Project) {
    return want(p, this.extra).flatMap(({ category }) => {
      const options = p.catalog.filter((x) => x.category === category && (!x.size || /full|double/i.test(x.size)));
      const best = [...options].sort((a, b) => (p.brief?.budget ? a.price - b.price : (b.fit?.score ?? 0) - (a.fit?.score ?? 0)))[0];
      return best ? [{ productId: best.id, qty: category === "dining_chair" ? 4 : 1, placement: `Mock placement for ${category}`, why: "Fits the concept", impact: "high" as const }] : [];
    });
  }
}
