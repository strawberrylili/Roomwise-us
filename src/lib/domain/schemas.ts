import { z } from "zod";
import { ROOM_TYPES } from "./rooms";

export const RoomType = z.enum(ROOM_TYPES);

// ---------- Room ----------

export const BedSize = z.enum(["twin", "full", "queen", "king", "unknown"]);
export type BedSize = z.infer<typeof BedSize>;

export const RoomQuestion = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).default([]),
  answer: z.string().nullable().default(null),
});

export const RoomProfile = z.object({
  /** What the space looks like it is, from the photos. The brief's roomType (if set) wins. */
  roomType: RoomType.default("bedroom"),
  functions: z.array(z.string()).default([]),
  summary: z.string(),
  dimensions: z.object({
    widthFt: z.number().nullable(),
    lengthFt: z.number().nullable(),
    source: z.enum(["user", "estimated"]),
  }),
  bedSize: BedSize,
  furniture: z.array(
    z.object({
      name: z.string(),
      color: z.string(),
      material: z.string(),
      keep: z.boolean().nullable(),
    }),
  ),
  architecture: z.array(z.string()),
  /** Sentimental/personal items to keep in every render (stuffed animals, photos, plants). */
  personalItems: z.array(z.string()).default([]),
  colors: z.array(z.object({ name: z.string(), hex: z.string() })),
  lighting: z.object({
    natural: z.string(),
    artificial: z.string(),
    colorTemp: z.enum(["warm", "neutral", "cool", "mixed"]),
  }),
  /** Surfaces that can hold a table lamp (nightstands, dressers, desks). */
  lampSurfaces: z.number().int().min(0),
  constraints: z.array(z.string()),
  opportunities: z.array(z.string()),
  questions: z.array(RoomQuestion),
  confidence: z.number().min(0).max(1),
  confirmed: z.boolean(),
});
export type RoomProfile = z.infer<typeof RoomProfile>;

// ---------- Brief & preferences ----------

export const Brief = z.object({
  style: z.array(z.string()),
  description: z.string(),
  colors: z.array(z.string()),
  avoid: z.array(z.string()),
  /** null = no budget limit. */
  budget: z.number().positive().nullable(),
  /** null = let Roomwise work it out from the photos (and confirm with the user). */
  roomType: RoomType.nullable().default("bedroom"),
  /** What the user wants the space to do: Sleep, Relax, Dine, Work… */
  functions: z.array(z.string()).default([]),
  /** How far the makeover may go: refresh = soft goods, restyle = swap furniture, redesign = everything but architecture. */
  intensity: z.enum(["refresh", "restyle", "redesign"]).default("refresh"),
  rental: z.boolean(),
  keep: z.array(z.string()),
  mustHave: z.array(z.string()),
});
export type Brief = z.infer<typeof Brief>;

export const Preferences = z.object({
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  notes: z.array(z.string()),
});
export type Preferences = z.infer<typeof Preferences>;
export const emptyPreferences = (): Preferences => ({ likes: [], dislikes: [], notes: [] });

// ---------- Design directions ----------

export const Direction = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  palette: z.array(z.object({ name: z.string(), hex: z.string() })),
  materials: z.array(z.string()),
  moves: z.array(
    z.object({
      title: z.string(),
      impact: z.enum(["high", "medium", "low"]),
      cost: z.enum(["low", "medium", "high"]),
      rationale: z.string(),
    }),
  ),
  rationale: z.string(),
  estimatedCost: z.number(),
  // Designer concept detail (redesign-era directions; older ones default to empty).
  layout: z.string().default(""),
  layoutChange: z.boolean().default(false),
  focalPoint: z.string().default(""),
  pieces: z.array(z.string()).default([]),
  lighting: z.string().default(""),
  walls: z.string().default(""),
  styling: z.string().default(""),
  renderPrompt: z.string().default(""),
});
export type Direction = z.infer<typeof Direction>;

// ---------- Products ----------

export const ProductCategory = z.enum([
  "duvet_cover",
  "fitted_sheet",
  "bedspread",
  "throw",
  "cushion",
  "cushion_cover",
  "faux_fur",
  "rug",
  "table_lamp",
  "floor_lamp",
  "bulb",
  "curtain",
  "wall_decor",
  "plant",
  "storage",
  "headboard",
  "bed_frame",
  "nightstand",
  "side_table",
  "dresser",
  "shelf",
  "bench",
  "mirror",
  "curtain_rod",
  "wall_light",
  "sofa",
  "armchair",
  "coffee_table",
  "media_unit",
  "dining_table",
  "dining_chair",
  "sideboard",
  "pendant_light",
  "shower_curtain",
  "bath_mat",
  "towels",
  "bath_storage",
  "other",
]);
export type ProductCategory = z.infer<typeof ProductCategory>;

export const Product = z.object({
  id: z.string(),
  retailer: z.string(),
  category: ProductCategory,
  name: z.string(),
  type: z.string(),
  colour: z.string(),
  size: z.string(),
  price: z.number(),
  rating: z.string(),
  material: z.string(),
  image: z.string(),
  url: z.string(),
  /** Set by compare_products: 0-10 aesthetic fit to the selected direction. */
  fit: z.object({ score: z.number(), reason: z.string(), directionId: z.string() }).nullable().default(null),
});
export type Product = z.infer<typeof Product>;

export const ShoppingItem = z.object({
  productId: z.string(),
  qty: z.number().int().min(1),
  placement: z.string(),
  why: z.string(),
  impact: z.enum(["high", "medium", "low"]),
});
export type ShoppingItem = z.infer<typeof ShoppingItem>;

export const ShoppingLine = ShoppingItem.extend({ product: Product, lineTotal: z.number() });
export type ShoppingLine = z.infer<typeof ShoppingLine>;

export const ShoppingList = z.object({
  directionId: z.string(),
  lines: z.array(ShoppingLine),
  total: z.number(),
  budget: z.number().nullable(),
  breakdown: z.array(z.object({ category: z.string(), amount: z.number() })),
  warnings: z.array(z.string()),
  createdAt: z.string(),
});
export type ShoppingList = z.infer<typeof ShoppingList>;

// ---------- Renders ----------

export const Critique = z.object({
  structure: z.number().min(0).max(10),
  /** Shoppable renders only: do the list's products appear as pictured. */
  productFidelity: z.number().min(0).max(10).nullable(),
  /** Inspiration renders only: is it genuinely good, cohesive, magazine-worthy design. */
  designQuality: z.number().min(0).max(10).nullable().default(null),
  briefFit: z.number().min(0).max(10),
  issues: z.array(z.string()),
  fixInstructions: z.string(),
  pass: z.boolean(),
});
export type Critique = z.infer<typeof Critique>;

export const Render = z.object({
  id: z.string(),
  /** inspiration = the design at full ambition; shoppable = the same room with real listed products. */
  kind: z.enum(["inspiration", "shoppable"]).default("shoppable"),
  directionId: z.string(),
  photoId: z.string(),
  path: z.string(),
  model: z.string(),
  prompt: z.string(),
  revisionNote: z.string().nullable(),
  productIds: z.array(z.string()),
  critique: Critique.nullable(),
  createdAt: z.string(),
});
export type Render = z.infer<typeof Render>;

// ---------- Tasks ----------

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  phase: z.enum(["prep", "purchase", "setup", "style"]),
  order: z.number().int(),
  dependsOn: z.array(z.string()),
  productId: z.string().nullable(),
  minutes: z.number().int().nullable(),
  done: z.boolean(),
  doneAt: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;

// ---------- Conversation, questions, runs ----------

export const Message = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  runId: z.string().nullable(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;

export const PendingQuestion = z.object({
  id: z.string(),
  kind: z.enum(["clarify", "approval", "choice"]),
  question: z.string(),
  options: z.array(z.string()),
  /** For approvals: the key the gated tool is waiting on. */
  approvalKey: z.string().nullable(),
  runId: z.string(),
  createdAt: z.string(),
});
export type PendingQuestion = z.infer<typeof PendingQuestion>;

export const GoalCheck = z.object({
  met: z.boolean(),
  gaps: z.array(z.string()),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string(), optional: z.boolean().default(false) })),
});
export type GoalCheck = z.infer<typeof GoalCheck>;

export const Run = z.object({
  id: z.string(),
  status: z.enum(["running", "awaiting_user", "done", "failed", "stopped"]),
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  iterations: z.number().int(),
  toolCalls: z.number().int(),
  renders: z.number().int(),
  error: z.string().nullable(),
  goalCheck: GoalCheck.nullable(),
});
export type Run = z.infer<typeof Run>;

export const RunEvent = z.object({
  seq: z.number().int(),
  runId: z.string(),
  at: z.string(),
  type: z.enum([
    "run_started",
    "tool_call",
    "tool_result",
    "validator",
    "retry",
    "message",
    "question",
    "goal_check",
    "run_finished",
    "error",
  ]),
  tool: z.string().nullable(),
  summary: z.string(),
  ok: z.boolean().nullable(),
  durationMs: z.number().nullable(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

// ---------- Project ----------

/** Artifacts with versions; downstream artifacts record the upstream versions they were built from. */
export const ArtifactKey = z.enum(["room", "brief", "directions", "inspiration", "shopping", "render", "tasks"]);
export type ArtifactKey = z.infer<typeof ArtifactKey>;

export const Photo = z.object({
  id: z.string(),
  path: z.string(),
  width: z.number(),
  height: z.number(),
  kind: z.enum(["room", "progress"]),
  /** Cached "everything removed" version of this photo, used for staging redesigns. */
  emptyPath: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Photo = z.infer<typeof Photo>;

export const Project = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  photos: z.array(Photo),
  room: RoomProfile.nullable(),
  brief: Brief.nullable(),
  directions: z.array(Direction),
  selectedDirectionId: z.string().nullable(),
  catalog: z.array(Product),
  shoppingList: ShoppingList.nullable(),
  renders: z.array(Render),
  chosenRenderId: z.string().nullable(),
  tasks: z.array(Task),
  messages: z.array(Message),
  pending: PendingQuestion.nullable(),
  /** Autopilot: the agent never stops to ask — it decides, records assumptions, and reports them. */
  autopilot: z.boolean().default(false),
  approvals: z.array(z.object({ key: z.string(), granted: z.boolean(), at: z.string() })),
  decisions: z.array(z.object({ at: z.string(), text: z.string() })),
  // Preprocess fills artifact keys added after a project was created.
  versions: z.preprocess(
    (v) => ({ ...Object.fromEntries(ArtifactKey.options.map((k) => [k, 0])), ...(v as object) }),
    z.record(ArtifactKey, z.number().int()),
  ),
  basedOn: z.partialRecord(ArtifactKey, z.partialRecord(ArtifactKey, z.number().int())),
  runs: z.array(Run),
});
export type Project = z.infer<typeof Project>;
