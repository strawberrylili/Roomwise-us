import { EventEmitter } from "node:events";
import { addMessage, goalCheck } from "../domain/project";
import type { Run, RunEvent } from "../domain/schemas";
import { getStore, mutateProject } from "../store";
import { errorMessage, newId, now } from "../util";
import { OpenAIAgentModel, type AgentModel } from "./model";
import { runAgent } from "./orchestrator";
import { MockAgentModel } from "../mock/agent";
import { mockEnabled } from "../mock/ai";
import type { EmitInput, RunCounters } from "./types";

/**
 * In-process background runs. The API returns as soon as a run starts; progress streams to the
 * UI as events. Production would move this onto a durable queue (Inngest) — the interface is the same.
 */
type Registry = { active: Map<string, AbortController>; seq: Map<string, number>; bus: EventEmitter };
const g = globalThis as unknown as { __roomwiseRuns?: Registry };
const reg: Registry = (g.__roomwiseRuns ??= { active: new Map(), seq: new Map(), bus: new EventEmitter().setMaxListeners(200) });

export function subscribe(projectId: string, fn: (e: RunEvent) => void) {
  reg.bus.on(projectId, fn);
  return () => void reg.bus.off(projectId, fn);
}

export function isRunning(projectId: string) {
  return reg.active.has(projectId);
}

async function nextSeq(projectId: string) {
  if (!reg.seq.has(projectId)) {
    const events = await getStore().listEvents(projectId);
    reg.seq.set(projectId, events.at(-1)?.seq ?? 0);
  }
  const n = reg.seq.get(projectId)! + 1;
  reg.seq.set(projectId, n);
  return n;
}

export class RunConflictError extends Error {}

export async function startRun(opts: {
  projectId: string;
  ownerId: string;
  message: string;
  /** Show the message in the chat as the user's (false for system-triggered runs like UI actions). */
  asUserMessage?: boolean;
  model?: AgentModel;
}): Promise<{ runId: string; done: Promise<void> }> {
  if (reg.active.has(opts.projectId)) throw new RunConflictError("The designer is already working on this project");
  const controller = new AbortController();
  reg.active.set(opts.projectId, controller);

  const runId = newId("run");
  const run: Run = { id: runId, status: "running", trigger: opts.message.slice(0, 200), startedAt: now(), endedAt: null, iterations: 0, toolCalls: 0, renders: 0, error: null, goalCheck: null };
  try {
    await mutateProject(opts.projectId, (p) => {
      if (opts.asUserMessage !== false) addMessage(p, "user", opts.message, runId);
      p.pending = null;
      p.runs.push(run);
      if (p.runs.length > 50) p.runs.splice(0, p.runs.length - 50);
    });
  } catch (e) {
    reg.active.delete(opts.projectId);
    throw e;
  }

  const emit = async (e: EmitInput) => {
    const event: RunEvent = { seq: await nextSeq(opts.projectId), runId, at: now(), tool: null, ok: null, durationMs: null, ...e };
    await getStore().appendEvent(opts.projectId, event);
    reg.bus.emit(opts.projectId, event);
  };

  const counters: RunCounters = { renders: 0, toolCalls: 0, mutated: false };
  const done = (async () => {
    await emit({ type: "run_started", summary: opts.message.slice(0, 200) });
    let outcome;
    try {
      outcome = await runAgent({ projectId: opts.projectId, ownerId: opts.ownerId, runId, userMessage: opts.message, model: opts.model ?? (mockEnabled() ? new MockAgentModel(opts.projectId) : new OpenAIAgentModel()), emit, counters, signal: controller.signal });
    } catch (e) {
      outcome = { status: "failed" as const, iterations: 0, error: errorMessage(e) };
      await emit({ type: "error", summary: errorMessage(e), ok: false });
    }
    try {
      await mutateProject(opts.projectId, (p) => {
        const r = p.runs.find((x) => x.id === runId);
        if (r) Object.assign(r, { status: outcome.status, endedAt: now(), iterations: outcome.iterations, toolCalls: counters.toolCalls, renders: counters.renders, error: outcome.error, goalCheck: goalCheck(p) });
        if (outcome.status === "failed") {
          const quota = /no credits|quota/i.test(outcome.error ?? "");
          addMessage(p, "assistant", quota ? "I've run out of OpenAI API credits, so I can't continue. Add credits at platform.openai.com → Billing, then say \"continue\". Your project is saved." : `Something went wrong on my side (${outcome.error}). Your project is saved — try again in a moment.`, runId);
        }
      });
      await emit({ type: "run_finished", summary: outcome.status, ok: outcome.status !== "failed" });
    } finally {
      reg.active.delete(opts.projectId);
    }
  })();
  return { runId, done };
}

export function stopRun(projectId: string) {
  reg.active.get(projectId)?.abort();
}

/** Runs marked "running" with no live process (server restarted) are failed on read. */
export async function reconcileRuns(projectId: string) {
  if (reg.active.has(projectId)) return;
  const p = await getStore().getProject(projectId);
  if (!p?.runs.some((r) => r.status === "running")) return;
  await mutateProject(projectId, (proj) => {
    for (const r of proj.runs) if (r.status === "running") Object.assign(r, { status: "failed", endedAt: now(), error: "Server restarted during run" });
  });
}
