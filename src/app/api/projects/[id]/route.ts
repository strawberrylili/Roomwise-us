import { z } from "zod";
import { isRunning } from "@/lib/agent/runs";
import { bump } from "@/lib/domain/project";
import { Brief } from "@/lib/domain/schemas";
import { handle, HttpError, ownedProject } from "@/lib/server/session";
import { projectView } from "@/lib/server/view";
import { getStore, mutateProject } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const p = await ownedProject((await params).id);
  return Response.json(projectView(p));
});

// Strict: an unknown field means client and server disagree — reject it rather than drop it.
const Patch = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  brief: Brief.strict().optional(),
  chosenRenderId: z.string().nullable().optional(),
  autopilot: z.boolean().optional(),
  room: z
    .strictObject({
      confirmed: z.boolean().optional(),
      bedSize: z.enum(["twin", "full", "queen", "king", "unknown"]).optional(),
      answers: z.array(z.object({ questionId: z.string(), answer: z.string().max(300) })).optional(),
    })
    .optional(),
});

/** Direct edits from the UI. The user editing their own constraints needs no approval. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await ownedProject(id);
  const body = Patch.parse(await req.json());
  const { project } = await mutateProject(id, (p) => {
    if (body.name) p.name = body.name;
    if (body.autopilot !== undefined) p.autopilot = body.autopilot;
    if (body.brief && JSON.stringify(body.brief) !== JSON.stringify(p.brief)) {
      p.brief = body.brief;
      bump(p, "brief");
    }
    if (body.chosenRenderId !== undefined) {
      if (body.chosenRenderId && !p.renders.some((r) => r.id === body.chosenRenderId)) throw new HttpError(400, "Unknown render");
      p.chosenRenderId = body.chosenRenderId;
    }
    if (body.room && p.room) {
      const facts = () => JSON.stringify({ ...p.room, questions: undefined, confirmed: undefined });
      const before = facts();
      if (body.room.bedSize) p.room.bedSize = body.room.bedSize;
      for (const a of body.room.answers ?? []) {
        const q = p.room.questions.find((x) => x.id === a.questionId);
        if (q) q.answer = a.answer;
      }
      if (body.room.confirmed !== undefined) p.room.confirmed = body.room.confirmed;
      if (facts() !== before) bump(p, "room");
    }
  });
  return Response.json(projectView(project));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await ownedProject(id);
  if (isRunning(id)) throw new HttpError(409, "Stop the designer before deleting");
  await getStore().deleteProject(id);
  return new Response(null, { status: 204 });
});
