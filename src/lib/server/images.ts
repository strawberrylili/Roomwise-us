import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { HttpError } from "./session";

const run = promisify(execFile);
const MAX_EDGE = 1536;

/** Any upload (JPEG/PNG/WebP/HEIC) → upright JPEG, longest edge ≤ 1536px. */
export async function normalizePhoto(data: Buffer, filename: string, mime: string) {
  let input = data;
  if (/heic|heif/i.test(mime) || /\.(heic|heif)$/i.test(filename)) input = await heicToJpeg(data);
  try {
    const img = sharp(input).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
    const { data: out, info } = await img.jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    return { data: out, width: info.width, height: info.height };
  } catch {
    throw new HttpError(415, `Couldn't read ${filename} as an image. Use JPEG, PNG, WebP or HEIC.`);
  }
}

async function heicToJpeg(data: Buffer) {
  if (process.platform !== "darwin") throw new HttpError(415, "HEIC photos are only supported on macOS hosts — export as JPEG.");
  const dir = await mkdtemp(join(tmpdir(), "roomwise-heic-"));
  try {
    await writeFile(join(dir, "in.heic"), data);
    await run("/usr/bin/sips", ["-s", "format", "jpeg", join(dir, "in.heic"), "--out", join(dir, "out.jpg")]);
    return await readFile(join(dir, "out.jpg"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
