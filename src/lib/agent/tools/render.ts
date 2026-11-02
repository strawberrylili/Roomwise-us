import { z } from "zod";
import OpenAI from "openai";
import { editImage, structured, toDataUrl } from "../../ai/openai";
import { fetchProductImage } from "../../catalog/ikea";
import { config } from "../../config";
import { bump, hasApproval, isStale, roomTypeOf, selectedDirection, staleArtifacts } from "../../domain/project";
import { ROOM_RULES } from "../../domain/rooms";
import type { Direction, Photo, Project, Render } from "../../domain/schemas";
import { getStore } from "../../store";
import { newId, now } from "../../util";
import { defineTool, RetryableError, type ToolContext, type ToolResult } from "../types";

const MAX_REFS = 14;
type Img = { data: Buffer; name: string; type: string };

export const renderConcept = defineTool({
  name: "render_concept",
  description:
    "Render the INSPIRATION image: the selected concept at full ambition in the client's real room. For redesigns or layout changes the room is first emptied (architecture only) and then furnished from scratch, so the design isn't anchored to the old furniture. This is the primary visual deliverable. Use revisionNote for client tweaks and fixInstructions to address a failed critique.",
  parameters: z.object({
    photoId: z.string().optional(),
    revisionNote: z.string().optional(),
    fixInstructions: z.string().optional(),
  }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const dir = selectedDirection(p);
    if (!dir) return { ok: false, error: "Select a design concept first." };
    if (!dir.renderPrompt) return { ok: false, error: "This direction has no concept detail — regenerate it with generate_design_plan." };
    const photo = pickPhoto(p, args.photoId);
    if (!photo) return { ok: false, error: "No room photo uploaded." };
    const gate = renderGate(ctx, p, "inspiration", args.revisionNote);
    if (gate) return gate;

    const store = getStore();
    const original = await store.getFile(photo.path);
    if (!original) return { ok: false, error: `Photo file missing for ${photo.id}` };
    const originalImg = { data: original.data, name: "room.jpg", type: original.contentType };
    const staged = p.brief?.intensity === "redesign" || dir.layoutChange;

    let images: Img[];
    let prompt: string;
    if (staged) {
      const empty = await emptyRoom(ctx, p, photo, originalImg);
      images = [{ data: empty, name: "empty.png", type: "image/png" }, originalImg];
      prompt = `Image 1 is the client's space, emptied. Image 2 is the same room before — use it ONLY for architecture, scale and light, NOT for furniture.
Furnish Image 1 from scratch with this design.
${architecture(p)}
${conceptBlock(p, dir, args.revisionNote, args.fixInstructions)}`;
    } else {
      images = [originalImg];
      prompt = `Image 1 is the client's real space. Restyle it with this design.
${architecture(p)}
${keepLine(p)}
${conceptBlock(p, dir, args.revisionNote, args.fixInstructions)}`;
    }
    const { png, model } = await renderWithFallback(ctx, images, prompt, sizeFor(photo));
    return saveRender(ctx, p, { kind: "inspiration", dir, photo, png, model, prompt, revisionNote: args.revisionNote ?? null, productIds: [], staged });
  },
});

export const generateRoomImage = defineTool({
  name: "generate_room_image",
  description:
    "Render the SHOPPABLE image: the selected concept built from the exact products on the shopping list (product photos are passed as visual references), so the client sees what they can actually buy. A bonus on top of the inspiration render — do it after the shopping list is valid.",
  parameters: z.object({
    photoId: z.string().optional(),
    revisionNote: z.string().optional(),
    fixInstructions: z.string().optional(),
  }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const dir = selectedDirection(p);
    if (!dir) return { ok: false, error: "Select a design concept first." };
    if (!p.shoppingList) return { ok: false, error: "Build the shopping list first (optimize_budget) so the render shows real products." };
    if (isStale(p, "shopping")) {
      const why = staleArtifacts(p).filter((k) => k !== "shopping" && k !== "render" && k !== "tasks");
      return { ok: false, error: `The shopping list is out of date${why.length ? ` because ${why.join(" and ")} ${why.length > 1 ? "are" : "is"} out of date too` : ""}. Rebuild ${why.length ? `${why.join(", ")} and ` : ""}the list before rendering.` };
    }
    const photo = pickPhoto(p, args.photoId);
    if (!photo) return { ok: false, error: "No room photo uploaded." };
    const gate = renderGate(ctx, p, "shoppable", args.revisionNote);
    if (gate) return gate;
    ctx.counters.shoppableRenders = (ctx.counters.shoppableRenders ?? 0) + 1;

    const store = getStore();
    const original = await store.getFile(photo.path);
    if (!original) return { ok: false, error: `Photo file missing for ${photo.id}` };
    const originalImg = { data: original.data, name: "room.jpg", type: original.contentType };
    const staged = p.brief?.intensity === "redesign" || dir.layoutChange;

    const lines = [...p.shoppingList.lines].sort((a, b) => rank(a.impact) - rank(b.impact)).slice(0, MAX_REFS);
    const fetched = await Promise.all(lines.map((l) => fetchProductImage(l.product.image)));
    const base: Img[] = staged ? [{ data: await emptyRoom(ctx, p, photo, originalImg), name: "empty.png", type: "image/png" }, originalImg] : [originalImg];
    const refs: Img[] = [];
    const refLines: string[] = [];
    lines.forEach((l, i) => {
      const data = fetched[i];
      if (!data) return;
      refs.push({ data, name: `ref-${i}.jpg`, type: "image/jpeg" });
      refLines.push(`Image ${base.length + refs.length}: ${l.product.type} "${l.product.name}" (${l.product.colour || "as pictured"})${l.qty > 1 ? ` x${l.qty}` : ""} — ${l.placement}`);
    });

    const prompt = `${staged ? "Image 1 is the client's space, emptied; Image 2 is the same room before (architecture reference only). Furnish Image 1." : "Image 1 is the client's real space. Edit Image 1."}
${architecture(p)}
${staged ? "" : keepLine(p)}
Build the design using THESE EXACT REAL PRODUCTS, matching each reference's colour, pattern, texture and shape:
${refLines.join("\n")}
Where the concept calls for something not on the list, leave it out rather than inventing it.
${conceptBlock(p, dir, args.revisionNote, args.fixInstructions)}`;
    const { png, model } = await renderWithFallback(ctx, [...base, ...refs], prompt, sizeFor(photo));
    return saveRender(ctx, p, { kind: "shoppable", dir, photo, png, model, prompt, revisionNote: args.revisionNote ?? null, productIds: lines.map((l) => l.productId), staged });
  },
});

const CritiqueOut = z.object({
  structure: z.number().describe("0-10: same room? walls, window, closet, doorway, floor, camera angle preserved"),
  designQuality: z.number().describe("0-10: is this genuinely inspiring, cohesive, well-scaled design a top designer would sign — focal point, layered light, texture, proportion? Penalize timid 'added a throw' results."),
  productFidelity: z.number().describe("0-10: do the reference products appear and look like their photos (10 if no product references were given)"),
  briefFit: z.number().describe("0-10: does it deliver the client's mood, colours and must-haves"),
  issues: z.array(z.string()).describe("specific visible problems, including safety (bedding/curtains against a heater, blocked closet or door) and rental violations (paint, drilled fixtures); empty if none"),
  fixInstructions: z.string().describe("concrete instructions for a re-render that fixes the issues; empty if none"),
});

export const critiqueRender = defineTool({
  name: "critique_render",
  description:
    "Review a render (inspiration or shoppable) against the original photo and the brief using vision. Inspiration renders are judged on architecture preserved, design quality and brief fit; shoppable renders also on product fidelity. Pass/fail is decided in code. If it fails, re-render with the fixInstructions.",
  parameters: z.object({ renderId: z.string() }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const r = p.renders.find((x) => x.id === args.renderId);
    if (!r) return { ok: false, error: `Unknown render ${args.renderId}` };
    const store = getStore();
    const photo = p.photos.find((ph) => ph.id === r.photoId);
    const [orig, rend] = await Promise.all([photo ? store.getFile(photo.path) : null, store.getFile(r.path)]);
    if (!orig || !rend) return { ok: false, error: "Render or original photo file missing" };
    const dir = p.directions.find((d) => d.id === r.directionId);
    const products = r.kind === "shoppable" ? (p.shoppingList?.lines.filter((l) => r.productIds.includes(l.productId)).slice(0, 10) ?? []) : [];
    const out = await structured({
      model: config.models.vision,
      schema: CritiqueOut,
      name: "render_critique",
      effort: "medium",
      detail: "high",
      images: [{ dataUrl: toDataUrl(orig.data, orig.contentType) }, { dataUrl: toDataUrl(rend.data, rend.contentType) }, ...products.map((l) => ({ url: l.product.image }))],
      system: "You are a demanding design director reviewing a junior designer's visualization. Be strict and specific: clients notice when it isn't their room, when the design is timid, or when something is unsafe or not renter-friendly.",
      prompt: `Image 1: original room. Image 2: proposed ${r.kind} render.${products.length ? ` Images 3+: product references (${products.map((l) => l.product.name).join(", ")}).` : ""}
Concept: ${dir ? `${dir.name} — ${dir.summary} Layout: ${dir.layout}` : "unknown"}
Brief: ${JSON.stringify(p.brief)}
Room constraints: ${p.room?.constraints.join("; ") || "none"}; answers: ${p.room?.questions.filter((q) => q.answer).map((q) => `${q.question} → ${q.answer}`).join("; ") || "none"}
${r.revisionNote ? `Requested revision: ${r.revisionNote}` : ""}`,
    });
    const min = config.agent.critiquePassScore;
    const pass =
      out.structure >= min && out.briefFit >= min && (r.kind === "inspiration" ? out.designQuality >= min : out.productFidelity >= min - 1);
    if (pass) ctx.counters.passedKinds = [...new Set([...(ctx.counters.passedKinds ?? []), r.kind])];
    await ctx.mutate((proj) => {
      const target = proj.renders.find((x) => x.id === r.id);
      if (target) target.critique = { ...out, productFidelity: r.kind === "shoppable" ? out.productFidelity : null, designQuality: out.designQuality, pass };
    });
    return {
      ok: true,
      summary: `${r.kind} ${pass ? "PASS" : "FAIL"} — room ${out.structure}, design ${out.designQuality}${r.kind === "shoppable" ? `, products ${out.productFidelity}` : ""}, brief ${out.briefFit}`,
      data: { pass, ...out },
    };
  },
});

// ---------- helpers ----------

function pickPhoto(p: Project, id?: string) {
  return p.photos.find((ph) => ph.id === id) ?? p.photos.find((ph) => ph.kind === "room") ?? null;
}

function renderGate(ctx: ToolContext, p: Project, kind: Render["kind"], revisionNote?: string): ToolResult | null {
  if (ctx.counters.passedKinds?.includes(kind) && !revisionNote) {
    return { ok: false, error: `A ${kind} render already passed review in this request. Don't polish further — mention any remaining review notes in your summary and move on.` };
  }
  if (kind === "shoppable" && (ctx.counters.shoppableRenders ?? 0) >= 2) {
    return { ok: false, error: "The shoppable render is a bonus and has had 2 attempts this request. Keep the best one and report its limits in your summary." };
  }
  if (ctx.counters.renders < config.agent.freeRendersPerRun) return null;
  const key = `render:extra:${p.renders.length}`;
  if (hasApproval(p, key)) return null;
  return { ok: false, error: `Render limit for this request reached (${config.agent.freeRendersPerRun}).`, needsApproval: { key, reason: "Generate another room render (image generation costs money)" } };
}

/** Architecture-only version of the photo, generated once and cached on the photo. */
async function emptyRoom(ctx: ToolContext, p: Project, photo: Photo, original: Img): Promise<Buffer> {
  const store = getStore();
  if (photo.emptyPath) {
    const cached = await store.getFile(photo.emptyPath);
    if (cached) return cached.data;
  }
  await ctx.emit({ type: "message", tool: "render_concept", summary: "Clearing the room down to its architecture first" });
  const { png } = await renderWithFallback(
    ctx,
    [original],
    `Image 1 is a real ${ROOM_RULES[roomTypeOf(p)].label.toLowerCase()}. Remove EVERYTHING that is not architecture: furniture, beds, sofas, tables, chairs, rugs, lamps, textiles, towels, toys, clothes, bags, cables, all loose objects. Leave the room completely empty and clean. ${ROOM_RULES[roomTypeOf(p)].emptyKeeps}${p.brief?.keep.length ? ` Do NOT remove or change: ${p.brief.keep.join("; ")}.` : ""}
${architecture(p)}
Fill revealed floor and walls naturally and consistently. Photorealistic, same lighting.`,
    sizeFor(photo),
  );
  const path = await store.putFile(p.id, `${photo.id}-empty.png`, png, "image/png");
  await ctx.mutate((proj) => {
    const ph = proj.photos.find((x) => x.id === photo.id);
    if (ph) ph.emptyPath = path;
  });
  return png;
}

async function renderWithFallback(ctx: ToolContext, images: Img[], prompt: string, size: ReturnType<typeof sizeFor>) {
  let model = config.models.render;
  try {
    return { png: await editImage({ model, images, prompt, size }), model };
  } catch (e) {
    // A rejected/unavailable primary model is not worth retrying as-is; fall back once.
    if (e instanceof OpenAI.APIError && e.status && e.status < 500 && e.status !== 429 && model !== config.models.renderFallback) {
      await ctx.emit({ type: "retry", tool: "render", summary: `${model} failed (${e.status}); falling back to ${config.models.renderFallback}` });
      model = config.models.renderFallback;
      return { png: await editImage({ model, images, prompt, size }), model };
    }
    const quota = e instanceof OpenAI.APIError && (e.code === "insufficient_quota" || /no credits|quota/i.test(e.message));
    if (!quota && e instanceof OpenAI.APIError && (e.status === 429 || (e.status ?? 500) >= 500)) throw new RetryableError(e.message);
    throw e;
  }
}

async function saveRender(
  ctx: ToolContext,
  p: Project,
  r: { kind: Render["kind"]; dir: Direction; photo: Photo; png: Buffer; model: string; prompt: string; revisionNote: string | null; productIds: string[]; staged: boolean },
): Promise<ToolResult> {
  const id = newId("rnd");
  const path = await getStore().putFile(p.id, `${id}.png`, r.png, "image/png");
  const render: Render = {
    id,
    kind: r.kind,
    directionId: r.dir.id,
    photoId: r.photo.id,
    path,
    model: r.model,
    prompt: r.prompt,
    revisionNote: r.revisionNote,
    productIds: r.productIds,
    critique: null,
    createdAt: now(),
  };
  ctx.counters.renders++;
  await ctx.mutate((proj) => {
    proj.renders.push(render);
    bump(proj, r.kind === "inspiration" ? "inspiration" : "render");
  });
  return { ok: true, summary: `Rendered ${r.kind} ${id}${r.staged ? " (staged from empty room)" : ""}${r.productIds.length ? ` with ${r.productIds.length} product refs` : ""} (${r.model})`, data: { renderId: id } };
}

function architecture(p: Project) {
  const fixtures = ROOM_RULES[roomTypeOf(p)].fixtures;
  const keep = p.brief?.keep ?? [];
  return `PRESERVE EXACTLY (same camera position, lens, perspective and framing): ${p.room?.architecture.join("; ") || "walls, ceiling, windows, doors, floor"}.${fixtures ? ` Fixed fixtures stay exactly as they are: ${fixtures}` : ""}${
    keep.length ? ` The client is keeping these exactly as they are — same finish, colour, position and size: ${keep.join("; ")}.` : ""
  } Mirrors reflect the room only — never a person.`;
}

function keepLine(p: Project) {
  const keep = keepList(p);
  return keep.length ? `KEEP in place: ${keep.join("; ")}.` : "";
}

function conceptBlock(p: Project, dir: Direction, revision?: string, fix?: string) {
  return `THE DESIGN — "${dir.name}": ${dir.renderPrompt}
Layout: ${dir.layout}
${p.room?.personalItems.length ? `Include the client's personal items: ${p.room.personalItems.join(", ")}.` : ""}
${p.brief?.rental ? "Rental: no paint, nothing drilled into walls or ceiling (freestanding / tension / leaning / adhesive only)." : ""}
${revision ? `CLIENT REVISION: ${revision}` : ""}
${fix ? `FIX FROM REVIEW: ${fix}` : ""}
Close any open cabinet doors and drawers and tidy countertops — kept items stay, but looking cared-for.
Photorealistic editorial interior photograph from this exact spot: natural, believable, warm light, true-to-life materials and scale.`;
}

function keepList(p: Project) {
  // Refresh keeps furniture unless told otherwise; restyle/redesign keep only what's marked.
  const keeps = (k: boolean | null) => (p.brief?.intensity === "refresh" ? k !== false : k === true);
  const fromRoom = p.room?.furniture.filter((f) => keeps(f.keep)).map((f) => `${f.name} (${f.color})`) ?? [];
  return [...new Set([...fromRoom, ...(p.room?.personalItems ?? []), ...(p.brief?.keep ?? [])])];
}

function sizeFor(photo: Photo): "1024x1024" | "1024x1536" | "1536x1024" {
  const ratio = photo.width / photo.height;
  return ratio < 0.85 ? "1024x1536" : ratio > 1.18 ? "1536x1024" : "1024x1024";
}

const rank = (i: "high" | "medium" | "low") => ({ high: 0, medium: 1, low: 2 })[i];
