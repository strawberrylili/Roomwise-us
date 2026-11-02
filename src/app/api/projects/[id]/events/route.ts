import { subscribe } from "@/lib/agent/runs";
import type { RunEvent } from "@/lib/domain/schemas";
import { handle, ownedProject } from "@/lib/server/session";
import { getStore } from "@/lib/store";


/** Server-sent events: replays events after ?after=<seq>, then streams live ones. */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await ownedProject(id);
  const after = Number(new URL(req.url).searchParams.get("after") ?? "0") || 0;
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: RunEvent) => controller.enqueue(encoder.encode(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`));
      let last = after;
      const buffered: RunEvent[] = [];
      let replaying = true;
      const unsubscribe = subscribe(id, (e) => {
        if (replaying) buffered.push(e);
        else if (e.seq > last) {
          last = e.seq;
          send(e);
        }
      });
      const history = (await getStore().listEvents(id, { afterSeq: after })).slice(-300);
      for (const e of [...history, ...buffered].sort((a, b) => a.seq - b.seq)) {
        if (e.seq <= last) continue;
        last = e.seq;
        send(e);
      }
      replaying = false;
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
});
