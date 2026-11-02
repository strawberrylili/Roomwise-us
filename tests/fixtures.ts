import type { Brief, Product, RoomProfile } from "../src/lib/domain/schemas";

export const product = (o: Partial<Product> & Pick<Product, "id" | "category" | "price">): Product => ({
  retailer: "IKEA US",
  name: o.id.toUpperCase(),
  type: "Thing",
  colour: "beige",
  size: "",
  rating: "",
  material: "",
  image: "https://example.com/i.jpg",
  url: "https://example.com/p",
  fit: null,
  ...o,
});

export const brief = (o: Partial<Brief> = {}): Brief => ({
  style: ["cozy"],
  description: "cozy beige",
  colors: ["beige"],
  avoid: [],
  budget: 300,
  roomType: "bedroom",
  functions: [],
  intensity: "refresh",
  rental: true,
  keep: ["bed frame"],
  mustHave: ["blankets"],
  ...o,
});

export const room = (o: Partial<RoomProfile> = {}): RoomProfile => ({
  roomType: "bedroom",
  functions: ["Sleep"],
  summary: "Small bedroom",
  dimensions: { widthFt: 9, lengthFt: 10, source: "estimated" },
  bedSize: "full",
  furniture: [{ name: "bed frame", color: "black", material: "metal", keep: true }],
  architecture: ["window with roller blind"],
  personalItems: ["teddy bear"],
  colors: [],
  lighting: { natural: "one window", artificial: "recessed", colorTemp: "cool" },
  lampSurfaces: 1,
  constraints: [],
  opportunities: [],
  questions: [],
  confidence: 0.8,
  confirmed: true,
  ...o,
});
