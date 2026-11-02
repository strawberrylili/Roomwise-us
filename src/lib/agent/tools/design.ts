import { z } from "zod";
import { structured, toDataUrl, type ImageInput } from "../../ai/openai";
import { config } from "../../config";
import { addDecision, bump, hasApproval, roomTypeOf } from "../../domain/project";
import { ROOM_RULES } from "../../domain/rooms";
import { emptyPreferences } from "../../domain/schemas";
import { getStore } from "../../store";
import { newId } from "../../util";
import { defineTool, RetryableError } from "../types";

const DirectionsOut = z.object({
  directions: z.array(
    z.object({
      name: z.string().describe("evocative name, e.g. 'Window Nest — Japandi Blanket Alcove'"),
      summary: z.string().describe("the design idea in 1-2 sentences the client will read"),
      palette: z.array(z.object({ name: z.string(), hex: z.string() })).describe("4-6 colours, 60-30-10"),
      materials: z.array(z.string()),
      layout: z.string().describe("where the bed and every piece go, relative to the window/door/closet; include clearances"),
      layoutChange: z.boolean().describe("true if the bed or main furniture moves from where it is now"),
      focalPoint: z.string(),
      pieces: z.array(z.string()).describe("every furniture/decor piece with material, colour and approximate size"),
      lighting: z.string().describe("ambient + task + accent, warm"),
      walls: z.string().describe("renter-safe wall treatment, or none"),
      styling: z.string().describe("the finishing layer: textiles, art, objects, plants"),
      moves: z
        .array(z.object({ title: z.string(), impact: z.enum(["high", "medium", "low"]), cost: z.enum(["low", "medium", "high"]), rationale: z.string() }))
        .describe("the 4-7 moves that create the transformation, highest impact first"),
      rationale: z.string().describe("why this works for THIS room, light and client"),
      estimatedCost: z.number().describe("realistic USD estimate for the whole concept"),
      renderPrompt: z.string().describe("dense visual paragraph of the finished room for an image model: every piece, material, colour, placement, light quality. No camera instructions."),
    }),
  ),
});

const ANGLES: Record<string, string[]> = {
  refresh: ["warm and layered, maximum coziness", "calm and airy, light-catching", "one bold, memorable styling move"],
  restyle: ["perfect the current layout with a strong focal wall", "furniture-forward: the key pieces set the tone", "the most memorable, editorial version"],
  redesign: ["keep the main furniture where it is and make one wall a stunning focal point", "change the layout boldly — rethink where the main pieces go", "the most unexpected, memorable concept that still feels cozy"],
};

const INTENSITY: Record<string, string> = {
  refresh: "REFRESH: keep all furniture and the layout. Change textiles, lighting, rug, art and styling only.",
  restyle: "RESTYLE: keep the layout and the keep-list; any other furniture can be replaced (bed/headboard, nightstands, curtains, mirror, art).",
  redesign: "REDESIGN: everything except architecture (walls, ceiling, window, doors, floor) can go, including the layout. Design from scratch.",
};

const PRINCIPLES = `Design like a top residential interior designer, not a decorator:
- One clear focal point that makes a composed vignette (headboard, sofa wall, dining light, vanity wall, art, curtains).
- Scale and proportion: furniture sized to the room; rugs large enough to anchor the furniture; curtains floor-length, hung high and wide.
- Three layers of warm (2700K) light: ambient, task, accent.
- Colour 60-30-10: dominant warm neutral, secondary tone, small accent.
- Texture makes neutral rooms rich: linen, bouclé, wool, oak, rattan, ceramic, plaster.
- Deliberate symmetry or asymmetry; negative space; nothing floating randomly.
- One or two memorable moves so it feels designed, not catalogue.
- The layout must work: door swing, closet access, walkways ≥ 60 cm.
SAFETY (non-negotiable): keep beds, sofas, bedding and curtains ≥ 30 cm (12 in) from heaters, radiators and baseboard heaters; never block vents, outlets you need, closets or doors; in bathrooms no plug-in lamps or fabric near water.
RENTAL-SAFE (when renting): no paint, no drilling into walls or ceilings. Use tension rods or freestanding curtain systems, leaning mirrors and art, plug-in sconces with adhesive mounts, removable wallpaper, freestanding headboards.`;

export const generateDesignPlan = defineTool({
  name: "generate_design_plan",
  description:
    "Act as the interior designer: study the photos and create distinct, inspiring design concepts at the brief's intensity (refresh / restyle / redesign) — layout, focal point, every piece, lighting, walls, styling, palette, prioritized moves and an image prompt. Use count=1 with guidance to revise the current concept (e.g. 'keep Window Nest but warmer').",
  parameters: z.object({
    count: z.number().int().min(1).max(3).default(2),
    guidance: z.string().optional().describe("revision request or angle to explore"),
  }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    if (!p.room) return { ok: false, error: "Analyze the room first (analyze_room)." };
    if (!p.brief) return { ok: false, error: "No brief yet — record the user's style, budget and constraints with update_project first." };
    const prefs = (await getStore().getPreferences(ctx.ownerId)) ?? emptyPreferences();
    const current = p.directions.find((d) => d.id === p.selectedDirectionId);
    const store = getStore();
    const images: ImageInput[] = [];
    for (const ph of p.photos.filter((x) => x.kind === "room").slice(0, 3)) {
      const f = await store.getFile(ph.path);
      if (f) images.push({ dataUrl: toDataUrl(f.data, f.contentType) });
    }
    const answers = p.room.questions.filter((q) => q.answer).map((q) => `${q.question} → ${q.answer}`);
    // One call per concept, in parallel, each with its own angle: faster than one long call, and keeps concepts distinct.
    const brief = p.brief;
    const room = p.room;
    const space = roomTypeOf(p);
    const angles = args.guidance && args.count === 1 ? [args.guidance] : ANGLES[p.brief.intensity].slice(0, args.count);
    const results = await Promise.allSettled(
      angles.map((angle) =>
        structured({
          model: config.models.orchestrator,
          schema: DirectionsOut,
          name: "design_directions",
          effort: "medium",
          detail: "high",
          images,
          system: PRINCIPLES,
          prompt: `Create ONE inspiring concept for this ${ROOM_RULES[space].label.toLowerCase()}. ANGLE: ${angle}
ROOM TYPE: ${ROOM_RULES[space].label}${brief.functions.length ? ` — the client wants it for: ${brief.functions.join(", ")}` : ""}
ROOM-SPECIFIC GUIDANCE: ${ROOM_RULES[space].principles}${ROOM_RULES[space].fixtures ? `
FIXED (stays): ${ROOM_RULES[space].fixtures}` : ""}
INTENSITY: ${INTENSITY[brief.intensity]}
BRIEF: ${JSON.stringify(brief)}${brief.budget === null ? " (no budget limit — design for the best result)" : ""}
ROOM PROFILE: ${JSON.stringify({ ...room, questions: undefined })}
CLIENT ANSWERS: ${answers.join("; ") || "none"}
LEARNED PREFERENCES: ${JSON.stringify(prefs)}
${current ? `CURRENT CONCEPT: ${JSON.stringify(current)}` : ""}
${args.guidance ? `GUIDANCE: ${args.guidance}` : ""}`,
        }),
      ),
    );
    const created = results.flatMap((r) => (r.status === "fulfilled" ? r.value.directions.slice(0, 1) : [])).map((d) => ({ ...d, id: newId("dir") }));
    if (created.length === 0) {
      const reason = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
      throw new RetryableError(`Concept generation failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    await ctx.mutate((proj) => {
      const keep = proj.directions.filter((d) => d.id === proj.selectedDirectionId);
      proj.directions = [...created, ...keep].slice(0, 6);
      if (args.guidance) addDecision(proj, `Explored directions: ${args.guidance}`);
      bump(proj, "directions");
    });
    return {
      ok: true,
      summary: `${created.length} concept(s): ${created.map((d) => `${d.name}${d.layoutChange ? " (new layout)" : ""}`).join(", ")}`,
      data: { directions: created.map((d) => ({ id: d.id, name: d.name, summary: d.summary, layout: d.layout, focalPoint: d.focalPoint, estimatedCost: d.estimatedCost })) },
    };
  },
});

export const selectDirection = defineTool({
  name: "select_direction",
  description:
    "Select the design direction to execute. Do this when the user picks one, or when they delegated the choice to you. Switching away from a direction whose render the user marked as chosen needs userQuote (verbatim from the user's message) or approval.",
  parameters: z.object({ directionId: z.string(), reason: z.string(), userQuote: z.string().optional() }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const d = p.directions.find((x) => x.id === args.directionId);
    if (!d) return { ok: false, error: `Unknown direction ${args.directionId}. Valid: ${p.directions.map((x) => x.id).join(", ")}` };
    const chosen = p.renders.find((r) => r.id === p.chosenRenderId);
    if (chosen && chosen.directionId !== d.id) {
      const key = `switch-direction:${d.id}`;
      const quoted = !!args.userQuote && ctx.userMessage.toLowerCase().includes(args.userQuote.toLowerCase().trim());
      if (!quoted && !hasApproval(p, key)) {
        return {
          ok: false,
          error: "The user marked a render from another direction as their chosen design. Confirm before switching.",
          needsApproval: { key, reason: `Switch from the chosen design to "${d.name}"` },
        };
      }
    }
    await ctx.mutate((proj) => {
      proj.selectedDirectionId = d.id;
      addDecision(proj, `Selected direction "${d.name}": ${args.reason}`);
      bump(proj, "directions");
    });
    return { ok: true, summary: `Selected "${d.name}"` };
  },
});
