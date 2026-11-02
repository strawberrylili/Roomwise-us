// Spike 1: full redesign, no budget, nothing kept but architecture.
// Designer concept (LLM) → (B) one-step redesign edit, (C) empty room → furnish.
// Usage: node --env-file=.env.local spike/redesign.mjs <photo>
import OpenAI, { toFile } from "openai";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const photo = process.argv[2];
const OUT = "spike/out/redesign";
const IMAGE_MODEL = "gpt-image-2.5-sunburst";
const client = new OpenAI();
await mkdir(OUT, { recursive: true });
const original = await readFile(photo);
const dataUrl = `data:image/jpeg;base64,${original.toString("base64")}`;

const BRIEF = `Client: wants it cozy, beige or lighter colours, lots of blankets. No budget limit. Everything in the room can go — furniture, bed, decor — design from scratch.
They rent: walls, ceiling, window, closet doors and floor stay (renter-friendly additions like plug-in sconces, ceiling-track curtains, removable wallpaper are fine).`;

const PRINCIPLES = `Design like a top residential interior designer, not a decorator:
- One clear focal point (usually the bed wall): an upholstered or wood headboard, wall treatment, art or sconces that make it a composed vignette.
- Scale and proportion: furniture sized to the room; rug large enough to sit under 2/3 of the bed; curtains hung high and wide, floor-length, to make the window and ceiling feel bigger.
- Three layers of light: ambient, task (bedside), accent (sconces, a floor lamp, LED behind headboard). Warm 2700K.
- Colour: 60-30-10 — a dominant warm neutral, a secondary tone, a small accent (oak, brass, sage, terracotta…).
- Texture is what makes neutral rooms feel rich: linen, bouclé, wool, oak, rattan, ceramic, plaster.
- Symmetry or deliberate asymmetry; negative space; nothing floating randomly.
- Layout must work: door swing, closet access, walkway ≥ 60 cm, bed reachable from both sides if possible.
- Personality: one or two surprising, memorable moves so it feels designed, not catalogue.`;

const Concept = {
  type: "object",
  additionalProperties: false,
  required: ["concepts"],
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "idea", "layout", "focalPoint", "furniture", "lighting", "textiles", "walls", "styling", "palette", "renderPrompt"],
        properties: {
          name: { type: "string" },
          idea: { type: "string", description: "the design idea in 2 sentences" },
          layout: { type: "string", description: "where the bed and each piece go, relative to window/door/closet in the photo" },
          focalPoint: { type: "string" },
          furniture: { type: "array", items: { type: "string" }, description: "each piece with material, colour, size" },
          lighting: { type: "string" },
          textiles: { type: "string" },
          walls: { type: "string" },
          styling: { type: "string", description: "objects, art, plants, the finishing layer" },
          palette: { type: "array", items: { type: "string" } },
          renderPrompt: { type: "string", description: "a dense, visual paragraph describing the finished room for an image model: every piece, material, colour, placement, light quality. No camera instructions." },
        },
      },
    },
  },
};

console.log("Designing concepts…");
const res = await client.responses.create({
  model: "gpt-5.5",
  reasoning: { effort: "high" },
  input: [
    { role: "system", content: PRINCIPLES },
    {
      role: "user",
      content: [
        { type: "input_text", text: `${BRIEF}\n\nStudy the photo (architecture, light, dimensions — roughly 8.5 x 10.5 ft, window with roller blind on the right wall, sliding closet on the left, door where the photo is taken from). Create TWO genuinely different, inspiring concepts for a complete redesign.` },
        { type: "input_image", image_url: dataUrl, detail: "high" },
      ],
    },
  ],
  text: { format: { type: "json_schema", name: "concepts", schema: Concept, strict: true } },
});
const { concepts } = JSON.parse(res.output_text);
await writeFile(`${OUT}/concepts.json`, JSON.stringify(concepts, null, 2));
for (const c of concepts) console.log(`- ${c.name}: ${c.idea}`);

const ARCH = `PRESERVE EXACTLY (same camera position, lens, perspective and framing): walls and their positions, ceiling and recessed light, window and white roller blind on the right wall, sliding closet doors on the left, the doorway framing in the foreground, the wood-look floor.`;

async function edit(images, prompt, name) {
  const t0 = Date.now();
  const files = await Promise.all(images.map((b, i) => toFile(b, `img${i}.png`, { type: "image/png" })));
  const r = await client.images.edit({ model: IMAGE_MODEL, image: files, prompt, size: "1024x1536", quality: "high" });
  const buf = Buffer.from(r.data[0].b64_json, "base64");
  await writeFile(`${OUT}/${name}.png`, buf);
  console.log(`  ${name} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return buf;
}

const finish = (c) => `THE NEW DESIGN — "${c.name}": ${c.renderPrompt}
Layout: ${c.layout}
Photorealistic interior photograph, as if shot for an editorial magazine on the client's phone from this exact spot: natural, believable, warm evening light, true-to-life materials and scale.`;

// Step C1: empty the room.
const emptyP = edit(
  [original],
  `Image 1 is a real bedroom. Remove EVERYTHING that is not architecture: bed, mattress, nightstand, mirror, stuffed animal, pillows, shoes, bags, cables, all objects. Leave the room completely empty and clean.
${ARCH}
Fill revealed floor and walls naturally and consistently. Photorealistic, same lighting.`,
  "empty",
);

// Step B: one-step redesign from the original (concept 1).
const oneStepP = edit(
  [original],
  `Image 1 is the client's real bedroom. Completely redesign it — replace ALL furniture, bedding and decor; do not keep any existing furniture or objects.
${ARCH}
${finish(concepts[0])}`,
  "B-onestep-1",
);

const empty = await emptyP;
// Step C2: furnish the empty room, original as architecture reference.
await Promise.all([
  oneStepP,
  ...concepts.map((c, i) =>
    edit(
      [empty, original],
      `Image 1 is the client's bedroom, now empty. Image 2 is the same room before (use it only as a reference for architecture, scale and light — NOT for furniture).
Furnish Image 1 from scratch with this design.
${ARCH}
${finish(c)}`,
      `C-staged-${i + 1}`,
    ),
  ),
]);
console.log("done");
