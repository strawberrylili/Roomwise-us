import { describe, expect, it } from "vitest";
import { validateShoppingList } from "../src/lib/domain/validators";
import { brief, product, room } from "./fixtures";

const catalog = [
  product({ id: "throw", category: "throw", price: 30 }),
  product({ id: "duvet-full", category: "duvet_cover", price: 60, size: "Full/Queen (Double/Queen)" }),
  product({ id: "duvet-king", category: "duvet_cover", price: 70, size: "King" }),
  product({ id: "rug-big", category: "rug", price: 250 }),
  product({ id: "rug-small", category: "rug", price: 50, fit: { score: 8, reason: "", directionId: "d" } }),
  product({ id: "lamp", category: "table_lamp", price: 30 }),
  product({ id: "lamp2", category: "table_lamp", price: 35 }),
  product({ id: "gu10", category: "bulb", price: 4, name: "SOLHETTA", type: "LED bulb GU10 380 lumen" }),
  product({ id: "e26", category: "bulb", price: 5, name: "SOLHETTA", type: "LED bulb E26 800 lumen" }),
  product({ id: "cat-cushion", category: "cushion", price: 10, name: "KATTEN", colour: "grey" }),
];
const item = (productId: string, qty = 1) => ({ productId, qty, placement: "bed", why: "", impact: "high" as const });

describe("validateShoppingList", () => {
  it("accepts a valid list and builds a breakdown", () => {
    const v = validateShoppingList([item("throw"), item("duvet-full"), item("lamp"), item("e26")], catalog, brief(), room());
    expect(v.errors).toEqual([]);
    expect(v.total).toBe(125);
    expect(v.breakdown[0]).toEqual({ category: "duvet_cover", amount: 60 });
  });

  it("rejects over-budget lists and offers cheaper same-category alternatives", () => {
    const v = validateShoppingList([item("throw"), item("rug-big"), item("duvet-full")], catalog, brief(), room());
    expect(v.errors.some((e) => e.includes("exceeds"))).toBe(true);
    expect(v.alternatives[0].replace).toContain("rug-big");
    expect(v.alternatives[0].with[0].id).toBe("rug-small");
  });

  it("rejects bedding that doesn't fit the bed", () => {
    const v = validateShoppingList([item("throw"), item("duvet-king")], catalog, brief(), room());
    expect(v.errors.join()).toMatch(/does not fit a full bed/);
  });

  it("rejects bulbs that don't fit the lamps (the GU10 bug from spike 0b)", () => {
    const v = validateShoppingList([item("throw"), item("lamp"), item("gu10")], catalog, brief(), room());
    expect(v.errors.join()).toMatch(/GU10/);
  });

  it("rejects more table lamps than surfaces (two lamps, one nightstand)", () => {
    const v = validateShoppingList([item("throw"), item("lamp"), item("lamp2")], catalog, brief(), room({ lampSurfaces: 1 }));
    expect(v.errors.join()).toMatch(/2 table lamps/);
  });

  it("enforces must-haves and avoid terms", () => {
    const missing = validateShoppingList([item("lamp")], catalog, brief(), room());
    expect(missing.errors.join()).toMatch(/blankets/);
    const avoid = validateShoppingList([item("throw"), item("cat-cushion")], catalog, brief({ avoid: ["grey"] }), room());
    expect(avoid.errors.join()).toMatch(/avoid: grey/);
  });

  it("rejects unknown ids and duplicates", () => {
    const v = validateShoppingList([item("throw"), item("throw"), item("nope")], catalog, brief(), room());
    expect(v.errors.join()).toMatch(/not in the catalog/);
    expect(v.errors.join()).toMatch(/listed twice/);
  });

  it("only warns (doesn't fail) when under-spending", () => {
    const v = validateShoppingList([item("throw")], catalog, brief(), room());
    expect(v.errors).toEqual([]);
    expect(v.warnings.join()).toMatch(/only \$30/);
  });

  it("rejects plug-in lamps in a bathroom", () => {
    const v = validateShoppingList([item("throw"), item("lamp")], catalog, brief({ roomType: "bathroom", mustHave: [] }), room({ roomType: "bathroom", lampSurfaces: 1 }));
    expect(v.errors.join()).toMatch(/not safe in a bathroom/);
  });
});
