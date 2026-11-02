import { normalizePhoto } from "@/lib/server/images";
import { handle, HttpError, ownedProject } from "@/lib/server/session";
import { projectView } from "@/lib/server/view";
import { getStore, mutateProject } from "@/lib/store";
import type { Photo } from "@/lib/domain/schemas";
import { newId, now } from "@/lib/util";

const MAX_PHOTOS = 5;
const MAX_BYTES = 25 * 1024 * 1024;

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const p = await ownedProject(id);
  const form = await req.formData();
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  const kind = form.get("kind") === "progress" ? "progress" : "room";
  if (files.length === 0) throw new HttpError(400, "No photos in upload");
  if (kind === "room" && p.photos.filter((x) => x.kind === "room").length + files.length > MAX_PHOTOS) throw new HttpError(400, `Up to ${MAX_PHOTOS} room photos`);
  const photos: Photo[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) throw new HttpError(413, `${f.name} is over 25 MB`);
    const img = await normalizePhoto(Buffer.from(await f.arrayBuffer()), f.name, f.type);
    const photoId = newId("ph");
    const path = await getStore().putFile(id, `${photoId}.jpg`, img.data, "image/jpeg");
    photos.push({ id: photoId, path, width: img.width, height: img.height, kind, emptyPath: null, createdAt: now() });
  }
  const { project } = await mutateProject(id, (proj) => void proj.photos.push(...photos));
  return Response.json(projectView(project), { status: 201 });
});
