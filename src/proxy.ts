import { NextResponse, type NextRequest } from "next/server";

export const OWNER_COOKIE = "roomwise_uid";

/**
 * Anonymous identity: every browser gets a random owner id so projects persist across sessions.
 * This is not authentication — the server binds to 127.0.0.1 only. Before exposing it beyond
 * localhost, replace this with real auth and check ownership against it.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get(OWNER_COOKIE)?.value) return NextResponse.next();
  const id = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("cookie", [request.headers.get("cookie"), `${OWNER_COOKIE}=${id}`].filter(Boolean).join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(OWNER_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
