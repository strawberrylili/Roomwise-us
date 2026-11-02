import { handle, HttpError, ownedProject } from "@/lib/server/session";
import { getStore } from "@/lib/store";

/** Photos and renders are private: served only to the project's owner. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ path: string[] }> }) => {
  const { path } = await params;
  if (path.length !== 2) throw new HttpError(404, "Not found");
  await ownedProject(path[0]);
  const file = await getStore().getFile(path.join("/"));
  if (!file) throw new HttpError(404, "Not found");
  return new Response(new Uint8Array(file.data), { headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=31536000, immutable" } });
});
