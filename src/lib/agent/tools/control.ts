import { z } from "zod";
import { addMessage, goalCheck } from "../../domain/project";
import { newId, now } from "../../util";
import { defineTool } from "../types";

export const askUser = defineTool({
  name: "ask_user",
  description:
    "Ask the user something and pause until they answer: clarify uncertain room observations, let them choose between directions, or request approval for a gated action (pass the approvalKey from the tool that asked for it). Keep it to one clear question with 2-4 short options when possible.",
  parameters: z.object({
    kind: z.enum(["clarify", "choice", "approval"]),
    question: z.string(),
    options: z.array(z.string()).max(4).default([]),
    approvalKey: z.string().optional(),
  }),
  mutates: false,
  async execute(ctx, args) {
    const project = await ctx.get();
    if (project.autopilot) {
      return {
        ok: false,
        error:
          args.kind === "approval"
            ? "Autopilot is on and approvals can't be given automatically. Skip this action, carry on without it, and mention it in your finish summary so the user can approve it later."
            : "Autopilot is on: don't ask — decide using your best judgement (prefer the option that best fits the brief), record it with update_project (answers / decision), and list your assumptions in the finish summary.",
      };
    }
    if (args.kind === "approval" && !args.approvalKey) return { ok: false, error: "approval questions need the approvalKey returned by the gated tool" };
    await ctx.mutate((p) => {
      p.pending = {
        id: newId("ask"),
        kind: args.kind,
        question: args.question,
        options: args.kind === "approval" && args.options.length === 0 ? ["Approve", "Not now"] : args.options,
        approvalKey: args.approvalKey ?? null,
        runId: ctx.runId,
        createdAt: now(),
      };
      addMessage(p, "assistant", args.question, ctx.runId);
    });
    return { ok: true, summary: `Asked user (${args.kind})`, endRun: "awaiting_user" };
  },
});

export const finish = defineTool({
  name: "finish",
  description:
    "End this turn with a short message for the user. Code runs a goal check on the project (room, brief, direction, valid shopping list within budget, up-to-date reviewed render, checklist). If you claim goalMet but the check finds gaps, you'll be asked to fix them or report them honestly via goalMet=false + remainingGaps.",
  parameters: z.object({
    summary: z.string().describe("what you did and what the user should look at next; warm, concise, 2-5 sentences. On autopilot, end with 'Assumptions I made:' and a short list."),
    goalMet: z.boolean(),
    remainingGaps: z.array(z.string()).default([]),
  }),
  mutates: false,
  async execute(ctx, args) {
    const p = await ctx.get();
    const check = goalCheck(p);
    if (args.goalMet && !check.met) {
      return { ok: false, error: `Goal check disagrees — gaps:\n- ${check.gaps.join("\n- ")}\nFix them, or call finish with goalMet=false and list remainingGaps.`, data: check };
    }
    if (!args.goalMet && args.remainingGaps.length === 0 && !check.met) {
      return { ok: false, error: "goalMet=false needs remainingGaps explaining what's left and why.", data: check };
    }
    await ctx.mutate((proj) => {
      addMessage(proj, "assistant", args.summary, ctx.runId);
    });
    await ctx.emit({ type: "goal_check", summary: check.met ? "Goal met" : `${check.gaps.length} gap(s) remain`, ok: check.met, data: check });
    return { ok: true, summary: "Finished", data: check, endRun: "done" };
  },
});
