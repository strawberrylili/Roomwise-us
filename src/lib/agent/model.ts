import type OpenAI from "openai";
import { z } from "zod";
import { openai } from "../ai/openai";
import { config } from "../config";
import type { Tool } from "./types";

export type ToolCall = { callId: string; name: string; args: string };
export type ModelTurn = { id: string; text: string; calls: ToolCall[] };
export type ModelInput =
  | { kind: "message"; role: "user" | "developer"; text: string }
  | { kind: "tool_output"; callId: string; output: string };

/** The orchestrator's view of the LLM — swappable for a scripted fake in tests. */
export interface AgentModel {
  respond(opts: { instructions: string; input: ModelInput[]; tools: Tool[]; previousId: string | null }): Promise<ModelTurn>;
}

export class OpenAIAgentModel implements AgentModel {
  async respond({ instructions, input, tools, previousId }: Parameters<AgentModel["respond"]>[0]): Promise<ModelTurn> {
    const res = await openai().responses.create({
      model: config.models.orchestrator,
      instructions,
      reasoning: { effort: "medium" },
      previous_response_id: previousId ?? undefined,
      parallel_tool_calls: false,
      tools: tools.map(toFunctionTool),
      input: input.map((i): OpenAI.Responses.ResponseInputItem =>
        i.kind === "message"
          ? { role: i.role, content: i.text }
          : { type: "function_call_output", call_id: i.callId, output: i.output },
      ),
    });
    const calls: ToolCall[] = [];
    for (const item of res.output) {
      if (item.type === "function_call") calls.push({ callId: item.call_id, name: item.name, args: item.arguments });
    }
    return { id: res.id, text: res.output_text ?? "", calls };
  }
}

function toFunctionTool(t: Tool): OpenAI.Responses.FunctionTool {
  const schema = z.toJSONSchema(t.parameters, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return { type: "function", name: t.name, description: t.description, parameters: schema, strict: false };
}
