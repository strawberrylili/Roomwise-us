import { config } from "../config";
import { newId, now } from "../util";
import type { RoomType } from "./rooms";
import type { ArtifactKey, GoalCheck, Project } from "./schemas";

/** What each artifact is derived from. Changing an upstream artifact makes downstream ones stale. */
export const DEPENDENCIES: Record<ArtifactKey, ArtifactKey[]> = {
  room: [],
  brief: [],
  directions: ["room", "brief"],
  inspiration: ["directions"],
  shopping: ["directions", "room", "brief"],
  render: ["shopping", "directions"],
  tasks: ["shopping"],
};

export function createProject(ownerId: string, name: string): Project {
  const t = now();
  return {
    id: newId("prj"),
    ownerId,
    name,
    createdAt: t,
    updatedAt: t,
    photos: [],
    room: null,
    brief: null,
    directions: [],
    selectedDirectionId: null,
    catalog: [],
    shoppingList: null,
    renders: [],
    chosenRenderId: null,
    tasks: [],
    messages: [],
    pending: null,
    autopilot: false,
    approvals: [],
    decisions: [],
    versions: { room: 0, brief: 0, directions: 0, inspiration: 0, shopping: 0, render: 0, tasks: 0 },
    basedOn: {},
    runs: [],
  };
}

/** Record that `key` changed, and stamp it with the upstream versions it was built from. */
export function bump(p: Project, key: ArtifactKey) {
  p.versions[key] += 1;
  p.basedOn[key] = Object.fromEntries(DEPENDENCIES[key].map((d) => [d, p.versions[d]]));
}

export function exists(p: Project, key: ArtifactKey): boolean {
  switch (key) {
    case "room":
      return p.room !== null;
    case "brief":
      return p.brief !== null;
    case "directions":
      return p.directions.length > 0;
    case "shopping":
      return p.shoppingList !== null;
    case "inspiration":
      return p.renders.some((r) => r.kind === "inspiration");
    case "render":
      return p.renders.some((r) => r.kind === "shoppable");
    case "tasks":
      return p.tasks.length > 0;
  }
}

/** Stale = exists, but some upstream artifact changed (directly or transitively) since it was built. */
export function isStale(p: Project, key: ArtifactKey, seen = new Set<ArtifactKey>()): boolean {
  if (!exists(p, key) || seen.has(key)) return false;
  seen.add(key);
  const stamp = p.basedOn[key] ?? {};
  return DEPENDENCIES[key].some((d) => (stamp[d] ?? 0) !== p.versions[d] || isStale(p, d, seen));
}

export function staleArtifacts(p: Project): ArtifactKey[] {
  return (Object.keys(DEPENDENCIES) as ArtifactKey[]).filter((k) => isStale(p, k));
}

export function latestRender(p: Project, kind: "inspiration" | "shoppable" = "shoppable") {
  return p.renders.findLast((r) => r.kind === kind) ?? null;
}

/** The space we're designing: the user's stated type wins over what the photos suggest. */
export function roomTypeOf(p: Project): RoomType {
  return p.brief?.roomType ?? p.room?.roomType ?? "bedroom";
}

export function selectedDirection(p: Project) {
  return p.directions.find((d) => d.id === p.selectedDirectionId) ?? null;
}

export function hasApproval(p: Project, key: string) {
  return p.approvals.some((a) => a.key === key && a.granted);
}

export function addDecision(p: Project, text: string) {
  p.decisions.push({ at: now(), text });
  if (p.decisions.length > 60) p.decisions.splice(0, p.decisions.length - 60);
}

export function addMessage(p: Project, role: "user" | "assistant", text: string, runId: string | null) {
  const m = { id: newId("msg"), role, text, runId, createdAt: now() };
  p.messages.push(m);
  return m;
}

/** Deterministic "did we deliver a complete, valid makeover plan?" check. */
export function goalCheck(p: Project): GoalCheck {
  const checks: GoalCheck["checks"] = [];
  const add = (name: string, ok: boolean, detail: string, optional = false) => checks.push({ name, ok, detail, optional });

  add("Room analyzed", p.room !== null, p.room ? p.room.summary.slice(0, 80) : "No room analysis yet");
  const open = p.room?.questions.filter((q) => !q.answer) ?? [];
  add("Room details confirmed", !!p.room && (p.room.confirmed || open.length === 0), open.length ? `${open.length} open question(s)` : "Confirmed");
  add("Brief", p.brief !== null, !p.brief ? "No brief yet" : `${p.brief.intensity} · ${p.brief.budget ? `$${p.brief.budget} ${config.currency}` : "no budget limit"}`);
  add("Design direction chosen", selectedDirection(p) !== null, selectedDirection(p)?.name ?? "None selected");

  const inspo = latestRender(p, "inspiration");
  add("Inspiration render", !!inspo && !isStale(p, "inspiration"), !inspo ? "No concept render yet" : isStale(p, "inspiration") ? "Out of date with the direction" : "Up to date");
  add(
    "Design passed review",
    !!inspo?.critique?.pass,
    !inspo ? "No render" : !inspo.critique ? "Not reviewed yet" : inspo.critique.pass ? "Passed" : inspo.critique.issues.slice(0, 2).join("; "),
  );

  const list = p.shoppingList;
  add("Shopping list", !!list && !isStale(p, "shopping"), !list ? "None yet" : isStale(p, "shopping") ? "Out of date" : `${list.lines.length} items`);
  if (list && p.brief?.budget) {
    add("Within budget", list.total <= p.brief.budget, `$${list.total.toFixed(2)} of $${p.brief.budget}`);
  }
  const shop = latestRender(p, "shoppable");
  add(
    "Shoppable render",
    !!shop && !isStale(p, "render") && !!shop.critique?.pass,
    !shop ? "Optional — the room with the real products" : isStale(p, "render") ? "Out of date" : !shop.critique ? "Not reviewed" : shop.critique.pass ? "Passed" : "Needs work",
    true,
  );
  add("Implementation checklist", p.tasks.length > 0 && !isStale(p, "tasks"), p.tasks.length === 0 ? "None yet" : isStale(p, "tasks") ? "Out of date" : `${p.tasks.length} tasks`);

  const gaps = checks.filter((c) => !c.ok && !c.optional).map((c) => `${c.name}: ${c.detail}`);
  return { met: gaps.length === 0, gaps, checks };
}
