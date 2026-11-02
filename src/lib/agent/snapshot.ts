import { goalCheck, latestRender, roomTypeOf, selectedDirection, staleArtifacts } from "../domain/project";
import { roomLabel } from "../domain/rooms";
import type { Preferences, Project } from "../domain/schemas";

/** Compact, model-facing view of the project. Rebuilt each run so context survives across sessions. */
export function snapshot(p: Project, prefs: Preferences | null): string {
  const dir = selectedDirection(p);
  const render = latestRender(p, "shoppable");
  const inspo = latestRender(p, "inspiration");
  const crit = (r: typeof render) =>
    r?.critique ? `${r.critique.pass ? "PASS" : "FAIL"} room${r.critique.structure}/design${r.critique.designQuality ?? "-"}/products${r.critique.productFidelity ?? "-"}/brief${r.critique.briefFit} issues: ${r.critique.issues.join("; ")}` : "not reviewed";
  const catCounts = Object.entries(
    p.catalog.reduce<Record<string, number>>((acc, x) => ((acc[x.category] = (acc[x.category] ?? 0) + 1), acc), {}),
  ).map(([k, n]) => `${k}:${n}`);
  const check = goalCheck(p);
  const lines = [
    `MODE: ${p.autopilot ? "AUTOPILOT — decide yourself, never ask" : "interactive — ask the user when an answer would change the design"}`,
    `PHOTOS: ${p.photos.filter((x) => x.kind === "room").map((x) => x.id).join(", ") || "none"}`,
    p.room
      ? `ROOM: designing a ${roomLabel(roomTypeOf(p))}${p.brief?.functions.length ? ` for ${p.brief.functions.join(", ")}` : ""} (photos look like: ${roomLabel(p.room.roomType)}) | ${p.room.summary} | bed=${p.room.bedSize} | lampSurfaces=${p.room.lampSurfaces} | dims=${p.room.dimensions.widthFt ?? "?"}x${p.room.dimensions.lengthFt ?? "?"}ft (${p.room.dimensions.source}) | confirmed=${p.room.confirmed}
  furniture: ${p.room.furniture.map((f) => `${f.name}${f.keep === true ? " [KEEP]" : f.keep === false ? " [can replace]" : ""}`).join("; ")}
  questions: ${p.room.questions.map((q) => `${q.id} "${q.question}" → ${q.answer ?? "UNANSWERED"}`).join("; ") || "none"}`
      : "ROOM: not analyzed",
    p.brief ? `BRIEF: ${JSON.stringify(p.brief)}` : "BRIEF: none yet",
    `PREFERENCES: ${prefs ? JSON.stringify(prefs) : "none recorded"}`,
    `DIRECTIONS: ${p.directions.map((d) => `${d.id} "${d.name}" ~$${d.estimatedCost}${d.id === p.selectedDirectionId ? " [SELECTED]" : ""}`).join("; ") || "none"}`,
    dir ? `SELECTED DIRECTION: ${dir.summary} Layout: ${dir.layout || "unchanged"} Pieces: ${dir.pieces.join("; ") || dir.moves.map((m) => m.title).join("; ")} Palette: ${dir.palette.map((c) => c.name).join(", ")}` : "",
    inspo ? `INSPIRATION RENDER: ${inspo.id}${inspo.revisionNote ? ` revision="${inspo.revisionNote}"` : ""} critique=${crit(inspo)}` : "INSPIRATION RENDER: none",
    `CATALOG: ${p.catalog.length} products (${catCounts.join(", ") || "empty"})`,
    p.shoppingList
      ? `SHOPPING LIST: $${p.shoppingList.total}${p.shoppingList.budget ? `/$${p.shoppingList.budget}` : " (no budget limit)"} — ${p.shoppingList.lines.map((l) => `${l.productId} ${l.product.name} x${l.qty} $${l.lineTotal}`).join("; ")}${
          p.shoppingList.warnings.length ? `\n  warnings: ${p.shoppingList.warnings.join("; ")}` : ""
        }`
      : "SHOPPING LIST: none",
    render
      ? `SHOPPABLE RENDER: ${render.id}${render.revisionNote ? ` revision="${render.revisionNote}"` : ""} critique=${crit(render)}`
      : "SHOPPABLE RENDER: none (optional bonus)",
    p.chosenRenderId ? `USER'S CHOSEN RENDER: ${p.chosenRenderId}` : "",
    `TASKS: ${p.tasks.length} (${p.tasks.filter((t) => t.done).length} done)`,
    `STALE (upstream changed, needs rebuild): ${staleArtifacts(p).join(", ") || "nothing"}`,
    p.pending ? `PENDING QUESTION (user may be answering it now): [${p.pending.kind}] ${p.pending.question}` : "",
    `DECISIONS: ${p.decisions.slice(-8).map((d) => d.text).join(" | ") || "none"}`,
    `GOAL CHECK GAPS: ${check.gaps.join(" | ") || "none — plan complete"}`,
  ];
  return lines.filter(Boolean).join("\n");
}
