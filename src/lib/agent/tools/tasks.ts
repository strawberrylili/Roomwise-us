import { z } from "zod";
import { structured } from "../../ai/openai";
import { config } from "../../config";
import { bump } from "../../domain/project";
import type { Task } from "../../domain/schemas";
import { defineTool } from "../types";

const TasksOut = z.object({
  tasks: z.array(
    z.object({
      key: z.string().describe("short unique key, e.g. 'order-rug'"),
      title: z.string().describe("imperative, under 60 chars"),
      detail: z.string().describe("one or two practical sentences"),
      phase: z.enum(["prep", "purchase", "setup", "style"]),
      dependsOn: z.array(z.string()).describe("keys of tasks that must happen first"),
      productId: z.string().nullable().describe("shopping-list product id this task is about, if any"),
      minutes: z.number().int().nullable(),
    }),
  ),
});

export const createTasks = defineTool({
  name: "create_tasks",
  description:
    "Generate the ordered makeover checklist from the shopping list: prep (declutter, measure), purchase, setup, styling. Code guarantees every product has a purchase task, drops invalid dependencies and orders tasks so prerequisites come first. Keeps completion state for tasks that still exist.",
  parameters: z.object({ notes: z.string().optional() }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    if (!p.shoppingList) return { ok: false, error: "Build the shopping list first." };
    const out = await structured({
      model: config.models.fast,
      schema: TasksOut,
      name: "makeover_tasks",
      effort: "low",
      system: "You are a practical makeover project manager. Order matters: clear and measure before buying, wash textiles before use, rugs go down before the bed is styled, lighting last for evaluation.",
      prompt: `ROOM: ${p.room?.summary}
RENTAL: ${p.brief?.rental}
SHOPPING LIST: ${JSON.stringify(p.shoppingList.lines.map((l) => ({ productId: l.productId, name: l.product.name, type: l.product.type, qty: l.qty, placement: l.placement, url: l.product.url })))}
${args.notes ? `NOTES: ${args.notes}` : ""}
Create 8-20 tasks. Use exactly one purchase task per shopping-list product, with its productId.`,
    });
    const tasks = normalizeTasks(out.tasks, p.shoppingList.lines, p.tasks);
    await ctx.mutate((proj) => {
      proj.tasks = tasks;
      bump(proj, "tasks");
    });
    return { ok: true, summary: `${tasks.length} tasks across ${new Set(tasks.map((t) => t.phase)).size} phases` };
  },
});

type Draft = z.infer<typeof TasksOut>["tasks"][number];

/** Deterministic cleanup: coverage, valid deps, topological order, preserved completion. */
export function normalizeTasks(drafts: Draft[], lines: { productId: string; qty: number; product: { name: string; type: string; url: string } }[], previous: Task[]): Task[] {
  const seen = new Set<string>();
  const list = drafts.filter((d) => !seen.has(d.key) && seen.add(d.key));
  const productIds = new Set(lines.map((l) => l.productId));
  for (const d of list) if (d.productId && !productIds.has(d.productId)) d.productId = null;
  for (const l of lines) {
    if (!list.some((d) => d.productId === l.productId && d.phase === "purchase")) {
      list.push({
        key: `buy-${l.productId}`,
        title: `Buy ${l.product.name}${l.qty > 1 ? ` ×${l.qty}` : ""}`,
        detail: `${l.product.type}. ${l.product.url}`,
        phase: "purchase",
        dependsOn: [],
        productId: l.productId,
        minutes: 5,
      });
    }
  }
  // Generic "buy everything" tasks are redundant once each product has its own purchase task.
  for (let i = list.length - 1; i >= 0; i--) if (list[i].phase === "purchase" && !list[i].productId) list.splice(i, 1);
  const keys = new Set(list.map((d) => d.key));
  for (const d of list) d.dependsOn = d.dependsOn.filter((k) => keys.has(k) && k !== d.key);

  // Kahn's algorithm; phase order breaks ties, cycles fall back to phase order.
  const phaseRank = { prep: 0, purchase: 1, setup: 2, style: 3 };
  const remaining = new Map(list.map((d) => [d.key, d]));
  const ordered: Draft[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((d) => d.dependsOn.every((k) => !remaining.has(k)));
    const pick = (ready.length ? ready : [...remaining.values()]).sort((a, b) => phaseRank[a.phase] - phaseRank[b.phase])[0];
    ordered.push(pick);
    remaining.delete(pick.key);
  }

  return ordered.map((d, i) => {
    const prev = previous.find((t) => t.id === `task-${d.key}` || t.title === d.title);
    return {
      id: `task-${d.key}`,
      title: d.title,
      detail: d.detail,
      phase: d.phase,
      order: i,
      dependsOn: d.dependsOn.map((k) => `task-${k}`),
      productId: d.productId,
      minutes: d.minutes,
      done: prev?.done ?? false,
      doneAt: prev?.doneAt ?? null,
    };
  });
}
