import { handle, HttpError, ownedProject } from "@/lib/server/session";
import { projectView } from "@/lib/server/view";
import { mutateProject } from "@/lib/store";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) => {
  const { id, photoId } = await params;
  const p = await ownedProject(id);
  if (p.renders.some((r) => r.photoId === photoId)) throw new HttpError(409, "This photo has renders based on it");
  const { project } = await mutateProject(id, (proj) => {
    proj.photos = proj.photos.filter((x) => x.id !== photoId);
  });
  return Response.json(projectView(project));
});
