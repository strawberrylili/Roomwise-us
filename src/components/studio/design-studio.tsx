"use client";

import { Heart, Images, Loader2, Palette, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, fileUrl, money } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Empty, Pill, Section, Swatches } from "./common";
import type { StudioActions } from "./studio";

const QUICK_REVISIONS = ["Make it warmer", "Lighter, plusher rug", "More texture on the bed", "Bring the cost down"];

type Kind = "inspiration" | "shoppable";

export function DesignStudio(props: StudioActions) {
  const { project } = props;
  const hasInspo = project.renders.some((r) => r.kind === "inspiration");
  const hasShop = project.renders.some((r) => r.kind === "shoppable");
  const [kindChoice, setKind] = useState<Kind | null>(null);
  const kind: Kind = kindChoice ?? (hasInspo || !hasShop ? "inspiration" : "shoppable");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const renders = project.renders.filter((r) => r.kind === kind);
  const render = renders.find((r) => r.id === selectedId) ?? renders.at(-1) ?? null;
  const rendering = project.running && !!project.selectedDirectionId && !render;

  return (
    <div className="flex flex-col gap-10">
      {hasInspo && (
        <div className="-mb-4 inline-flex w-fit rounded-md bg-surface-sunken p-0.5" role="radiogroup" aria-label="Render type">
          {(["inspiration", "shoppable"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => (setKind(k), setSelectedId(null))}
              className={cn("rounded-sm px-3 py-1 text-sm font-medium transition-colors duration-150", kind === k ? "bg-surface-raised shadow-sm" : "text-text-muted hover:text-text")}
            >
              {k === "inspiration" ? "Inspiration" : "With real products"}
            </button>
          ))}
        </div>
      )}
      {render ? (
        <RenderHero {...props} renderId={render.id} />
      ) : rendering ? (
        <Section title="Your room, redesigned" description={kind === "inspiration" ? "Clearing your room and furnishing it with the concept — about a minute." : "Rendering your room with the products on your list — about 30 seconds."}>
          <Skeleton className="aspect-[4/3] w-full rounded-lg" />
        </Section>
      ) : (
        <Section title="Your room, redesigned">
          <Empty
            icon={Images}
            title={kind === "shoppable" ? "No real-product render yet" : "No renders yet"}
            body={
              kind === "shoppable"
                ? "After the shopping list is built, Roomwise renders the same design with the exact products you can order."
                : project.directions.length
                  ? "Pick a concept and Roomwise renders it in your actual room."
                  : "Roomwise renders your actual room once it has a design concept."
            }
          />
        </Section>
      )}

      {renders.length > 1 && (
        <Section title="Versions" description="Every render is kept. Pick one to compare.">
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {[...renders].reverse().map((r, i) => (
              <li key={r.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  aria-pressed={render?.id === r.id}
                  className={cn("relative block w-28 overflow-hidden rounded-md border-2 transition-colors duration-150", render?.id === r.id ? "border-brand" : "border-transparent hover:border-border-strong")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, owner-gated file route */}
                  <img src={fileUrl(r.path)} alt={`Version ${renders.length - i}`} className="aspect-[3/4] w-full object-cover" />
                  {r.id === project.chosenRenderId && (
                    <span className="absolute top-1 right-1 rounded-full bg-surface p-1 text-brand-text shadow-sm">
                      <Heart className="size-3 fill-current" aria-label="Your pick" />
                    </span>
                  )}
                  <span className="block truncate bg-surface-raised px-2 py-1 text-left text-xs text-text-muted">{r.revisionNote ? "Revision" : "Concept"} · v{renders.length - i}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Directions {...props} />
    </div>
  );
}

function RenderHero({ project, setProject, send, renderId }: StudioActions & { renderId: string }) {
  const render = project.renders.find((r) => r.id === renderId)!;
  const photo = project.photos.find((p) => p.id === render.photoId);
  // How much of the redesign is showing, 0 (all before) → 100 (all after). Before sits on the left of the divider.
  const [after, setAfter] = useState(100);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState("");
  const chosen = project.chosenRenderId === render.id;
  const c = render.critique;
  const outdated = project.renders.findLast((r) => r.kind === render.kind)?.id === render.id && project.stale.includes(render.kind === "inspiration" ? "inspiration" : "render");

  async function choose() {
    setSaving(true);
    try {
      setProject(await api.patchProject(project.id, { chosenRenderId: chosen ? null : render.id }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function revise(text: string) {
    if (!text.trim()) return;
    if (await send(text.trim())) setRevision("");
  }

  return (
    <Section
      title="Your room, redesigned"
      description={
        <span className="line-clamp-2">
          {render.revisionNote ? "Revision · " : ""}
          {project.directions.find((d) => d.id === render.directionId)?.name ?? "Concept"}
          {render.kind === "shoppable" ? ` · ${render.productIds.length} real products` : " · the design at full ambition"}
        </span>
      }
      action={
        <Button variant={chosen ? "secondary" : "outline"} size="sm" onClick={choose} disabled={saving} aria-pressed={chosen}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Heart className={cn(chosen && "fill-current text-brand-text")} aria-hidden />}
          {chosen ? "Your pick" : "This is the one"}
        </Button>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <figure className="flex flex-col gap-2">
          <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-border bg-surface-sunken shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, owner-gated file route */}
            <img src={fileUrl(render.path)} alt="Redesigned room" className="mx-auto block max-h-[70vh] w-auto" />
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element -- private, owner-gated file route
              <img
                src={fileUrl(photo.path)}
                alt="Original room"
                aria-hidden={after === 100}
                className="pointer-events-none absolute inset-0 size-full object-cover"
                style={{ clipPath: `inset(0 ${after}% 0 0)` }}
              />
            )}
            {photo && after < 100 && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-surface shadow-md" style={{ left: `${100 - after}%` }} aria-hidden />}
            {photo && after > 0 && after < 100 && (
              <>
                <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-scrim px-2 py-0.5 text-xs font-medium text-on-scrim">Before</span>
                <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-scrim px-2 py-0.5 text-xs font-medium text-on-scrim">After</span>
              </>
            )}
          </div>
          {photo && (
            <label className="mx-auto flex w-full max-w-xl items-center gap-3 text-xs text-text-muted">
              <span>Before</span>
              <input type="range" min={0} max={100} value={after} onChange={(e) => setAfter(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" aria-label="Compare before and after" />
              <span>After</span>
            </label>
          )}
          {outdated && <p className="text-center text-sm text-warning-text">Your plan changed since this render — ask the designer to update it.</p>}
        </figure>

        <div className="flex flex-col gap-4">
          {c ? (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Designer review</p>
                <Pill tone={c.pass ? "success" : "warning"}>{c.pass ? "Passed" : "Needs work"}</Pill>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Your room", c.structure],
                  render.kind === "inspiration" ? ["Design", c.designQuality ?? "–"] : ["Products", c.productFidelity ?? "–"],
                  ["Brief", c.briefFit],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-sm bg-surface-sunken p-2">
                    <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                    <dt className="text-xs text-text-muted">{k}</dt>
                  </div>
                ))}
              </dl>
              {c.issues.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-text-muted">{c.issues.length} note{c.issues.length > 1 ? "s" : ""}</summary>
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-text-muted">
                    {c.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Not reviewed yet.</p>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              revise(revision);
            }}
          >
            <label htmlFor="revision" className="text-sm font-medium">
              Change something
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REVISIONS.map((q) => (
                <button key={q} type="button" onClick={() => revise(q)} disabled={project.running} className="rounded-full border border-border-interactive px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-surface-hover disabled:opacity-55">
                  {q}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                id="revision"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="e.g. swap the lamp for something taller"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                disabled={project.running}
              />
              <Button type="submit" size="icon" disabled={project.running || !revision.trim()} aria-label="Send revision">
                <Wand2 aria-hidden />
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Section>
  );
}

function Directions({ project, send }: StudioActions) {
  if (!project.directions.length) {
    return (
      <Section title="Design directions">
        <Empty icon={Palette} title="No directions yet" body="Roomwise proposes two or three distinct directions — palette, materials and the moves that matter most — after studying your room." />
      </Section>
    );
  }
  const choosing = project.pending?.kind === "choice";
  return (
    <Section title="Design directions" description={choosing ? "Pick one to continue — or ask for something different in the chat." : undefined}>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {project.directions.map((d) => {
          const selected = d.id === project.selectedDirectionId;
          return (
            <li key={d.id} className={cn("flex flex-col gap-3 rounded-md border bg-surface-raised p-4", selected ? "border-brand shadow-md" : "border-border")}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base">{d.name}</h3>
                {selected && <Pill tone="brand">Selected</Pill>}
              </div>
              <Swatches colors={d.palette} />
              <p className="text-sm text-text-muted">{d.summary}</p>
              {d.focalPoint && (
                <p className="text-sm">
                  <span className="font-medium">Focal point · </span>
                  {d.focalPoint}
                </p>
              )}
              {(d.layout || d.pieces.length > 0) && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-text-muted">
                    Concept details{d.layoutChange ? " · new layout" : ""}
                  </summary>
                  <div className="mt-2 flex flex-col gap-2 text-text-muted">
                    {d.layout && <p>{d.layout}</p>}
                    {d.pieces.length > 0 && (
                      <ul className="flex list-disc flex-col gap-0.5 pl-4">
                        {d.pieces.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    )}
                    {d.lighting && <p>Light: {d.lighting}</p>}
                  </div>
                </details>
              )}
              <ul className="flex flex-col gap-1 text-sm">
                {d.moves.slice(0, 4).map((m) => (
                  <li key={m.title} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0">{m.title}</span>
                    <span className="shrink-0 text-xs text-text-muted">{m.impact} impact</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="text-sm text-text-muted">≈ {money(d.estimatedCost)}</span>
                {!selected && (
                  <Button size="sm" variant={choosing ? "default" : "outline"} onClick={() => send(`Let's go with "${d.name}" (${d.id}).`)} disabled={project.running}>
                    Use this
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
