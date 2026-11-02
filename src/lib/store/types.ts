import type { Preferences, Project, RunEvent } from "../domain/schemas";

export interface Store {
  listProjects(ownerId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;

  appendEvent(projectId: string, e: RunEvent): Promise<void>;
  listEvents(projectId: string, opts?: { runId?: string; afterSeq?: number }): Promise<RunEvent[]>;

  getPreferences(ownerId: string): Promise<Preferences | null>;
  savePreferences(ownerId: string, prefs: Preferences): Promise<void>;

  /** Returns an opaque storage path, served by /api/files/<path>. */
  putFile(projectId: string, name: string, data: Buffer, contentType: string): Promise<string>;
  getFile(path: string): Promise<{ data: Buffer; contentType: string } | null>;
}
