import { z } from "zod";
import { structured, toDataUrl } from "../../ai/openai";
import { config } from "../../config";
import { addDecision, bump } from "../../domain/project";
import { roomLabel, roomPhrase, type RoomType as RoomTypeT } from "../../domain/rooms";
import { BedSize, emptyPreferences, RoomType, type Brief, type RoomProfile } from "../../domain/schemas";
import { getStore } from "../../store";
import { newId } from "../../util";
import { defineTool } from "../types";

const RoomAnalysis = z.object({
  roomType: RoomType.describe("what this space is, from the photos; living_dining for an open space that does both"),
  functions: z.array(z.string()).describe("what the space is currently used for, e.g. Sleep, Relax, Dine, Work, Get ready, Storage"),
  summary: z.string().describe("2-3 sentences: layout, what's there, overall feel"),
  widthFt: z.number().nullable().describe("best estimate, null if impossible"),
  lengthFt: z.number().nullable(),
  bedSize: BedSize.describe("'unknown' if there is no bed"),
  furniture: z.array(z.object({ name: z.string(), color: z.string(), material: z.string() })),
  architecture: z.array(z.string()).describe("fixed elements: windows, blinds, closet doors, ceiling lights, outlets, radiators"),
  personalItems: z.array(z.string()).describe("personal/sentimental items that should stay in the redesign: stuffed animals, framed photos, plants, artwork"),
  colors: z.array(z.object({ name: z.string(), hex: z.string() })).describe("dominant existing colours"),
  lighting: z.object({ natural: z.string(), artificial: z.string(), colorTemp: z.enum(["warm", "neutral", "cool", "mixed"]) }),
  lampSurfaces: z.number().int().describe("count of surfaces that could hold a table lamp (nightstands, dressers, desks)"),
  constraints: z.array(z.string()).describe("spatial constraints: tight walkways, door swing, window placement"),
  opportunities: z.array(z.string()).describe("highest-impact improvement opportunities"),
  uncertain: z
    .array(z.object({ question: z.string(), options: z.array(z.string()) }))
    .describe("observations you are NOT sure about that matter for the design (bed size, whether items stay, dimensions). Max 3."),
  confidence: z.number().describe("0-1 overall confidence in this analysis"),
});

export const analyzeRoom = defineTool({
  name: "analyze_room",
  description:
    "Analyze the uploaded room photos with vision and build a structured room profile (furniture, architecture, colours, lighting, bed size, constraints, opportunities) plus questions about uncertain observations. Overwrites the previous analysis but keeps details the user already confirmed.",
  parameters: z.object({ focus: z.string().optional().describe("anything specific to look for, e.g. a user correction to re-check") }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const photos = p.photos.filter((ph) => ph.kind === "room");
    if (photos.length === 0) return { ok: false, error: "No room photos uploaded yet. Ask the user to upload 1-5 photos of the bedroom." };
    const store = getStore();
    const images = [];
    for (const ph of photos.slice(0, 5)) {
      const f = await store.getFile(ph.path);
      if (f) images.push({ dataUrl: toDataUrl(f.data, f.contentType) });
    }
    const out = await structured({
      model: config.models.vision,
      schema: RoomAnalysis,
      name: "room_analysis",
      effort: "medium",
      detail: "high",
      images,
      system:
        "You are an interior designer surveying a client's space from phone photos — bedroom, living room, dining area, bathroom or an open-plan mix. Be concrete and honest about uncertainty. Ignore people visible in mirrors. Clutter is temporary — note it but don't treat it as furniture. For bathrooms, list fixed fixtures (toilet, vanity, tub/shower, tiles) under architecture.",
      prompt: `Analyze these ${images.length} photo(s) of the same space.${args.focus ? `\nFocus: ${args.focus}` : ""}${
        p.brief ? `\nClient brief for context: ${JSON.stringify(p.brief)}` : ""
      }`,
    });

    const prev = p.room;
    const questions = out.uncertain.slice(0, 3).map((q) => ({ id: newId("q"), question: q.question, options: q.options, answer: null as string | null }));
    // The space's purpose drives everything downstream, so make sure the user decides it.
    const stated = p.brief?.roomType ?? null;
    if (stated === null) {
      questions.unshift({
        id: newId("q"),
        question: `This looks like ${roomPhrase(out.roomType)}${out.functions.length ? `, currently used for ${listJoin(out.functions.map((f) => f.toLowerCase()))}` : ""}. What should this space do after the makeover?`,
        options: spaceOptions(out.roomType),
        answer: null,
      });
    } else if (stated !== out.roomType) {
      questions.unshift({
        id: newId("q"),
        question: `You said this is ${roomPhrase(stated)}, but the photos look like ${roomPhrase(out.roomType)}. Which should I design for?`,
        options: [roomLabel(stated), roomLabel(out.roomType)],
        answer: null,
      });
    }
    const room: RoomProfile = {
      roomType: out.roomType,
      functions: out.functions,
      summary: out.summary,
      dimensions:
        prev?.dimensions.source === "user" ? prev.dimensions : { widthFt: out.widthFt, lengthFt: out.lengthFt, source: "estimated" },
      bedSize: prev?.confirmed && prev.bedSize !== "unknown" ? prev.bedSize : out.bedSize,
      furniture: out.furniture.map((f) => ({
        ...f,
        keep: prev?.furniture.find((x) => x.name.toLowerCase() === f.name.toLowerCase())?.keep ?? null,
      })),
      architecture: out.architecture,
      personalItems: out.personalItems,
      colors: out.colors,
      lighting: out.lighting,
      lampSurfaces: out.lampSurfaces,
      constraints: out.constraints,
      opportunities: out.opportunities,
      questions: questions.slice(0, 3),
      confidence: out.confidence,
      confirmed: false,
    };
    await ctx.mutate((proj) => {
      proj.room = room;
      bump(proj, "room");
    });
    return {
      ok: true,
      summary: `Room analyzed: looks like a ${roomLabel(room.roomType).toLowerCase()} (confidence ${room.confidence.toFixed(2)}${room.bedSize !== "unknown" ? `, bed ${room.bedSize}` : ""}, ${room.questions.length} open question(s))`,
      data: { room },
    };
  },
});

const BriefPatch = z.object({
  roomType: RoomType.nullable().optional().describe("the space the user wants designed; set it once they confirm"),
  functions: z.array(z.string()).optional().describe("what the user wants the space to do, e.g. Relax, Dine, Work"),
  style: z.array(z.string()).optional(),
  description: z.string().optional(),
  colors: z.array(z.string()).optional(),
  avoid: z.array(z.string()).optional(),
  budget: z.number().positive().nullable().optional().describe("null = no budget limit"),
  intensity: z.enum(["refresh", "restyle", "redesign"]).optional(),
  rental: z.boolean().optional(),
  keep: z.array(z.string()).optional(),
  mustHave: z.array(z.string()).optional(),
});

export const updateProject = defineTool({
  name: "update_project",
  description: `Persist project state and decisions: brief fields (style, colours, budget, rental, keep-list, must-haves, avoid), room corrections (bed size, dimensions, lamp surfaces, which furniture stays, answers to room questions, confirming the room), learned user preferences, and a decision log entry.
Relaxing a user constraint (raising the budget, dropping rental, removing a keep or must-have item) requires either userQuote — a verbatim excerpt of the user's latest message requesting it — or the user's approval via ask_user.`,
  parameters: z.object({
    brief: BriefPatch.optional(),
    room: z
      .object({
        bedSize: BedSize.optional(),
        widthFt: z.number().optional(),
        lengthFt: z.number().optional(),
        lampSurfaces: z.number().int().min(0).optional(),
        furnitureKeep: z.array(z.object({ name: z.string(), keep: z.boolean() })).optional(),
        answers: z.array(z.object({ questionId: z.string(), answer: z.string() })).optional(),
        confirmed: z.boolean().optional(),
      })
      .optional(),
    preferences: z
      .object({ addLikes: z.array(z.string()).optional(), addDislikes: z.array(z.string()).optional(), addNotes: z.array(z.string()).optional() })
      .optional(),
    decision: z.string().optional().describe("one-line record of a design decision and why"),
    userQuote: z.string().optional(),
  }),
  mutates: true,
  async execute(ctx, args) {
    const p = await ctx.get();
    const relaxations = args.brief && p.brief ? findRelaxations(p.brief, args.brief) : [];
    if (relaxations.length) {
      const key = `relax:${relaxations.join("|")}`;
      const quoted = !!args.userQuote && normalize(ctx.userMessage).includes(normalize(args.userQuote)) && args.userQuote.trim().length >= 3;
      if (!quoted && !p.approvals.some((a) => a.key === key && a.granted)) {
        return {
          ok: false,
          error: `This relaxes a user constraint (${relaxations.join("; ")}). Quote the user's request verbatim in userQuote, or ask for approval.`,
          needsApproval: { key, reason: `Relax constraint: ${relaxations.join("; ")}` },
        };
      }
    }
    if (!p.brief && args.brief && args.brief.budget === undefined) {
      return { ok: false, error: "A new brief needs a budget (a number, or null if the user said there's no limit). Ask the user." };
    }

    const changed: string[] = [];
    await ctx.mutate(async (proj) => {
      if (args.brief) {
        const base: Brief = proj.brief ?? { style: [], description: "", colors: [], avoid: [], budget: null, roomType: null, functions: [], intensity: "refresh", rental: true, keep: [], mustHave: [] };
        const next = { ...base, ...stripUndefined(args.brief) };
        if (JSON.stringify(next) !== JSON.stringify(proj.brief)) {
          proj.brief = next;
          bump(proj, "brief");
          changed.push("brief");
        }
      }
      if (args.room && proj.room) {
        const r = proj.room;
        // Only factual corrections invalidate downstream work; confirming or recording answers doesn't.
        const facts = () => JSON.stringify({ ...r, questions: undefined, confirmed: undefined });
        const before = facts();
        const beforeAll = JSON.stringify(r);
        if (args.room.bedSize) r.bedSize = args.room.bedSize;
        if (args.room.widthFt || args.room.lengthFt) {
          r.dimensions = { widthFt: args.room.widthFt ?? r.dimensions.widthFt, lengthFt: args.room.lengthFt ?? r.dimensions.lengthFt, source: "user" };
        }
        if (args.room.lampSurfaces !== undefined) r.lampSurfaces = args.room.lampSurfaces;
        for (const fk of args.room.furnitureKeep ?? []) {
          const f = r.furniture.find((x) => x.name.toLowerCase().includes(fk.name.toLowerCase()));
          if (f) f.keep = fk.keep;
        }
        for (const a of args.room.answers ?? []) {
          const q = r.questions.find((x) => x.id === a.questionId);
          if (q) q.answer = a.answer;
        }
        if (args.room.confirmed !== undefined) r.confirmed = args.room.confirmed;
        if (facts() !== before) {
          bump(proj, "room");
          changed.push("room");
        } else if (JSON.stringify(r) !== beforeAll) changed.push("room answers");
      }
      if (args.decision) {
        addDecision(proj, args.decision);
        changed.push("decision");
      }
    });
    if (args.preferences) {
      const store = getStore();
      const prefs = (await store.getPreferences(ctx.ownerId)) ?? emptyPreferences();
      const merge = (a: string[], b?: string[]) => [...new Set([...a, ...(b ?? [])])].slice(-40);
      await store.savePreferences(ctx.ownerId, {
        likes: merge(prefs.likes, args.preferences.addLikes),
        dislikes: merge(prefs.dislikes, args.preferences.addDislikes),
        notes: merge(prefs.notes, args.preferences.addNotes),
      });
      changed.push("preferences");
    }
    return { ok: true, summary: changed.length ? `Updated ${changed.join(", ")}` : "No changes" };
  },
});

export const getPreferences = defineTool({
  name: "get_preferences",
  description: "Retrieve the user's persisted design preferences (likes, dislikes, notes learned across sessions and projects) and the current brief.",
  parameters: z.object({}),
  mutates: false,
  async execute(ctx) {
    const [prefs, p] = await Promise.all([getStore().getPreferences(ctx.ownerId), ctx.get()]);
    return { ok: true, summary: "Preferences loaded", data: { preferences: prefs ?? emptyPreferences(), brief: p.brief } };
  },
});

const listJoin = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function spaceOptions(detected: RoomTypeT): string[] {
  const all = ["Living + dining", "Living room", "Dining area", "Bedroom", "Bathroom"];
  const first = roomLabel(detected);
  return [first, ...all.filter((o) => o !== first)].slice(0, 4);
}

function findRelaxations(cur: Brief, patch: z.infer<typeof BriefPatch>): string[] {
  const out: string[] = [];
  if (patch.budget !== undefined && cur.budget !== null && (patch.budget === null || patch.budget > cur.budget)) out.push(`budget $${cur.budget} → ${patch.budget === null ? "no limit" : `$${patch.budget}`}`);
  if (patch.rental === false && cur.rental) out.push("no longer rental-safe");
  const dropped = (a: string[], b?: string[]) => (b ? a.filter((x) => !b.some((y) => y.toLowerCase() === x.toLowerCase())) : []);
  for (const k of dropped(cur.keep, patch.keep)) out.push(`stop keeping "${k}"`);
  for (const m of dropped(cur.mustHave, patch.mustHave)) out.push(`drop must-have "${m}"`);
  return out;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}$]+/gu, " ").trim();

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
