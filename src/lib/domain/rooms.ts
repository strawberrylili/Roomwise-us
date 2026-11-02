import type { ProductCategory } from "./schemas";

export const ROOM_TYPES = ["bedroom", "living_room", "dining", "living_dining", "bathroom", "other"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const FUNCTIONS = ["Sleep", "Relax", "Dine", "Work", "Entertain", "Get ready", "Storage", "Play"] as const;

type RoomRules = {
  label: string;
  /** Room-specific design guidance added to the designer's principles. */
  principles: string;
  /** Fixed elements that stay in every render, on top of walls/windows/doors/floor. */
  fixtures: string;
  /** What the empty-room staging step must leave in place. */
  emptyKeeps: string;
  /** Categories the shopping step usually needs. */
  categories: ProductCategory[];
};

export const ROOM_RULES: Record<RoomType, RoomRules> = {
  bedroom: {
    label: "Bedroom",
    principles: "The bed is the focal point. Rug under at least 2/3 of the bed; bedside light on both sides if space allows; blackout-capable window treatment.",
    fixtures: "",
    emptyKeeps: "",
    categories: ["bed_frame", "headboard", "nightstand", "table_lamp", "bulb", "rug", "duvet_cover", "bedspread", "throw", "cushion_cover", "curtain", "curtain_rod"],
  },
  living_room: {
    label: "Living room",
    principles: "Anchor a conversation area: sofa and chairs facing each other within ~2.5 m, coffee table 40–45 cm from the sofa, rug large enough for at least the front legs of every seat. Keep a clear 75–90 cm walkway. Balance a TV wall (if any) with art or shelving.",
    fixtures: "",
    emptyKeeps: "",
    categories: ["sofa", "armchair", "coffee_table", "media_unit", "rug", "floor_lamp", "table_lamp", "bulb", "cushion_cover", "throw", "curtain", "curtain_rod", "plant"],
  },
  dining: {
    label: "Dining area",
    principles: "Table sized to the space with ≥ 90 cm clearance on every side where chairs pull out; a pendant or statement light centred over the table (plug-in/swag if renting); rug, if any, ≥ 60 cm past the table edge on all sides.",
    fixtures: "",
    emptyKeeps: "",
    categories: ["dining_table", "dining_chair", "pendant_light", "bulb", "rug", "sideboard", "plant"],
  },
  living_dining: {
    label: "Living + dining",
    principles: "Zone one open space into two areas that read as one design: a rug and lighting per zone, a shared palette, and a clear path between them (≥ 90 cm). The sofa back can define the living zone; the dining light centres the dining zone.",
    fixtures: "",
    emptyKeeps: "",
    categories: ["sofa", "armchair", "coffee_table", "rug", "floor_lamp", "dining_table", "dining_chair", "pendant_light", "bulb", "cushion_cover", "curtain", "curtain_rod", "plant"],
  },
  bathroom: {
    label: "Bathroom",
    principles: "Moisture-safe materials only. Make it feel like a spa through textiles, storage and light: a coordinated towel set, bath mat, shower curtain hung high, over-toilet or freestanding storage, a plant that tolerates humidity. No plug-in lamps or fabric near the shower. In a rental, fixtures and tiles stay — change everything around them.",
    fixtures: "Toilet, sink/vanity, bathtub or shower, tiles, built-in mirror or medicine cabinet, plumbing fixtures.",
    emptyKeeps: "Keep the toilet, sink/vanity, bathtub/shower, tiles and built-in mirror exactly as they are.",
    categories: ["shower_curtain", "curtain_rod", "bath_mat", "towels", "bath_storage", "mirror", "plant", "storage"],
  },
  other: {
    label: "Other space",
    principles: "Design around how the client said they want to use the space.",
    fixtures: "",
    emptyKeeps: "",
    categories: ["rug", "floor_lamp", "table_lamp", "bulb", "storage", "plant", "curtain", "curtain_rod"],
  },
};

export const roomLabel = (t: RoomType | null | undefined) => (t ? ROOM_RULES[t].label : "Room");

/** For sentences: "a bedroom", "an open living + dining space". */
export function roomPhrase(t: RoomType) {
  const phrases: Record<RoomType, string> = {
    bedroom: "a bedroom",
    living_room: "a living room",
    dining: "a dining area",
    living_dining: "an open living + dining space",
    bathroom: "a bathroom",
    other: "a multi-use space",
  };
  return phrases[t];
}
