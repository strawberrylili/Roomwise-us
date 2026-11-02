/** Offline IKEA-like catalog for ROOMWISE_MOCK=1: deterministic products for any category. */
import sharp from "sharp";
import type { Product, ProductCategory } from "../domain/schemas";

const BASE_PRICE: Partial<Record<ProductCategory, number>> = {
  bed_frame: 299,
  headboard: 129,
  nightstand: 79,
  table_lamp: 39,
  floor_lamp: 59,
  bulb: 4,
  rug: 149,
  duvet_cover: 49,
  fitted_sheet: 19,
  bedspread: 59,
  throw: 29,
  cushion: 9,
  cushion_cover: 12,
  curtain: 69,
  curtain_rod: 15,
  bench: 129,
  plant: 19,
  storage: 25,
};
const NAMES = ["LUNDVIK", "SOLBACKA", "HAVSNÄS", "TALLMO", "LINNEA"];
const BEDDING: ProductCategory[] = ["duvet_cover", "fitted_sheet", "bedspread"];

export function mockSearch(query: string, category: ProductCategory): Product[] {
  if (/nothing-matches/i.test(query)) return [];
  const base = BASE_PRICE[category] ?? 35;
  return NAMES.map((name, i) => ({
    id: `ikea-mock-${category}-${i}`,
    retailer: "IKEA US",
    category,
    name,
    type: category === "bulb" ? "LED bulb E26 600 lumen" : `${category.replace(/_/g, " ")} (${query})`,
    colour: ["beige", "white", "natural", "grey", "cream"][i],
    size: BEDDING.includes(category) ? (i % 2 === 0 ? "Full/Queen (Double/Queen)" : "King") : "",
    price: Math.round(base * (1 + i * 0.3) * 100) / 100,
    rating: "4.5 (120)",
    material: "",
    image: "/mock-product.svg",
    url: `https://www.ikea.com/us/en/p/mock-${category}-${i}/`,
    fit: null,
  }));
}

export async function mockProductImage(): Promise<Buffer> {
  return sharp({ create: { width: 256, height: 256, channels: 3, background: "#e8dcc8" } }).jpeg().toBuffer();
}
