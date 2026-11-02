import { config } from "../config";
import type { Project } from "../domain/schemas";
import { now } from "../util";
import { LocalStore } from "./local";
import type { Store } from "./types";

export type { Store };

const g = globalThis as unknown as { __roomwiseStore?: Store; __roomwiseTestStore?: boolean; __roomwiseLocks?: Map<string, Promise<unknown>> };

export function getStore(): Store {
  // After a dev hot-reload the cached instance belongs to the old module (and old schema, which
  // would silently strip new fields on save). Rebuild it whenever the classes have been reloaded.
  const current = g.__roomwiseStore instanceof LocalStore;
  if (!g.__roomwiseStore || (!current && !g.__roomwiseTestStore)) g.__roomwiseStore = new LocalStore(config.dataDir);
  return g.__roomwiseStore;
}

/** Test hook. */
export function setStore(s: Store) {
  g.__roomwiseStore = s;
  g.__roomwiseTestStore = true;
}

/**
 * Serialized read-modify-write on one project. The agent and the UI both mutate projects;
 * this prevents lost updates within this server process.
 */
export async function mutateProject<T>(id: string, fn: (p: Project) => T | Promise<T>): Promise<{ project: Project; result: T }> {
  const locks = (g.__roomwiseLocks ??= new Map());
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(id, chained);
  await prev;
  try {
    const store = getStore();
    const project = await store.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    const result = await fn(project);
    project.updatedAt = now();
    await store.saveProject(project);
    return { project, result };
  } finally {
    release();
    if (locks.get(id) === chained) locks.delete(id);
  }
}
