import type { z } from "zod";
import type { Project, RunEvent } from "../domain/schemas";

export type ToolResult =
  | { ok: true; summary: string; data?: unknown; endRun?: "awaiting_user" | "done" }
  | { ok: false; error: string; retryable?: boolean; needsApproval?: { key: string; reason: string }; data?: unknown };

export type EmitInput = Omit<RunEvent, "seq" | "runId" | "at" | "tool" | "ok" | "durationMs"> &
  Partial<Pick<RunEvent, "tool" | "ok" | "durationMs">>;

export type RunCounters = {
  renders: number;
  toolCalls: number;
  mutated: boolean;
  /** Render kinds that already passed review in this run — no polishing loops after a pass. */
  passedKinds?: ("inspiration" | "shoppable")[];
  shoppableRenders?: number;
};

export interface ToolContext {
  projectId: string;
  ownerId: string;
  runId: string;
  /** Latest user message text in this run — used to verify user-requested constraint changes. */
  userMessage: string;
  counters: RunCounters;
  get(): Promise<Project>;
  mutate<T>(fn: (p: Project) => T | Promise<T>): Promise<T>;
  emit(e: EmitInput): Promise<void>;
}

export interface Tool<P extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: P;
  /** Whether the tool changes project state (drives the "you changed things, call finish" nudge). */
  mutates: boolean;
  execute(ctx: ToolContext, args: z.infer<P>): Promise<ToolResult>;
}

export function defineTool<P extends z.ZodType>(t: Tool<P>): Tool<P> {
  return t;
}

/** Thrown by tools for failures worth retrying (network, rate limit, upstream 5xx). */
export class RetryableError extends Error {}
