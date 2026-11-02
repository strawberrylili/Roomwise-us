import { z } from "zod";
import { handle, HttpError, ownedProject } from "@/lib/server/session";
import { projectView } from "@/lib/server/view";
import { mutateProject } from "@/lib/store";
import { now } from "@/lib/util";

const Body = z.strictObject({ done: z.boolean() });

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) => {
  const { id, taskId } = await params;
  await ownedProject(id);
  const { done } = Body.parse(await req.json());
  const { project } = await mutateProject(id, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) throw new HttpError(404, "Unknown task");
    t.done = done;
    t.doneAt = done ? now() : null;
  });
  return Response.json(projectView(project));
});
