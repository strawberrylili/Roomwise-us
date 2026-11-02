// Spike 0a: can image-edit models restyle a real room while preserving its structure?
// Usage: node --env-file=.env.local spike/render.mjs <photo> <model> [<model>...]
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const [photo, ...models] = process.argv.slice(2);
if (!photo || models.length === 0) {
  console.error("usage: render.mjs <photo> <model> [<model>...]");
  process.exit(1);
}

const prompt = `Redesign this exact bedroom as a cozy, warm, light-beige space. This is a photo edit, not a new room.

PRESERVE EXACTLY (same position, size, perspective, camera angle):
- Room architecture: walls, ceiling, recessed light, sliding closet door, window and white roller blind, baseboards, wood-look floor.
- The bed in the same spot and size, keeping its black metal frame.
- The tall arched floor mirror leaning on the left wall (its reflection should show the room only, no person).
- The black nightstand to the right of the bed and the teddy bear on the bed.

CHANGE (rental-friendly only: no paint, no drilling, no new furniture that blocks walkways):
- Bedding: layered oatmeal/beige linen duvet, cream sheets, several plush pillows in beige and ivory, a chunky knit cream throw draped across the foot of the bed, plus a soft faux-fur or waffle blanket.
- A large soft cream/beige textured rug under the bed extending into the walkway.
- A warm ceramic table lamp on the nightstand with a linen shade, glowing warm (2700K).
- Warm, soft evening lighting overall.
- Remove floor clutter (shoes, bags).

Photorealistic, natural phone-camera look, same lens and framing as the original.`;

const image = new Blob([await readFile(photo)], { type: "image/jpeg" });

await Promise.all(
  models.map(async (model) => {
    const form = new FormData();
    form.append("model", model);
    form.append("image", image, basename(photo));
    form.append("prompt", prompt);
    form.append("size", "1024x1536");
    form.append("quality", "high");
    const t0 = Date.now();
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    const body = await res.json();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`${model}: FAILED ${res.status} in ${secs}s: ${body.error?.message}`);
      return;
    }
    const out = `spike/out/${basename(photo, ".jpg")}--${model}.png`;
    await writeFile(out, Buffer.from(body.data[0].b64_json, "base64"));
    console.log(`${model}: ok in ${secs}s -> ${out} usage=${JSON.stringify(body.usage ?? {})}`);
  }),
);
