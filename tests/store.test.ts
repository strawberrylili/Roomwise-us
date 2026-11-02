import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject } from "../src/lib/domain/project";
import { LocalStore } from "../src/lib/store/local";
import { brief } from "./fixtures";

describe("store never silently drops data", () => {
  it("round-trips every field the schema knows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roomwise-store-"));
    const store = new LocalStore(dir);
    const p = createProject("o", "x");
    p.brief = brief({ roomType: "living_dining", functions: ["Relax", "Dine"] });
    p.autopilot = true;
    await store.saveProject(p);
    const back = await store.getProject(p.id);
    expect(back?.brief).toEqual(p.brief);
    expect(back?.autopilot).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses to save when the schema would strip a field (the stale-dev-server bug)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roomwise-store-"));
    const store = new LocalStore(dir);
    const p = createProject("o", "x");
    // A field this process's schema doesn't know — what a stale module sees after an upgrade.
    const withNewField = { ...p, brief: { ...brief(), someFutureField: ["x"] }, anotherNewFlag: true };
    await expect(store.saveProject(withNewField as never)).rejects.toThrow(/brief\.someFutureField, anotherNewFlag/);
    expect(await store.getProject(p.id)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});
