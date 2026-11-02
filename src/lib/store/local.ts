import { mkdir, readFile, readdir, rename, rm, writeFile, appendFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { Preferences, Project, RunEvent } from "../domain/schemas";
import { parseForSave } from "./guard";
import type { Store } from "./types";

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** File-backed store for local development: one JSON doc per project, JSONL event log, files on disk. */
export class LocalStore implements Store {
  constructor(private root: string) {}

  private projectPath = (id: string) => join(this.root, "projects", `${safe(id)}.json`);
  private eventsPath = (id: string) => join(this.root, "events", `${safe(id)}.jsonl`);
  private prefsPath = (owner: string) => join(this.root, "preferences", `${safe(owner)}.json`);

  async listProjects(ownerId: string) {
    const dir = join(this.root, "projects");
    const names = await readdir(dir).catch(() => [] as string[]);
    const all = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => this.getProject(n.slice(0, -5))));
    return all.filter((p): p is Project => !!p && p.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string) {
    const raw = await readFile(this.projectPath(id), "utf8").catch(() => null);
    return raw ? Project.parse(JSON.parse(raw)) : null;
  }

  async saveProject(p: Project) {
    await atomicWrite(this.projectPath(p.id), JSON.stringify(parseForSave(p)));
  }

  async deleteProject(id: string) {
    await rm(this.projectPath(id), { force: true });
    await rm(this.eventsPath(id), { force: true });
    await rm(join(this.root, "files", safe(id)), { recursive: true, force: true });
  }

  async appendEvent(projectId: string, e: RunEvent) {
    const path = this.eventsPath(projectId);
    await mkdir(join(path, ".."), { recursive: true });
    await appendFile(path, JSON.stringify(e) + "\n");
  }

  async listEvents(projectId: string, opts: { runId?: string; afterSeq?: number } = {}) {
    const raw = await readFile(this.eventsPath(projectId), "utf8").catch(() => "");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => RunEvent.parse(JSON.parse(l)))
      .filter((e) => (!opts.runId || e.runId === opts.runId) && (opts.afterSeq === undefined || e.seq > opts.afterSeq));
  }

  async getPreferences(ownerId: string) {
    const raw = await readFile(this.prefsPath(ownerId), "utf8").catch(() => null);
    return raw ? Preferences.parse(JSON.parse(raw)) : null;
  }

  async savePreferences(ownerId: string, prefs: Preferences) {
    await atomicWrite(this.prefsPath(ownerId), JSON.stringify(prefs));
  }

  async putFile(projectId: string, name: string, data: Buffer) {
    const rel = `${safe(projectId)}/${safe(name)}`;
    await atomicWrite(join(this.root, "files", rel), data);
    return rel;
  }

  async getFile(path: string) {
    const rel = normalize(path);
    if (rel.startsWith("..") || rel.includes("/../") || rel.startsWith("/")) return null;
    const data = await readFile(join(this.root, "files", rel)).catch(() => null);
    if (!data) return null;
    return { data, contentType: CONTENT_TYPES[rel.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" };
  }
}

function safe(s: string) {
  if (!/^[\w.-]+$/.test(s) || s.startsWith(".")) throw new Error(`Unsafe path segment: ${s}`);
  return s;
}

async function atomicWrite(path: string, data: string | Buffer) {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}
