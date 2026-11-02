import { cookies } from "next/headers";
import { reconcileRuns } from "../agent/runs";
import { getStore } from "../store";

const OWNER_COOKIE = "roomwise_uid";

export async function ownerId(): Promise<string> {
  const id = (await cookies()).get(OWNER_COOKIE)?.value;
  if (!id || !/^[\w-]{8,64}$/.test(id)) throw new HttpError(401, "No session");
  return id;
}

export async function ownedProject(id: string) {
  const owner = await ownerId();
  if (!/^[\w-]+$/.test(id)) throw new HttpError(404, "Not found");
  await reconcileRuns(id);
  const p = await getStore().getProject(id);
  if (!p || p.ownerId !== owner) throw new HttpError(404, "Not found");
  return p;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps a route handler: HttpError → its status, ZodError → 400, anything else → 500. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e && typeof e === "object" && "issues" in e) return Response.json({ error: "Invalid request", issues: (e as { issues: unknown }).issues }, { status: 400 });
      console.error(e);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
