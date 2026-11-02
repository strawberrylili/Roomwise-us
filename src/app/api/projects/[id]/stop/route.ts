import { stopRun } from "@/lib/agent/runs";
import { handle, ownedProject } from "@/lib/server/session";

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await ownedProject(id);
  stopRun(id);
  return new Response(null, { status: 204 });
});
