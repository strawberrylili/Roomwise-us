import type { Product, ProductCategory } from "../domain/schemas";
import { mockEnabled } from "../mock/ai";
import { mockProductImage, mockSearch } from "../mock/catalog";

const ENDPOINT = "https://sik.search.blue.cdtapps.com/us/en/search-result-page";

type IkeaProduct = {
  itemNo: string;
  name: string;
  typeName: string;
  itemMeasureReferenceText?: string;
  mainImageUrl?: string;
  pipUrl: string;
  onlineSellable?: boolean;
  ratingValue?: number;
  ratingCount?: number;
  colors?: { name: string }[];
  quickFacts?: { name: string }[];
  salesPrice?: { numeral?: number };
};

/** Real IKEA US listings via the public search endpoint ikea.com/us/en uses. No key needed. */
export async function searchIkea(query: string, category: ProductCategory, limit = 16): Promise<Product[]> {
  if (mockEnabled()) return mockSearch(query, category).slice(0, limit);
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&size=48&types=PRODUCT`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 RoomwiseAI" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`IKEA search "${query}" failed: HTTP ${res.status}`);
  const body = await res.json();
  const items: { product?: IkeaProduct }[] = body?.searchResultPage?.products?.main?.items ?? [];
  return items
    .map((i) => i.product)
    .filter((p): p is IkeaProduct => !!p && !!p.onlineSellable && !!p.salesPrice?.numeral && !!p.mainImageUrl)
    .slice(0, limit)
    .map((p) => ({
      id: `ikea-${p.itemNo}`,
      retailer: "IKEA US",
      category,
      name: p.name,
      type: p.typeName,
      colour: p.colors?.map((c) => c.name).join("/") ?? "",
      size: p.itemMeasureReferenceText ?? "",
      price: p.salesPrice!.numeral!,
      rating: p.ratingValue ? `${p.ratingValue.toFixed(1)} (${p.ratingCount ?? 0})` : "",
      material: p.quickFacts?.map((f) => f.name).join(", ") ?? "",
      image: p.mainImageUrl!,
      url: p.pipUrl,
      fit: null,
    }));
}

export async function fetchProductImage(url: string): Promise<Buffer | null> {
  if (mockEnabled()) return mockProductImage();
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 RoomwiseAI" }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
