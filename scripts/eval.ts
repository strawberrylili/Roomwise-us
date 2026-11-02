/**
 * Headless eval: runs the real agent on fixed scenarios, auto-answers its questions, applies a
 * revision, and scores the outcome. Usage: npm run eval [-- --faults "search_products:1:retryable"]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const faultsIdx = args.indexOf("--faults");
if (faultsIdx >= 0) process.env.ROOMWISE_FAULTS = args[faultsIdx + 1];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
process.env.ROOMWISE_DATA_DIR = join(".data-eval-us", stamp);

type Scenario = {
  name: string;
  photos: string[];
  brief: import("../src/lib/domain/schemas").Brief;
  kickoff: string;
  revision?: string;
  answers?: Record<string, string>;
};

async function main() {
  const { createProject, goalCheck } = await import("../src/lib/domain/project");
  const { getStore, mutateProject } = await import("../src/lib/store");
  const { startRun } = await import("../src/lib/agent/runs");
  const { normalizePhoto } = await import("../src/lib/server/images");
  const { validateShoppingList } = await import("../src/lib/domain/validators");
  const { newId, now } = await import("../src/lib/util");

  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const scenarios: Scenario[] = (JSON.parse(await readFile("eval/scenarios.json", "utf8")) as Scenario[]).filter((s) => !only || s.name === only);
  const store = getStore();
  const report: string[] = [`# Eval ${stamp}`, `Faults: ${process.env.ROOMWISE_FAULTS || "none"}`, ""];

  for (const sc of scenarios) {
    const owner = "eval-owner";
    const p = createProject(owner, sc.name);
    p.brief = sc.brief;
    for (const path of sc.photos) {
      const raw = await readFile(path);
      const img = await normalizePhoto(raw, path, "image/jpeg");
      const id = newId("ph");
      p.photos.push({ id, path: await store.putFile(p.id, `${id}.jpg`, img.data, "image/jpeg"), width: img.width, height: img.height, kind: "room", emptyPath: null, createdAt: now() });
    }
    await store.saveProject(p);
    console.log(`\n=== ${sc.name} (${p.id}) ===`);

    const runLog: { label: string; status: string; tools: string[]; seconds: number }[] = [];
    async function converse(message: string, label: string) {
      let msg = message;
      for (let turn = 0; turn < 8; turn++) {
        const t0 = Date.now();
        const { runId, done } = await startRun({ projectId: p.id, ownerId: owner, message: msg });
        await done;
        const proj = (await store.getProject(p.id))!;
        const run = proj.runs.find((r) => r.id === runId)!;
        const events = await store.listEvents(p.id, { runId });
        const tools = events.filter((e) => e.type === "tool_result").map((e) => `${e.tool}${e.ok ? "" : "✗"}`);
        runLog.push({ label: `${label}#${turn + 1}`, status: run.status, tools, seconds: Math.round((Date.now() - t0) / 1000) });
        console.log(`  [${label}#${turn + 1}] ${run.status} in ${Math.round((Date.now() - t0) / 1000)}s: ${tools.join(" → ")}`);
        for (const e of events.filter((e) => e.type === "retry" || e.type === "validator" || e.type === "error")) console.log(`      ${e.type}: ${e.summary}`);
        if (run.status !== "awaiting_user" || !proj.pending) return proj;
        const q = proj.pending;
        console.log(`      Q(${q.kind}): ${q.question} [${q.options.join(" | ")}]`);
        if (q.kind === "approval" && q.approvalKey) {
          await mutateProject(p.id, (x) => void x.approvals.push({ key: q.approvalKey!, granted: true, at: now() }));
          msg = "Approve";
        } else {
          const hints = Object.entries(sc.answers ?? {}).filter(([k]) => new RegExp(`\\b${k}\\b`, "i").test(q.question)).map(([, v]) => v);
          const hint = hints.length ? hints.join(" ") : undefined;
          msg = hint ?? `${q.options[0] ?? "Use your best judgement"}. Use your best judgement for anything else.`;
        }
        console.log(`      A: ${msg}`);
      }
      return (await store.getProject(p.id))!;
    }

    let proj = await converse(sc.kickoff, "kickoff");
    const primary = sc.brief.intensity === "refresh" ? "shoppable" : "inspiration";
    const afterKickoff = { directionsVersion: proj.versions.directions, renders: proj.renders.filter((r) => r.kind === primary).length };
    if (sc.revision) proj = await converse(sc.revision, "revision");

    const g = goalCheck(proj);
    const list = proj.shoppingList;
    const render = proj.renders.findLast((r) => r.kind === primary);
    const shop = proj.renders.findLast((r) => r.kind === "shoppable");
    const revalidated = list && proj.brief ? validateShoppingList(list.lines, proj.catalog, proj.brief, proj.room) : null;
    const links = list ? await Promise.all(list.lines.map((l) => fetch(l.product.url, { method: "HEAD", redirect: "follow" }).then((r) => r.ok).catch(() => false))) : [];

    const metrics: [string, boolean | null, string][] = [
      ["Goal check met", g.met, g.gaps.join("; ") || "all checks pass"],
      ["Within budget", list && sc.brief.budget !== null ? list.total <= sc.brief.budget : null, list ? `$${list.total} / ${sc.brief.budget === null ? "no limit" : `$${sc.brief.budget}`}` : "no list"],
      ["Hard constraints (re-validated)", revalidated ? revalidated.errors.length === 0 : null, revalidated?.errors.join("; ") || "ok"],
      ["Room structure preserved (critic ≥7)", render?.critique ? render.critique.structure >= 7 : null, render?.critique ? `${render.critique.structure}/10` : "no critique"],
      ["Design quality (critic ≥7)", render?.critique?.designQuality != null ? render.critique.designQuality >= 7 : null, render?.critique?.designQuality != null ? `${render.critique.designQuality}/10` : "n/a"],
      ["Shoppable render ↔ list (critic ≥6, bonus)", shop?.critique?.productFidelity != null ? shop.critique.productFidelity >= 6 : null, shop?.critique?.productFidelity != null ? `${shop.critique.productFidelity}/10` : "no shoppable render"],
      ["Product links live", links.length ? links.every(Boolean) : null, `${links.filter(Boolean).length}/${links.length}`],
      ["Revision applied with a new render", sc.revision ? proj.renders.filter((r) => r.kind === primary).length > afterKickoff.renders : null, `${proj.renders.filter((r) => r.kind === primary).length - afterKickoff.renders} new ${primary} render(s)`],
      ["Revision didn't redo the design direction", sc.revision ? proj.versions.directions === afterKickoff.directionsVersion : null, `directions v${afterKickoff.directionsVersion} → v${proj.versions.directions}`],
    ];

    report.push(`## ${sc.name}`, "", "| Metric | Result | Detail |", "| --- | --- | --- |");
    for (const [name, ok, detail] of metrics) report.push(`| ${name} | ${ok === null ? "n/a" : ok ? "PASS" : "FAIL"} | ${detail.replace(/\|/g, "/")} |`);
    report.push("", "### Runs", "", ...runLog.map((r) => `- **${r.label}** ${r.status}, ${r.seconds}s: ${r.tools.join(" → ")}`), "");
    if (list) report.push("### Shopping list", "", ...list.lines.map((l) => `- ${l.qty}× ${l.product.name} — ${l.product.type} ($${l.lineTotal}) — ${l.placement}`), "");
    report.push(`Project data: ${process.env.ROOMWISE_DATA_DIR}/projects/${p.id}.json`, "");
    console.log(metrics.map(([n, ok, d]) => `  ${ok === null ? "n/a " : ok ? "PASS" : "FAIL"} ${n}: ${d}`).join("\n"));
  }

  await mkdir("eval/reports", { recursive: true });
  const out = `eval/reports/${stamp}.md`;
  await writeFile(out, report.join("\n"));
  console.log(`\nReport: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
