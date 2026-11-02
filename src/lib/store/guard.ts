import { Project } from "../domain/schemas";

/**
 * Parse a project for saving, refusing to silently drop data. Zod strips unknown keys; if a field
 * the caller set disappears, the code that wrote it and the schema in this process disagree
 * (e.g. a dev server running stale modules). Losing user data quietly is worse than failing.
 */
export function parseForSave(input: unknown) {
  const parsed = Project.parse(input);
  const dropped = droppedPaths(input, parsed);
  if (dropped.length) {
    throw new Error(`Refusing to save: these fields would be dropped by the project schema: ${dropped.slice(0, 5).join(", ")}. If you're running the dev server, restart it.`);
  }
  return parsed;
}

function droppedPaths(before: unknown, after: unknown, path = ""): string[] {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    if (Array.isArray(before) && Array.isArray(after)) return before.flatMap((b, i) => droppedPaths(b, after[i], `${path}[${i}]`));
    return [];
  }
  return Object.keys(before).flatMap((k) => {
    if (before[k] === undefined) return [];
    const p = path ? `${path}.${k}` : k;
    return k in after ? droppedPaths(before[k], after[k], p) : [p];
  });
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
