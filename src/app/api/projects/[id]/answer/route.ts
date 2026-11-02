import { z } from "zod";
import { RunConflictError, startRun } from "@/lib/agent/runs";
import { handle, HttpError, ownedProject } from "@/lib/server/session";
import { mutateProject } from "@/lib/store";
import { now } from "@/lib/util";

const Body = z.strictObject({ questionId: z.string(), answer: z.string().trim().min(1).max(2000), approve: z.boolean().optional() });

/** Answer the agent's pending question. Approvals are recorded in code before the agent resumes. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const p = await ownedProject(id);
  const body = Body.parse(await req.json());
  const q = p.pending;
  if (!q || q.id !== body.questionId) throw new HttpError(409, "That question is no longer open");
  if (q.kind === "approval" && q.approvalKey) {
    const granted = body.approve ?? /^(approve|yes|ok|go|sure)/i.test(body.answer);
    await mutateProject(id, (proj) => void proj.approvals.push({ key: q.approvalKey!, granted, at: now() }));
  }
  try {
    const { runId } = await startRun({ projectId: id, ownerId: p.ownerId, message: `${body.answer}\n\n(answering: "${q.question}")` });
    return Response.json({ runId }, { status: 202 });
  } catch (e) {
    if (e instanceof RunConflictError) throw new HttpError(409, e.message);
    throw e;
  }
});
