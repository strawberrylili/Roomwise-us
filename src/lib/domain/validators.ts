import { money } from "../util";
import type { RoomType } from "./rooms";
import type { BedSize, Brief, Product, ProductCategory, RoomProfile, ShoppingItem, ShoppingLine } from "./schemas";

export type ValidationResult = {
  errors: string[];
  warnings: string[];
  lines: ShoppingLine[];
  total: number;
  breakdown: { category: string; amount: number }[];
  /** Cheaper same-category alternatives for the most expensive lines, when over budget. */
  alternatives: { replace: string; with: { id: string; name: string; price: number; fit: number | null }[] }[];
};

const BEDDING: ProductCategory[] = ["duvet_cover", "fitted_sheet", "bedspread"];
const BED_SIZE_PATTERN: Record<Exclude<BedSize, "unknown">, RegExp> = {
  twin: /twin|single/i,
  full: /full|double/i,
  queen: /queen/i,
  king: /king/i,
};

/** Brief "must have" phrases → categories that satisfy them. */
const MUST_HAVE_CATEGORIES: [RegExp, ProductCategory[]][] = [
  [/blanket|throw|cozy layer/i, ["throw", "bedspread", "faux_fur"]],
  [/rug|carpet|mat/i, ["rug", "faux_fur", "bath_mat"]],
  [/lamp|lighting|light/i, ["table_lamp", "floor_lamp", "pendant_light", "wall_light"]],
  [/pillow|cushion/i, ["cushion", "cushion_cover"]],
  [/curtain|drape/i, ["curtain", "shower_curtain"]],
  [/plant|greenery/i, ["plant"]],
  [/storage|basket/i, ["storage", "bath_storage"]],
  [/sofa|couch|seating/i, ["sofa", "armchair"]],
  [/dining|table/i, ["dining_table"]],
  [/towel/i, ["towels"]],
  [/bedding|duvet|comforter|sheet/i, ["duvet_cover", "bedspread", "fitted_sheet"]],
  [/art|wall decor|poster/i, ["wall_decor"]],
];

const LAMP_SOCKETS = /\bE(26|12)\b/i;

export function bulbBase(p: Product): string | null {
  return `${p.name} ${p.type}`.match(/\b(E26|E12|E14|E27|GU10|GU5\.3|G9)\b/i)?.[1].toUpperCase() ?? null;
}

export function matchesBedSize(p: Product, bed: BedSize): boolean | null {
  if (bed === "unknown" || !p.size) return null;
  return BED_SIZE_PATTERN[bed].test(p.size);
}

export function validateShoppingList(
  items: ShoppingItem[],
  catalog: Product[],
  brief: Brief,
  room: RoomProfile | null,
  roomType: RoomType = brief.roomType ?? room?.roomType ?? "bedroom",
): ValidationResult {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: ShoppingLine[] = [];

  const seen = new Set<string>();
  for (const it of items) {
    const p = byId.get(it.productId);
    if (!p) {
      errors.push(`Product ${it.productId} is not in the catalog — search for it first or pick another id.`);
      continue;
    }
    if (seen.has(p.id)) {
      errors.push(`Product ${p.id} (${p.name}) is listed twice; combine into one line with a higher qty.`);
      continue;
    }
    seen.add(p.id);
    if (it.qty > 6) errors.push(`Quantity ${it.qty} for ${p.name} is implausible for one bedroom.`);
    lines.push({ ...it, product: p, lineTotal: money(p.price * it.qty) });
  }

  const total = money(lines.reduce((s, l) => s + l.lineTotal, 0));
  const budget = brief.budget;
  if (budget !== null && total > budget) {
    errors.push(`Total $${total} exceeds the $${budget} budget by $${money(total - budget)}.`);
  } else if (budget !== null && total < budget * 0.6 && lines.length > 0) {
    warnings.push(`Uses only $${total} of the $${budget} budget — fine if intentional, but there may be room for more impact.`);
  }

  const count = (cats: ProductCategory[]) => lines.filter((l) => cats.includes(l.product.category)).reduce((s, l) => s + l.qty, 0);

  // Bedding must fit the mattress.
  const bed = room?.bedSize ?? "unknown";
  for (const l of lines.filter((l) => BEDDING.includes(l.product.category))) {
    const fits = matchesBedSize(l.product, bed);
    if (fits === false) errors.push(`${l.product.name} (${l.product.size}) does not fit a ${bed} bed.`);
    if (fits === null && bed === "unknown") warnings.push(`Bed size unknown — confirm ${l.product.name} (${l.product.size || "no size listed"}) fits.`);
  }
  if (count(["duvet_cover"]) > 1) warnings.push("More than one duvet cover — intentional spare?");

  // Bulbs must fit the lamps in this list (North American table/floor lamps take E26 or E12).
  const lamps = lines.filter((l) => l.product.category === "table_lamp" || l.product.category === "floor_lamp");
  for (const l of lines.filter((l) => l.product.category === "bulb")) {
    const base = bulbBase(l.product);
    if (lamps.length === 0) warnings.push(`${l.product.name} bulb added but no lamp is on the list — is it for an existing fixture?`);
    else if (base && !LAMP_SOCKETS.test(base)) errors.push(`${l.product.name} is a ${base} bulb; the lamps on this list take E26/E12.`);
  }
  const bulbs = count(["bulb"]);
  if (lamps.length > 0 && bulbs > lamps.reduce((s, l) => s + l.qty, 0)) warnings.push(`${bulbs} bulbs for ${lamps.length} lamp(s) — check you need the spares.`);

  // Table lamps need somewhere to sit.
  const tableLamps = count(["table_lamp"]);
  if (room && tableLamps > room.lampSurfaces) {
    errors.push(`${tableLamps} table lamps but the room has only ${room.lampSurfaces} surface(s) for one. Use a floor lamp or drop one.`);
  }

  // Cushion covers need inserts unless the user already has them.
  const covers = count(["cushion_cover"]);
  const inserts = lines.filter((l) => l.product.category === "cushion" && /inner|insert/i.test(l.product.type)).reduce((s, l) => s + l.qty, 0);
  if (covers > inserts) warnings.push(`${covers} cushion cover(s) but ${inserts} insert(s) — the user needs inserts unless they own them.`);

  // Room-type rules.
  if (roomType === "bathroom") {
    for (const l of lines.filter((l) => ["table_lamp", "floor_lamp"].includes(l.product.category))) {
      errors.push(`${l.product.name} is a plug-in lamp — not safe in a bathroom. Use the existing fixtures or a rated vanity light.`);
    }
  }
  if (lines.some((l) => l.product.category === "dining_table") && count(["dining_chair"]) < 2) {
    warnings.push("A dining table with fewer than 2 chairs — is the user keeping their current chairs?");
  }

  // Respect the brief.
  for (const term of brief.avoid) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    for (const l of lines) {
      if (re.test(`${l.product.name} ${l.product.type} ${l.product.colour}`)) errors.push(`${l.product.name} conflicts with "avoid: ${term}".`);
    }
  }
  for (const want of brief.mustHave) {
    const rule = MUST_HAVE_CATEGORIES.find(([re]) => re.test(want));
    if (!rule) continue;
    if (count(rule[1]) === 0) errors.push(`The user asked for "${want}" — include at least one of: ${rule[1].join(", ")}.`);
  }
  if (brief.rental) {
    for (const l of lines.filter((l) => l.product.category === "wall_decor" || l.product.category === "curtain")) {
      warnings.push(`${l.product.name}: rental — hang with removable hooks or a tension rod, no drilling.`);
    }
  }

  const breakdownMap = new Map<string, number>();
  for (const l of lines) breakdownMap.set(l.product.category, money((breakdownMap.get(l.product.category) ?? 0) + l.lineTotal));
  const breakdown = [...breakdownMap].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  const alternatives: ValidationResult["alternatives"] = [];
  if (budget !== null && total > budget) {
    for (const l of [...lines].sort((a, b) => b.lineTotal - a.lineTotal).slice(0, 3)) {
      const cheaper = catalog
        .filter((p) => p.category === l.product.category && p.price < l.product.price && !seen.has(p.id))
        .filter((p) => !BEDDING.includes(p.category) || matchesBedSize(p, bed) !== false)
        .sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0) || a.price - b.price)
        .slice(0, 3)
        .map((p) => ({ id: p.id, name: p.name, price: p.price, fit: p.fit?.score ?? null }));
      if (cheaper.length) alternatives.push({ replace: `${l.product.id} ${l.product.name} ($${l.product.price})`, with: cheaper });
    }
  }

  return { errors, warnings, lines, total, breakdown, alternatives };
}
