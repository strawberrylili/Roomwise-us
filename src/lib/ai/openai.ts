import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { mockEnabled, mockImage, mockStructured } from "../mock/ai";

let client: OpenAI | null = null;

export function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (add it to .env.local)");
  // The SDK retries 429/5xx/connection errors with exponential backoff.
  client ??= new OpenAI({ maxRetries: 3, timeout: 180_000 });
  return client;
}

export type ImageInput = { dataUrl: string } | { url: string };
export type Effort = "minimal" | "low" | "medium" | "high";

/** One structured-output call: text (+ optional images) in, schema-validated object out. */
export async function structured<S extends z.ZodType>(opts: {
  model: string;
  schema: S;
  name: string;
  system: string;
  prompt: string;
  images?: ImageInput[];
  detail?: "low" | "high" | "auto";
  effort?: Effort;
}): Promise<z.infer<S>> {
  if (mockEnabled()) return mockStructured(opts.name, opts.schema, opts.prompt);
  const content: OpenAI.Responses.ResponseInputContent[] = [{ type: "input_text", text: opts.prompt }];
  for (const img of opts.images ?? []) {
    content.push({ type: "input_image", image_url: "dataUrl" in img ? img.dataUrl : img.url, detail: opts.detail ?? "auto" });
  }
  const res = await openai().responses.parse({
    model: opts.model,
    reasoning: { effort: opts.effort ?? "low" },
    input: [
      { role: "system", content: opts.system },
      { role: "user", content },
    ],
    text: { format: zodTextFormat(opts.schema, opts.name) },
  });
  if (!res.output_parsed) throw new Error(`${opts.name}: model returned no parseable output`);
  return res.output_parsed as z.infer<S>;
}

export async function editImage(opts: {
  model: string;
  images: { data: Buffer; name: string; type: string }[];
  prompt: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
}): Promise<Buffer> {
  if (mockEnabled()) return mockImage(opts.prompt, opts.size);
  const files = await Promise.all(opts.images.map((i) => toFile(i.data, i.name, { type: i.type })));
  const res = await openai().images.edit({
    model: opts.model,
    image: files,
    prompt: opts.prompt,
    size: opts.size,
    quality: "high",
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image API returned no image");
  return Buffer.from(b64, "base64");
}

export function toDataUrl(data: Buffer, type = "image/jpeg") {
  return `data:${type};base64,${data.toString("base64")}`;
}
