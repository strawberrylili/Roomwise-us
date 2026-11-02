import OpenAI from "openai";
import { config } from "../config";
import { addMessage, goalCheck } from "../domain/project";
import type { Run } from "../domain/schemas";
import { getStore, mutateProject } from "../store";
import { errorMessage, sleep } from "../util";
import type { AgentModel, ModelInput, ToolCall } from "./model";
import { snapshot } from "./snapshot";
import { TOOLS } from "./tools";
import { RetryableError, type EmitInput, type RunCounters, type Tool, type ToolContext, type ToolResult } from "./types";

export const INSTRUCTIONS = `You are Roomwise, an autonomous interior designer for room makeovers — bedrooms, living rooms, dining areas, open living + dining spaces and bathrooms — and the orchestrator of the tools that do the work. The user defines the outcome; you decide which steps to take, in what order, and whether results are good enough.

How you work:
- PROJECT STATE (developer message) is the source of truth. Read it before acting. Skip work that's already done and not STALE.
- The design comes first; shopping serves it. Typical path for a new project: analyze_room → ask_user to clarify uncertain observations that change the design (what the space should do, bed size, heaters/vents, what stays) → update_project with the answers (set brief.roomType and brief.functions from the user's answer about the space, and room.confirmed=true) → generate_design_plan (2-3 concepts) → ask_user (choice) between concepts unless the user told you to choose → select_direction → render_concept (the INSPIRATION render — the main deliverable) → critique_render (if it fails, render_concept again with its fixInstructions; at most 2 re-renders) → search_products for the concept's pieces → compare_products (all key categories in one call) → optimize_budget (revise until valid) → generate_room_image (the SHOPPABLE render, a bonus) → critique_render → create_tasks → finish.
- Design for the brief's roomType and functions (the user's words win over what the photos suggest). An open space can do several things — zone it.
- Respect the brief's intensity: refresh = soft goods only; restyle = swap furniture, keep layout; redesign = everything but architecture can go. A null budget means no limit — pick the best products, not the cheapest.
- That path is a default, not a script. For revisions, work out which artifacts the request affects and redo only those: "different rug" → search/compare rugs → optimize_budget → re-render → critique → tasks. "Warmer overall" → generate_design_plan count=1 with guidance → select_direction → render_concept → critique → products → shoppable render. A tweak to the look ("more blankets", "warmer light") → render_concept with revisionNote; do NOT regenerate the concept. A question like "what size is the rug?" → just answer via finish.
- A render that passes review is done. Re-render only if it failed review or the user asked for a change; minor review notes go in your summary.
- When the user states a taste ("I hate grey", "love linen"), save it with update_project.preferences so it carries to future sessions.
- Constraints are hard: budget, rental-safe, keep-list, must-haves, avoid-list. Never relax one on your own.
- Tool errors are information. Validation errors → fix the input. Empty search → broaden or rephrase. needsApproval → ask_user kind=approval with that approvalKey. Never repeat a failed call with identical arguments. An unexpected error (not a validation error) deserves one more attempt — adjust the inputs if you can — before you report it as a blocker.
- Only recommend products from the catalog (real listings). Never invent products, prices or links.
- Ask only questions whose answers change the design. Put ALL open room questions into ONE ask_user (number them in the question); don't ask a second round unless an answer raised something new.
- AUTOPILOT (see PROJECT STATE): never call ask_user. Make the call a good designer would, record each assumption with update_project (answers / decision / brief.roomType), and list the assumptions at the end of the finish summary. Hard constraints still can't be relaxed, and approvals can't be self-granted — skip those actions and say so.
- Always end by calling finish (or ask_user, when not on autopilot). The finish summary is the chat message the user reads: warm, concrete, 2-5 sentences, mention the total and what to look at.
- Prices are USD from IKEA US.`;

type Faults = Map<string, { remaining: number; retryable: boolean }>;

export function parseFaults(spec = process.env.ROOMWISE_FAULTS ?? ""): Faults {
  const m: Faults = new Map();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [tool, n, kind] = part.split(":");
    m.set(tool, { remaining: Number(n ?? 1), retryable: kind === "retryable" });
  }
  return m;
}

export type RunOutcome = { status: Run["status"]; iterations: number; error: string | null };

export async function runAgent(o: {
  projectId: string;
  ownerId: string;
  runId: string;
  userMessage: string;
  model: AgentModel;
  emit: (e: EmitInput) => Promise<void>;
  counters: RunCounters;
  signal?: AbortSignal;
  faults?: Faults;
  tools?: Tool[];
}): Promise<RunOutcome> {
  const tools = o.tools ?? TOOLS;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const store = getStore();
  const faults = o.faults ?? parseFaults();
  const failures = new Map<string, number>();
  const lastFailedArgs = new Map<string, string>();

  const ctx: ToolContext = {
    projectId: o.projectId,
    ownerId: o.ownerId,
    runId: o.runId,
    userMessage: o.userMessage,
    counters: o.counters,
    get: async () => {
      const p = await store.getProject(o.projectId);
      if (!p) throw new Error("Project disappeared");
      return p;
    },
    mutate: async (fn) => (await mutateProject(o.projectId, fn)).result,
    emit: o.emit,
  };

  const p = await ctx.get();
  const prefs = await store.getPreferences(o.ownerId);
  const convo = p.messages
    .slice(-13, -1)
    .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
    .join("\n");
  let input: ModelInput[] = [
    { kind: "message", role: "developer", text: `PROJECT STATE\n${snapshot(p, prefs)}` },
    ...(convo ? [{ kind: "message" as const, role: "developer" as const, text: `EARLIER CONVERSATION (oldest first)\n${convo}` }] : []),
    { kind: "message", role: "user", text: o.userMessage },
  ];
  let previousId: string | null = null;
  let nudged = false;

  for (let iteration = 1; iteration <= config.agent.maxIterations; iteration++) {
    if (o.signal?.aborted) return { status: "stopped", iterations: iteration - 1, error: null };

    let turn;
    try {
      turn = await o.model.respond({ instructions: INSTRUCTIONS, input, tools, previousId });
    } catch (e) {
      await o.emit({ type: "error", summary: `Model call failed: ${errorMessage(e)}`, ok: false });
      return { status: "failed", iterations: iteration, error: errorMessage(e) };
    }
    previousId = turn.id;
    if (turn.text.trim() && turn.calls.length) await o.emit({ type: "message", summary: turn.text.trim().slice(0, 400) });

    if (turn.calls.length === 0) {
      if (o.counters.mutated && !nudged) {
        nudged = true;
        input = [{ kind: "message", role: "developer", text: "You changed the project during this turn. Call finish so the outcome is goal-checked and the user gets a summary." }];
        continue;
      }
      if (turn.text.trim()) await ctx.mutate((proj) => void addMessage(proj, "assistant", turn.text.trim(), o.runId));
      return { status: "done", iterations: iteration, error: null };
    }

    const outputs: ModelInput[] = [];
    for (const call of turn.calls) {
      const result = await executeCall(call);
      if (result.ok && result.endRun) {
        return { status: result.endRun, iterations: iteration, error: null };
      }
      outputs.push({ kind: "tool_output", callId: call.callId, output: serialize(call.name, result) });
    }
    input = outputs;
  }

  const gaps = goalCheck(await ctx.get()).gaps;
  await o.emit({ type: "error", summary: `Stopped at the ${config.agent.maxIterations}-step limit`, ok: false });
  await ctx.mutate((proj) =>
    void addMessage(
      proj,
      "assistant",
      `I've hit my step limit for this request, so I'm pausing here.${gaps.length ? ` Still open: ${gaps.slice(0, 3).join("; ")}.` : ""} Say "continue" and I'll pick up where I left off.`,
      o.runId,
    ),
  );
  return { status: "stopped", iterations: config.agent.maxIterations, error: "iteration limit" };

  async function executeCall(call: ToolCall): Promise<ToolResult> {
    const tool = byName.get(call.name);
    if (!tool) return { ok: false, error: `Unknown tool ${call.name}` };
    let args: unknown;
    try {
      args = JSON.parse(call.args || "{}");
    } catch {
      return { ok: false, error: "Arguments were not valid JSON" };
    }
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      const error = `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`;
      await o.emit({ type: "tool_result", tool: tool.name, ok: false, summary: error });
      return { ok: false, error };
    }

    await o.emit({ type: "tool_call", tool: tool.name, summary: describeArgs(parsed.data), data: parsed.data });
    o.counters.toolCalls++;
    const started = Date.now();
    let result: ToolResult | undefined;
    for (let attempt = 0; attempt <= config.agent.maxToolRetries; attempt++) {
      try {
        const fault = faults.get(tool.name);
        if (fault && fault.remaining > 0) {
          fault.remaining--;
          if (fault.retryable) throw new RetryableError(`Injected transient failure in ${tool.name}`);
          throw new Error(`Injected failure in ${tool.name}`);
        }
        result = await tool.execute(ctx, parsed.data);
        break;
      } catch (e) {
        // Known-transient errors get the full retry budget; any other unexpected exception gets one retry.
        const retryable = !isQuotaError(e) && (e instanceof RetryableError || isTransient(e) || attempt === 0);
        if (retryable && attempt < config.agent.maxToolRetries) {
          await o.emit({ type: "retry", tool: tool.name, summary: `Attempt ${attempt + 1} failed (${errorMessage(e)}); retrying` });
          await sleep(process.env.VITEST ? 0 : 1000 * 2 ** attempt);
          continue;
        }
        result = { ok: false, error: errorMessage(e), retryable };
        break;
      }
    }
    result ??= { ok: false, error: "No result" };

    await o.emit({
      type: "tool_result",
      tool: tool.name,
      ok: result.ok,
      summary: result.ok ? result.summary : result.error.split("\n")[0].slice(0, 300),
      durationMs: Date.now() - started,
    });

    if (result.ok) {
      failures.delete(tool.name);
      lastFailedArgs.delete(tool.name);
      if (tool.mutates) o.counters.mutated = true;
      return result;
    }
    const n = (failures.get(tool.name) ?? 0) + 1;
    failures.set(tool.name, n);
    const repeat = lastFailedArgs.get(tool.name) === call.args;
    lastFailedArgs.set(tool.name, call.args);
    const notes: string[] = [];
    if (repeat) notes.push("You repeated a failed call with identical arguments. Change the inputs or the approach.");
    if (n >= config.agent.maxConsecutiveToolFailures) notes.push(`${tool.name} has failed ${n} times in a row. Stop retrying it: try a different approach, or ask_user / finish with goalMet=false explaining the blocker.`);
    return notes.length ? { ...result, error: `${result.error}\n\n${notes.join(" ")}` } : result;
  }
}

function isTransient(e: unknown) {
  if (isQuotaError(e)) return false;
  if (e instanceof OpenAI.APIConnectionError) return true;
  if (e instanceof OpenAI.APIError) return e.status === 429 || (e.status ?? 0) >= 500;
  return e instanceof TypeError && /fetch failed/i.test(e.message);
}

/** Out of credits looks like a 429 but never clears on retry. */
export function isQuotaError(e: unknown) {
  return e instanceof OpenAI.APIError && (e.code === "insufficient_quota" || /no credits|quota/i.test(e.message));
}

function serialize(name: string, r: ToolResult) {
  const body = r.ok
    ? { ok: true, summary: r.summary, data: r.data }
    : { ok: false, error: r.error, retryable: r.retryable ?? false, needsApproval: r.needsApproval, data: r.data };
  if (!r.ok && r.needsApproval) {
    (body as Record<string, unknown>).next = `Call ask_user with kind="approval", approvalKey="${r.needsApproval.key}".`;
  }
  const s = JSON.stringify(body);
  return s.length > 12_000 ? `${s.slice(0, 12_000)}…(truncated ${name} output)` : s;
}

function describeArgs(args: unknown) {
  const s = JSON.stringify(args);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}
