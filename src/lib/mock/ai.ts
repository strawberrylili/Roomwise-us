/**
 * Deterministic stand-ins for every OpenAI call, enabled with ROOMWISE_MOCK=1. Outputs are
 * parsed through the real schemas, so the rest of the app runs exactly as in production.
 */
import sharp from "sharp";
import type { z } from "zod";

export const mockEnabled = () => process.env.ROOMWISE_MOCK === "1";

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const CONCEPTS = [
  { match: /layout boldly|rethink where the bed/i, name: "Window Cocoon — Rotated Japandi Sleep Platform", layoutChange: true, focal: "A curtained window alcove behind a low oak bed" },
  { match: /focal point|perfect the current/i, name: "Quiet Ryokan — Pale Oak Headboard Wall", layoutChange: false, focal: "A pale oak headboard wall with paired sconces" },
  { match: /unexpected|memorable/i, name: "Blanket Engawa — Low Linen Nest", layoutChange: false, focal: "A low, blanket-heaped linen bed under soft paper light" },
  { match: /warm and layered|furniture-forward/i, name: "Linen Haven — Layered Warm Neutrals", layoutChange: false, focal: "A tall upholstered headboard and layered linen bedding" },
  { match: /./, name: "Airy Dune — Light-Catching Calm", layoutChange: false, focal: "Sheer curtains and a pale rug that bounce the window light" },
];

function directions(prompt: string) {
  const angle = prompt.match(/ANGLE: (.*)/)?.[1] ?? "";
  const c = CONCEPTS.find((x) => x.match.test(angle))!;
  return {
    directions: [
      {
        name: c.name,
        summary: `${c.name.split(" — ")[0]}: a calm, warm bedroom built around layered cream textiles and pale oak.`,
        palette: [
          { name: "Oat", hex: "#E8DCC8" },
          { name: "Cream", hex: "#F5EFE4" },
          { name: "Pale oak", hex: "#C9A97E" },
          { name: "Sage", hex: "#A3AE94" },
        ],
        materials: ["linen", "pale oak", "wool", "paper"],
        layout: c.layoutChange ? "Bed rotated so the head sits on the window wall; walkway opened along the closet." : "Bed stays centred on the back wall with 60 cm clearance each side.",
        layoutChange: c.layoutChange,
        focalPoint: c.focal,
        pieces: ["Low pale-oak bed frame, full", "Oak nightstand", "Cream table lamp", "Large wool rug", "Linen duvet cover", "Two chunky throws", "Floor-length linen curtains on a tension rod"],
        lighting: "Warm table lamp, paper floor lamp, dimmable 2700K bulbs.",
        walls: "No paint; one framed print leaned on the nightstand.",
        styling: "Layered blankets at the foot, a small plant, a basket for throws.",
        moves: [
          { title: "Replace the bed with a low oak platform", impact: "high", cost: "high", rationale: "Sets the whole mood." },
          { title: "Floor-length curtains", impact: "high", cost: "medium", rationale: "Softens the window wall." },
          { title: "Large wool rug", impact: "medium", cost: "medium", rationale: "Grounds the bed." },
          { title: "Layered throws", impact: "medium", cost: "low", rationale: "Delivers the cozy brief." },
        ],
        rationale: "Works with the single window and narrow walkway; keeps everything renter-friendly.",
        estimatedCost: 1200,
        renderPrompt: `${c.name}: low pale-oak bed, layered cream linen and chunky throws, wool rug, linen curtains, warm lamp light.`,
      },
    ],
  };
}

function roomAnalysis(prompt: string) {
  const brief = JSON.parse(prompt.match(/Client brief for context: (.*)/)?.[1] ?? "{}");
  const type: string = brief.roomType ?? "living_dining";
  const common = {
    widthFt: 11,
    lengthFt: 14,
    colors: [
      { name: "white", hex: "#F4F4F2" },
      { name: "walnut floor", hex: "#6B5544" },
    ],
    lighting: { natural: "one window", artificial: "recessed lights", colorTemp: "cool" },
    confidence: 0.8,
  };
  if (type === "bedroom") {
    return {
      ...common,
      roomType: "bedroom",
      functions: ["Sleep"],
      summary: "Small bedroom with a full bed on the back wall, a window with a roller blind on the right and a sliding closet on the left.",
      widthFt: 8.5,
      lengthFt: 10.5,
      bedSize: "full",
      furniture: [
        { name: "bed frame", color: "black", material: "metal" },
        { name: "nightstand", color: "black", material: "laminate" },
        { name: "floor mirror", color: "white", material: "metal" },
      ],
      architecture: ["window with white roller blind on the right wall", "sliding closet doors on the left", "recessed ceiling light", "wood-look floor"],
      personalItems: ["teddy bear"],
      lampSurfaces: 1,
      constraints: ["narrow walkway along the closet"],
      opportunities: ["warm layered lighting", "softer textiles", "a real focal wall"],
      uncertain: [{ question: "Is the low strip under the window a heater, or just a ledge?", options: ["Heater", "Just a ledge"] }],
    };
  }
  if (type === "bathroom") {
    return {
      ...common,
      roomType: "bathroom",
      functions: ["Get ready"],
      summary: "Compact rental bathroom with a tub-shower, white vanity and toilet; bare walls and no storage.",
      widthFt: 5,
      lengthFt: 8,
      bedSize: "unknown",
      furniture: [],
      architecture: ["tub with shower", "white vanity and sink", "toilet", "white tiles", "mirror cabinet"],
      personalItems: [],
      lampSurfaces: 0,
      constraints: ["no plug-in lamps near water"],
      opportunities: ["spa textiles", "over-toilet storage", "a plant"],
      uncertain: [],
    };
  }
  return {
    ...common,
    roomType: "living_dining",
    functions: ["Relax", "Dine", "Work"],
    summary: "Open studio living space next to the kitchen: an office chair and low table, a floor cushion, a window wall at the far end.",
    bedSize: "unknown",
    furniture: [
      { name: "office chair", color: "black", material: "mesh" },
      { name: "low coffee table", color: "black", material: "laminate" },
      { name: "floor lamp", color: "white", material: "metal" },
    ],
    architecture: ["window wall with sliding door at the far end", "kitchen run on the right", "door on the left", "wood-look floor"],
    personalItems: [],
    lampSurfaces: 1,
    constraints: ["kitchen walkway must stay clear"],
    opportunities: ["define a living zone and a dining zone", "warm lighting", "a real sofa"],
    uncertain: [],
  };
}

function productFit(prompt: string) {
  const ids = [...prompt.matchAll(/id=(\S+)/g)].map((m) => m[1]);
  return { scores: ids.map((id, i) => ({ id, score: i === 0 ? 9 : 5 + (hash(id) % 4), reason: "Mock fit score" })) };
}

function tasks(prompt: string) {
  const list = JSON.parse(prompt.match(/SHOPPING LIST: (.*)/)?.[1] ?? "[]") as { productId: string; name: string }[];
  return {
    tasks: [
      { key: "clear", title: "Clear the room", detail: "Empty the floor and bed.", phase: "prep", dependsOn: [], productId: null, minutes: 30 },
      { key: "measure", title: "Measure the walls and window", detail: "Confirm bed and rug sizes.", phase: "prep", dependsOn: ["clear"], productId: null, minutes: 15 },
      ...list.map((l) => ({ key: `buy-${l.productId}`, title: `Buy ${l.name}`, detail: "Order online.", phase: "purchase", dependsOn: ["measure"], productId: l.productId, minutes: 5 })),
      { key: "rug", title: "Lay the rug", detail: "Rug first, then the bed.", phase: "setup", dependsOn: list.map((l) => `buy-${l.productId}`), productId: null, minutes: 20 },
      { key: "style", title: "Style the bed", detail: "Layer the throws.", phase: "style", dependsOn: ["rug"], productId: null, minutes: 20 },
    ],
  };
}

function critique() {
  return { structure: 8, designQuality: 8, productFidelity: 8, briefFit: 8, issues: [], fixInstructions: "" };
}

const BY_NAME: Record<string, (prompt: string) => unknown> = {
  room_analysis: roomAnalysis,
  design_directions: directions,
  product_fit: productFit,
  render_critique: critique,
  makeover_tasks: tasks,
};

export async function mockStructured<S extends z.ZodType>(name: string, schema: S, prompt: string): Promise<z.infer<S>> {
  const make = BY_NAME[name];
  if (!make) throw new Error(`No mock for structured call "${name}"`);
  return schema.parse(make(prompt));
}

/** A labelled placeholder image, coloured by prompt so different renders look different. */
export async function mockImage(prompt: string, size: string): Promise<Buffer> {
  const [w, h] = size.split("x").map(Number);
  const hue = hash(prompt) % 360;
  const label = /Remove EVERYTHING/.test(prompt) ? "Mock · empty room" : /EXACT REAL PRODUCTS/.test(prompt) ? "Mock · real products" : "Mock · inspiration";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${hue},30%,82%)"/><text x="50%" y="50%" font-family="sans-serif" font-size="56" text-anchor="middle" fill="#333">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
