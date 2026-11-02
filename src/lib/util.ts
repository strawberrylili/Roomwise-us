import { randomBytes } from "node:crypto";

export const now = () => new Date().toISOString();

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(6).toString("base64url")}`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function money(n: number) {
  return Math.round(n * 100) / 100;
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
