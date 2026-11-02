import { z } from "zod";
import { createProject } from "@/lib/domain/project";
import { handle, ownerId } from "@/lib/server/session";
import { getStore } from "@/lib/store";

export const GET = handle(async () => {
  const owner = await ownerId();
  const projects = await getStore().listProjects(owner);
  return Response.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      cover: p.renders.find((r) => r.id === p.chosenRenderId)?.path ?? p.renders.at(-1)?.path ?? p.photos[0]?.path ?? null,
      budget: p.brief?.budget ?? null,
      total: p.shoppingList?.total ?? null,
      tasks: { done: p.tasks.filter((t) => t.done).length, total: p.tasks.length },
      phase: p.tasks.length ? "Plan ready" : p.renders.length ? "Designing" : p.room ? "Room analyzed" : p.photos.length ? "Photos uploaded" : "New",
    })),
  );
});

const Create = z.strictObject({ name: z.string().trim().min(1).max(80).default("My room") });

export const POST = handle(async (req: Request) => {
  const owner = await ownerId();
  const { name } = Create.parse(await req.json().catch(() => ({})));
  const p = createProject(owner, name);
  await getStore().saveProject(p);
  return Response.json({ id: p.id }, { status: 201 });
});
