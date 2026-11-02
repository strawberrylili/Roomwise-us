/**
 * End-to-end agent journeys with ROOMWISE_MOCK=1: real runs, tools, validators, store and events;
 * only OpenAI and IKEA are replaced by deterministic mocks. No network, no credits.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startRun, subscribe } from "../src/lib/agent/runs";
import { createProject, goalCheck, staleArtifacts } from "../src/lib/domain/project";
import type { Brief, Project, RunEvent } from "../src/lib/domain/schemas";
import { validateShoppingList } from "../src/lib/domain/validators";
import { getStore, mutateProject, setStore } from "../src/lib/store";
import { LocalStore } from "../src/lib/store/local";
import type { ToolContext } from "../src/lib/agent/types";

let dir: string;
const OWNER = "journey-owner";

beforeAll(async () => {
  process.env.ROOMWISE_MOCK = "1";
  dir = await mkdtemp(join(tmpdir(), "roomwise-journey-"));
  setStore(new LocalStore(dir));
});
afterAll(async () => {
  delete process.env.ROOMWISE_MOCK;
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  delete process.env.ROOMWISE_FAULTS;
});

const redesign: Brief = { style: ["cozy", "Japandi"], description: "Cozy, beige, lots of blankets", colors: ["beige"], avoid: [], budget: null, roomType: "bedroom", functions: [], intensity: "redesign", rental: true, keep: [], mustHave: ["blankets"] };

async function newProject(brief: Brief) {
  const store = getStore();
  const p = createProject(OWNER, "Journey");
  p.brief = brief;
  const jpg = await sharp({ create: { width: 768, height: 1024, channels: 3, background: "#ddd" } }).jpeg().toBuffer();
  p.photos.push({ id: "ph_1", path: await store.putFile(p.id, "ph_1.jpg", jpg, "image/jpeg"), width: 768, height: 1024, kind: "room", emptyPath: null, createdAt: new Date().toISOString() });
  await store.saveProject(p);
  return p.id;
}

async function say(id: string, message: string) {
  const { runId, done } = await startRun({ projectId: id, ownerId: OWNER, message });
  await done;
  const p = (await getStore().getProject(id))!;
  return { p, run: p.runs.find((r) => r.id === runId)!, events: await getStore().listEvents(id, { runId }) };
}

/** What the answer API does: record the answer as a user message tied to the pending question. */
const answer = (p: Project, text: string) => say(p.id, `${text}\n\n(answering: "${p.pending!.question}")`);
const toolsRun = (events: RunEvent[]) => events.filter((e) => e.type === "tool_result").map((e) => `${e.tool}${e.ok ? "" : "✗"}`);

describe("redesign journey (no budget, everything can go)", () => {
  let id: string;
  let afterPlan: Project;

  it("kickoff: analyzes the room and asks about the uncertain observation", async () => {
    id = await newProject(redesign);
    const { run, p, events } = await say(id, "Redesign my bedroom completely.");
    expect(run.status).toBe("awaiting_user");
    expect(toolsRun(events)).toEqual(["analyze_room", "ask_user"]);
    expect(p.room?.bedSize).toBe("full");
    expect(p.pending?.kind).toBe("clarify");
    expect(p.pending?.question).toMatch(/heater/);
  });

  it("answer: confirms the room, generates concepts in parallel, asks for a choice", async () => {
    const before = (await getStore().getProject(id))!;
    const { run, p } = await answer(before, "Just a ledge");
    expect(run.status).toBe("awaiting_user");
    expect(p.room?.confirmed).toBe(true);
    expect(p.room?.questions[0].answer).toBe("Just a ledge");
    expect(p.directions.map((d) => d.name.split(" — ")[0]).sort()).toEqual(["Quiet Ryokan", "Window Cocoon"]);
    expect(p.pending?.kind).toBe("choice");
  });

  it("choice: renders inspiration (staged), sources products, shoppable render, tasks, finish", async () => {
    const before = (await getStore().getProject(id))!;
    const { run, p, events } = await answer(before, "Window Cocoon");
    expect(run.status).toBe("done");
    expect(toolsRun(events)).toEqual([
      "select_direction",
      "render_concept",
      "critique_render",
      "search_products",
      "compare_products",
      "optimize_budget",
      "generate_room_image",
      "critique_render",
      "create_tasks",
      "finish",
    ]);
    expect(p.directions.find((d) => d.id === p.selectedDirectionId)?.name).toMatch(/Window Cocoon/);
    // Redesign → room emptied first, cached on the photo.
    expect(p.photos[0].emptyPath).toMatch(/-empty\.png$/);
    expect(p.renders.map((r) => r.kind)).toEqual(["inspiration", "shoppable"]);
    expect(p.renders.every((r) => r.critique?.pass)).toBe(true);
    // Shopping list re-validates cleanly and matches what's saved.
    const v = validateShoppingList(p.shoppingList!.lines, p.catalog, p.brief!, p.room);
    expect(v.errors).toEqual([]);
    expect(p.shoppingList!.budget).toBeNull();
    expect(p.shoppingList!.lines.every((l) => !l.product.size || /full/i.test(l.product.size))).toBe(true);
    // Every product has exactly one purchase task; prerequisites come first.
    const buys = p.tasks.filter((t) => t.phase === "purchase");
    expect(buys.map((t) => t.productId).sort()).toEqual(p.shoppingList!.lines.map((l) => l.productId).sort());
    const order = new Map(p.tasks.map((t) => [t.id, t.order]));
    for (const t of p.tasks) for (const d of t.dependsOn) expect(order.get(d)!).toBeLessThan(t.order);
    expect(goalCheck(p).met).toBe(true);
    expect(p.messages.at(-1)?.text).toMatch(/Window Cocoon plan is ready/);
    afterPlan = p;
  });

  it("revision: a tweak re-renders inspiration only, without regenerating the concept", async () => {
    const { run, p, events } = await say(id, "Can you make the bed more layered?");
    expect(run.status).toBe("done");
    expect(toolsRun(events)).toEqual(["render_concept", "critique_render", "finish"]);
    expect(p.versions.directions).toBe(afterPlan.versions.directions);
    expect(p.versions.shopping).toBe(afterPlan.versions.shopping);
    expect(p.renders.filter((r) => r.kind === "inspiration")).toHaveLength(2);
    expect(p.renders.at(-1)?.revisionNote).toMatch(/more layered/);
    expect(goalCheck(p).met).toBe(true);
  });

  it("user edits the brief: downstream work goes stale and the goal check reopens", async () => {
    const { project } = await mutateProject(id, (p) => {
      p.brief = { ...p.brief!, colors: ["sage"] };
      p.versions.brief += 1;
    });
    expect(staleArtifacts(project)).toEqual(["directions", "inspiration", "shopping", "render", "tasks"]);
    expect(goalCheck(project).met).toBe(false);
  });

  it("streams every event to subscribers", async () => {
    const seen: RunEvent[] = [];
    const id2 = await newProject({ ...redesign });
    const off = subscribe(id2, (e) => seen.push(e));
    await say(id2, "Redesign my bedroom completely.");
    off();
    expect(seen[0].type).toBe("run_started");
    expect(seen.at(-1)?.type).toBe("run_finished");
    expect(seen.map((e) => e.seq)).toEqual([...seen.map((e) => e.seq)].sort((a, b) => a - b));
  });
});

describe("resilience", () => {
  it("recovers from injected transient and unexpected tool failures", async () => {
    process.env.ROOMWISE_FAULTS = "analyze_room:1:retryable,render_concept:1,search_products:1:retryable,optimize_budget:1";
    const id = await newProject(redesign);
    let r = await say(id, "Redesign my bedroom completely.");
    r = await answer(r.p, "Just a ledge");
    r = await answer(r.p, "Window Cocoon");
    expect(r.run.status).toBe("done");
    expect(goalCheck(r.p).met).toBe(true);
    const retries = r.events.filter((e) => e.type === "retry").map((e) => e.tool);
    expect(retries).toEqual(expect.arrayContaining(["render_concept", "search_products", "optimize_budget"]));
  });

  it("enforces the per-request render cap behind an approval", async () => {
    const id = await newProject(redesign);
    let r = await say(id, "Redesign my bedroom completely.");
    r = await answer(r.p, "Just a ledge");
    await answer(r.p, "Window Cocoon");
    // Simulate a request that has already used its 3 free renders by driving the tool directly.
    const { renderConcept } = await import("../src/lib/agent/tools/render");
    const ctx: ToolContext = {
      projectId: id, ownerId: OWNER, runId: "run_x", userMessage: "", counters: { renders: 3, toolCalls: 0, mutated: false },
      get: async () => (await getStore().getProject(id))!,
      mutate: async (fn) => (await mutateProject(id, fn)).result,
      emit: async () => {},
    };
    const res = await renderConcept.execute(ctx, { revisionNote: "one more" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.needsApproval?.key).toMatch(/^render:extra:/);
  });
});

describe("refresh journey (with a budget)", () => {
  it("keeps furniture, doesn't stage an empty room, and stays within budget", async () => {
    const id = await newProject({ ...redesign, intensity: "refresh", budget: 900, keep: ["bed frame"] });
    let r = await say(id, "Freshen up my bedroom.");
    r = await answer(r.p, "Just a ledge");
    expect(new Set(r.p.pending!.options).size).toBe(r.p.pending!.options.length);
    r = await answer(r.p, r.p.pending!.options[0]);
    expect(r.run.status).toBe("done");
    expect(r.p.photos[0].emptyPath).toBeNull();
    expect(r.p.shoppingList!.total).toBeLessThanOrEqual(900);
    expect(goalCheck(r.p).met).toBe(true);
  });
});

describe("other spaces", () => {
  it("open living + dining: asks what the space should do, then zones it", async () => {
    const id = await newProject({ ...redesign, roomType: null, mustHave: [] });
    let r = await say(id, "Make this space feel like a real home.");
    expect(r.run.status).toBe("awaiting_user");
    expect(r.p.room?.roomType).toBe("living_dining");
    expect(r.p.pending?.question).toMatch(/What should this space do/);
    expect(r.p.pending?.options[0]).toBe("Living + dining");

    r = await answer(r.p, "Living + dining");
    expect(r.p.brief?.roomType).toBe("living_dining");
    expect(r.p.brief?.functions).toEqual(["Relax", "Dine"]);
    r = await answer(r.p, r.p.pending!.options[0]);
    expect(r.run.status).toBe("done");
    expect(goalCheck(r.p).met).toBe(true);
    const cats = r.p.shoppingList!.lines.map((l) => l.product.category);
    expect(cats).toEqual(expect.arrayContaining(["sofa", "dining_table", "dining_chair", "pendant_light"]));
    expect(r.p.shoppingList!.lines.find((l) => l.product.category === "dining_chair")?.qty).toBe(4);
    expect(r.p.renders.find((x) => x.kind === "inspiration")?.prompt).toMatch(/client's space, emptied/);
  });

  it("asks when the photos disagree with the stated room type", async () => {
    const id = await newProject({ ...redesign, roomType: "dining", mustHave: [] });
    const r = await say(id, "Redesign it.");
    expect(r.p.pending?.question).toMatch(/You said this is a dining area, but the photos look like an open living \+ dining space/);
  });

  it("bathroom: fixtures stay in every render and no plug-in lamps", async () => {
    const id = await newProject({ ...redesign, roomType: "bathroom", mustHave: ["towels"] });
    let r = await say(id, "Make my bathroom feel like a spa.");
    // Nothing uncertain in the mock bathroom, so the agent goes straight to concepts.
    expect(r.p.room?.roomType).toBe("bathroom");
    if (r.run.status === "awaiting_user") r = await answer(r.p, r.p.pending!.options[0] ?? "Go ahead");
    expect(r.run.status).toBe("done");
    expect(goalCheck(r.p).met).toBe(true);
    for (const render of r.p.renders) expect(render.prompt).toMatch(/Fixed fixtures stay exactly as they are: Toilet/);
    expect(r.p.shoppingList!.lines.some((l) => ["table_lamp", "floor_lamp"].includes(l.product.category))).toBe(false);
    expect(r.p.shoppingList!.lines.map((l) => l.product.category)).toEqual(expect.arrayContaining(["towels", "bath_mat", "shower_curtain"]));
  });
});

describe("regressions from real runs", () => {
  it("confirming the room or recording answers after concepts exist doesn't make them stale", async () => {
    const id = await newProject(redesign);
    let r = await say(id, "Redesign my bedroom completely.");
    r = await answer(r.p, "Just a ledge");
    await answer(r.p, "Window Cocoon");
    const { updateProject } = await import("../src/lib/agent/tools/room");
    const ctx: ToolContext = {
      projectId: id, ownerId: OWNER, runId: "run_y", userMessage: "", counters: { renders: 0, toolCalls: 0, mutated: false },
      get: async () => (await getStore().getProject(id))!,
      mutate: async (fn) => (await mutateProject(id, fn)).result,
      emit: async () => {},
    };
    const p0 = (await getStore().getProject(id))!;
    await updateProject.execute(ctx, { room: { confirmed: true, answers: [{ questionId: p0.room!.questions[0].id, answer: "Definitely a ledge" }] } });
    expect(staleArtifacts((await getStore().getProject(id))!)).toEqual([]);
    // A factual correction still invalidates downstream work.
    await updateProject.execute(ctx, { room: { bedSize: "queen" } });
    expect(staleArtifacts((await getStore().getProject(id))!)).toContain("directions");
  });

  it("keep-list items are preserved in staged renders and the empty-room step", async () => {
    const id = await newProject({ ...redesign, keep: ["kitchen cabinets and appliances"] });
    let r = await say(id, "Redesign it.");
    r = await answer(r.p, "Just a ledge");
    r = await answer(r.p, "Window Cocoon");
    const inspo = r.p.renders.find((x) => x.kind === "inspiration")!;
    expect(inspo.prompt).toMatch(/keeping these exactly as they are .*kitchen cabinets and appliances/);
  });
});

describe("autopilot", () => {
  it("runs start to finish without stopping, and reports its assumptions", async () => {
    const id = await newProject({ ...redesign, roomType: null, mustHave: [] });
    await mutateProject(id, (p) => void (p.autopilot = true));
    const r = await say(id, "Make this space feel like a real home.");
    expect(r.run.status).toBe("done");
    expect(r.p.pending).toBeNull();
    expect(toolsRun(r.events)).not.toContain("ask_user");
    expect(r.p.brief?.roomType).toBe("living_dining");
    expect(r.p.decisions.some((d) => /Autopilot assumed/.test(d.text))).toBe(true);
    expect(r.p.messages.at(-1)?.text).toMatch(/Assumptions I made:/);
    expect(goalCheck(r.p).met).toBe(true);
  });

  it("ask_user is refused in code while autopilot is on, including approvals", async () => {
    const id = await newProject(redesign);
    await mutateProject(id, (p) => void (p.autopilot = true));
    const { askUser } = await import("../src/lib/agent/tools/control");
    const ctx: ToolContext = {
      projectId: id, ownerId: OWNER, runId: "run_z", userMessage: "", counters: { renders: 0, toolCalls: 0, mutated: false },
      get: async () => (await getStore().getProject(id))!,
      mutate: async (fn) => (await mutateProject(id, fn)).result,
      emit: async () => {},
    };
    const clarify = await askUser.execute(ctx, { kind: "clarify", question: "Bed size?", options: [] });
    expect(clarify.ok).toBe(false);
    const approval = await askUser.execute(ctx, { kind: "approval", question: "Raise budget?", options: [], approvalKey: "relax:budget" });
    expect(!approval.ok && approval.error).toMatch(/approvals can't be given automatically/);
    expect((await getStore().getProject(id))!.pending).toBeNull();
  });
});
