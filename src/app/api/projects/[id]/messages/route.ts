import { z } from "zod";
import { RunConflictError, startRun } from "@/lib/agent/runs";
import { handle, HttpError, ownedProject } from "@/lib/server/session";

const Body = z.strictObject({ text: z.string().trim().min(1).max(4000) });

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const p = await ownedProject(id);
  const { text } = Body.parse(await req.json());
  try {
    const { runId } = await startRun({ projectId: id, ownerId: p.ownerId, message: text });
    return Response.json({ runId }, { status: 202 });
  } catch (e) {
    if (e instanceof RunConflictError) throw new HttpError(409, e.message);
    throw e;
  }
});
