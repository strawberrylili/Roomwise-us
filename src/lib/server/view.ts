import { isRunning } from "../agent/runs";
import { goalCheck, staleArtifacts } from "../domain/project";
import type { Project } from "../domain/schemas";

/** Project as the UI sees it: derived state included, model-only fields dropped. */
export function projectView(p: Project) {
  return {
    ...p,
    catalog: undefined,
    catalogCount: p.catalog.length,
    renders: p.renders.map((r) => ({ ...r, prompt: undefined })),
    stale: staleArtifacts(p),
    goal: goalCheck(p),
    running: isRunning(p.id),
  };
}
export type ProjectView = ReturnType<typeof projectView>;
