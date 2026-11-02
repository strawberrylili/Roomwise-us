import { describe, expect, it } from "vitest";
import { bump, createProject, goalCheck, isStale, staleArtifacts } from "../src/lib/domain/project";
import { normalizeTasks } from "../src/lib/agent/tools/tasks";
import { brief, room } from "./fixtures";

function builtProject() {
  const p = createProject("u", "Bedroom");
  p.room = room();
  bump(p, "room");
  p.brief = brief();
  bump(p, "brief");
  p.directions = [{ id: "d1", name: "Linen", summary: "", palette: [], materials: [], moves: [], rationale: "", estimatedCost: 250, layout: "", layoutChange: false, focalPoint: "", pieces: [], lighting: "", walls: "", styling: "", renderPrompt: "" }];
  p.selectedDirectionId = "d1";
  bump(p, "directions");
  p.shoppingList = { directionId: "d1", lines: [], total: 250, budget: 300, breakdown: [], warnings: [], createdAt: "" };
  bump(p, "shopping");
  p.renders = [{ id: "i1", kind: "inspiration", directionId: "d1", photoId: "ph", path: "x", model: "m", prompt: "", revisionNote: null, productIds: [], critique: { structure: 9, productFidelity: null, designQuality: 9, briefFit: 9, issues: [], fixInstructions: "", pass: true }, createdAt: "" }, { id: "r1", kind: "shoppable", directionId: "d1", photoId: "ph", path: "x", model: "m", prompt: "", revisionNote: null, productIds: [], critique: { structure: 9, productFidelity: 8, designQuality: null, briefFit: 9, issues: [], fixInstructions: "", pass: true }, createdAt: "" }];
  bump(p, "inspiration");
  bump(p, "render");
  p.tasks = [{ id: "t", title: "t", detail: "", phase: "prep", order: 0, dependsOn: [], productId: null, minutes: null, done: false, doneAt: null }];
  bump(p, "tasks");
  return p;
}

describe("artifact staleness", () => {
  it("nothing is stale right after a full build", () => {
    expect(staleArtifacts(builtProject())).toEqual([]);
  });

  it("changing the brief invalidates everything downstream, transitively", () => {
    const p = builtProject();
    p.brief!.budget = 200;
    bump(p, "brief");
    expect(staleArtifacts(p)).toEqual(["directions", "inspiration", "shopping", "render", "tasks"]);
  });

  it("rebuilding the shopping list only leaves render + tasks stale", () => {
    const p = builtProject();
    bump(p, "shopping");
    expect(isStale(p, "shopping")).toBe(false);
    expect(staleArtifacts(p)).toEqual(["render", "tasks"]);
  });
});

describe("goalCheck", () => {
  it("passes a complete, consistent project", () => {
    expect(goalCheck(builtProject()).met).toBe(true);
  });

  it("flags over-budget, stale and unreviewed work", () => {
    const p = builtProject();
    p.shoppingList!.total = 400;
    p.renders[0].critique = null;
    bump(p, "shopping");
    const g = goalCheck(p);
    expect(g.met).toBe(false);
    expect(g.gaps.join()).toMatch(/Within budget/);
    expect(g.gaps.join()).toMatch(/Implementation checklist: Out of date/);
    expect(g.gaps.join()).toMatch(/Design passed review: Not reviewed/);
    // The shoppable render is a bonus: reported in checks, never a blocking gap.
    expect(g.checks.find((c) => c.name === "Shoppable render")).toMatchObject({ ok: false, optional: true });
    expect(g.gaps.join()).not.toMatch(/Shoppable/);
  });
});

describe("normalizeTasks", () => {
  const lines = [{ productId: "p1", qty: 2, product: { name: "THROW", type: "Throw", url: "u" } }];
  it("adds missing purchase tasks, drops bad deps, orders prerequisites first, keeps done state", () => {
    const tasks = normalizeTasks(
      [
        { key: "style", title: "Style the bed", detail: "", phase: "style", dependsOn: ["clear", "ghost"], productId: null, minutes: 10 },
        { key: "clear", title: "Clear the floor", detail: "", phase: "prep", dependsOn: [], productId: "nope", minutes: 20 },
      ],
      lines,
      [{ id: "task-clear", title: "Clear the floor", detail: "", phase: "prep", order: 0, dependsOn: [], productId: null, minutes: 20, done: true, doneAt: "x" }],
    );
    expect(tasks.map((t) => t.id)).toEqual(["task-clear", "task-buy-p1", "task-style"]);
    expect(tasks.find((t) => t.id === "task-style")!.dependsOn).toEqual(["task-clear"]);
    expect(tasks[0].done).toBe(true);
    expect(tasks[0].productId).toBeNull();
    expect(tasks[1].title).toBe("Buy THROW ×2");
  });
});
