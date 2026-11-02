import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentModel, ModelInput, ModelTurn } from "../src/lib/agent/model";
import { runAgent } from "../src/lib/agent/orchestrator";
import { askUser, finish } from "../src/lib/agent/tools/control";
import { updateProject } from "../src/lib/agent/tools/room";
import { defineTool, RetryableError, type EmitInput, type Tool } from "../src/lib/agent/types";
import { createProject } from "../src/lib/domain/project";
import { setStore } from "../src/lib/store";
import { LocalStore } from "../src/lib/store/local";
import { brief } from "./fixtures";

/** Scripted model: each step sees the inputs it was sent and returns the next turn. */
class ScriptedModel implements AgentModel {
  seen: ModelInput[][] = [];
  constructor(private steps: ((input: ModelInput[]) => Omit<ModelTurn, "id">)[]) {}
  async respond({ input }: { input: ModelInput[] }) {
    this.seen.push(input);
    const step = this.steps[this.seen.length - 1];
    if (!step) return { id: `r${this.seen.length}`, text: "", calls: [{ callId: "x", name: "noop", args: "{}" }] };
    return { id: `r${this.seen.length}`, ...step(input) };
  }
}
const call = (name: string, args: object = {}, id = name) => ({ text: "", calls: [{ callId: id, name, args: JSON.stringify(args) }] });
const toolOutput = (input: ModelInput[]) => {
  const o = input.find((i) => i.kind === "tool_output");
  return o && o.kind === "tool_output" ? JSON.parse(o.output) : null;
};

let dir: string;
let projectId: string;
let events: EmitInput[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "roomwise-test-"));
  const store = new LocalStore(dir);
  setStore(store);
  const p = createProject("owner", "Test");
  p.brief = brief({ budget: 300 });
  await store.saveProject(p);
  projectId = p.id;
  events = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function flaky(failTimes: number, retryable: boolean): Tool {
  let n = 0;
  return defineTool({
    name: "flaky",
    description: "",
    parameters: z.object({}),
    mutates: false,
    async execute() {
      if (n++ < failTimes) throw retryable ? new RetryableError("upstream 503") : new Error("bad input");
      return { ok: true, summary: "worked" };
    },
  }) as Tool;
}
const noop = defineTool({ name: "noop", description: "", parameters: z.object({}), mutates: false, execute: async () => ({ ok: true, summary: "noop" }) }) as Tool;

const run = (model: AgentModel, tools: Tool[], userMessage = "go") =>
  runAgent({
    projectId,
    ownerId: "owner",
    runId: "run_1",
    userMessage,
    model,
    emit: async (e) => void events.push(e),
    counters: { renders: 0, toolCalls: 0, mutated: false },
    faults: new Map(),
    tools: [...tools, noop, finish as Tool, askUser as Tool, updateProject as Tool],
  });

describe("orchestrator loop", () => {
  it("retries an unexpected (non-transient) error once automatically", async () => {
    const model = new ScriptedModel([() => call("flaky"), (i) => (expect(toolOutput(i).ok).toBe(true), call("finish", { summary: "ok", goalMet: false, remainingGaps: ["rest"] }))]);
    await run(model, [flaky(1, false)]);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(1);
  });

  it("retries transient tool failures and succeeds", async () => {
    const model = new ScriptedModel([() => call("flaky"), (i) => (expect(toolOutput(i).ok).toBe(true), call("finish", { summary: "ok", goalMet: false, remainingGaps: ["rest"] }))]);
    const out = await run(model, [flaky(1, true)]);
    expect(out.status).toBe("done");
    expect(events.filter((e) => e.type === "retry")).toHaveLength(1);
  });

  it("returns non-retryable errors to the model and warns after repeated identical failures", async () => {
    const model = new ScriptedModel([
      () => call("flaky"),
      (i) => (expect(toolOutput(i).ok).toBe(false), call("flaky")),
      (i) => (expect(JSON.parse((i[0] as { output: string }).output).error).toMatch(/identical arguments/), call("flaky")),
      (i) => (expect(JSON.parse((i[0] as { output: string }).output).error).toMatch(/failed 3 times in a row/), call("finish", { summary: "blocked", goalMet: false, remainingGaps: ["flaky broken"] })),
    ]);
    const out = await run(model, [flaky(10, false)]);
    expect(out.status).toBe("done");
    // Unexpected errors get exactly one automatic retry per call before going back to the model.
    expect(events.filter((e) => e.type === "retry")).toHaveLength(3);
  });

  it("gates constraint relaxation behind a verbatim user quote or approval", async () => {
    const model = new ScriptedModel([
      () => call("update_project", { brief: { budget: 500 } }),
      (i) => {
        const o = JSON.parse((i[0] as { output: string }).output);
        expect(o.needsApproval.key).toMatch(/^relax:budget/);
        expect(o.next).toMatch(/ask_user/);
        return call("update_project", { brief: { budget: 500 }, userQuote: "raise it to $500" });
      },
      (i) => (expect(JSON.parse((i[0] as { output: string }).output).ok).toBe(true), call("finish", { summary: "done", goalMet: false, remainingGaps: ["rest"] })),
    ]);
    await run(model, [], "Actually, raise it to $500 please");
    const p = await new LocalStore(dir).getProject(projectId);
    expect(p!.brief!.budget).toBe(500);
  });

  it("refuses a fabricated quote", async () => {
    const model = new ScriptedModel([
      () => call("update_project", { brief: { budget: 900 }, userQuote: "spend whatever you need" }),
      (i) => (expect(JSON.parse((i[0] as { output: string }).output).ok).toBe(false), call("finish", { summary: "kept budget", goalMet: false, remainingGaps: ["rest"] })),
    ]);
    await run(model, [], "make it cozier");
    expect((await new LocalStore(dir).getProject(projectId))!.brief!.budget).toBe(300);
  });

  it("rejects finish(goalMet=true) when the goal check finds gaps", async () => {
    const model = new ScriptedModel([
      () => call("finish", { summary: "all done!", goalMet: true }),
      (i) => (expect(JSON.parse((i[0] as { output: string }).output).error).toMatch(/Goal check disagrees/), call("finish", { summary: "partial", goalMet: false, remainingGaps: ["no render"] })),
    ]);
    const out = await run(model, []);
    expect(out.status).toBe("done");
    const p = await new LocalStore(dir).getProject(projectId);
    expect(p!.messages.at(-1)!.text).toBe("partial");
  });

  it("pauses the run on ask_user and records the pending question", async () => {
    const model = new ScriptedModel([() => call("ask_user", { kind: "choice", question: "Which direction?", options: ["A", "B"] })]);
    const out = await run(model, []);
    expect(out.status).toBe("awaiting_user");
    const p = await new LocalStore(dir).getProject(projectId);
    expect(p!.pending!.question).toBe("Which direction?");
  });

  it("nudges the model to call finish after it mutated state", async () => {
    const model = new ScriptedModel([
      () => call("update_project", { decision: "go linen" }),
      () => ({ text: "Done!", calls: [] }),
      (i) => (expect((i[0] as { text: string }).text).toMatch(/Call finish/), call("finish", { summary: "Linen it is.", goalMet: false, remainingGaps: ["rest"] })),
    ]);
    expect((await run(model, [])).status).toBe("done");
  });

  it("validates tool arguments and stops at the iteration cap", async () => {
    const model = new ScriptedModel([() => call("update_project", { brief: { budget: -5 } })]);
    const out = await run(model, []);
    expect(events.some((e) => e.type === "tool_result" && /Invalid arguments/.test(e.summary))).toBe(true);
    expect(out.status).toBe("stopped");
  });
});
