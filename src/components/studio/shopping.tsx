"use client";

import { ExternalLink, ShoppingBag, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Empty, Pill, Section } from "./common";
import type { StudioActions } from "./studio";

const CATEGORY_LABELS: Record<string, string> = {
  duvet_cover: "Duvet cover",
  fitted_sheet: "Sheets",
  bedspread: "Bedspread",
  throw: "Throws",
  cushion: "Cushions",
  cushion_cover: "Cushion covers",
  faux_fur: "Faux fur",
  rug: "Rug",
  table_lamp: "Table lamp",
  floor_lamp: "Floor lamp",
  bulb: "Bulbs",
  curtain: "Curtains",
  wall_decor: "Wall decor",
  plant: "Plants",
  storage: "Storage",
  headboard: "Headboard",
  bed_frame: "Bed",
  nightstand: "Nightstands",
  side_table: "Side tables",
  dresser: "Dressers",
  shelf: "Shelves",
  bench: "Benches",
  mirror: "Mirrors",
  curtain_rod: "Curtain rods",
  wall_light: "Wall lights",
  sofa: "Sofa",
  armchair: "Armchairs",
  coffee_table: "Coffee table",
  media_unit: "Media unit",
  dining_table: "Dining table",
  dining_chair: "Dining chairs",
  sideboard: "Sideboard",
  pendant_light: "Pendant light",
  shower_curtain: "Shower curtain",
  bath_mat: "Bath mat",
  towels: "Towels",
  bath_storage: "Bath storage",
  other: "Other",
};

export function Shopping({ project }: StudioActions) {
  const list = project.shoppingList;
  if (!list) {
    return project.running && project.renders.some((r) => r.kind === "inspiration") ? (
      <Section title="Shopping list" description="Finding the closest real products to your concept…">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </Section>
    ) : (
      <Section title="Shopping list">
        <Empty icon={ShoppingBag} title="Nothing on the list yet" body="Once your concept is rendered, Roomwise finds the closest real IKEA US pieces, compares them by eye, and builds a list you can order." />
      </Section>
    );
  }

  const pct = list.budget ? Math.min(100, (list.total / list.budget) * 100) : 100;
  const remaining = list.budget ? list.budget - list.total : null;
  const outdated = project.stale.includes("shopping");

  return (
    <div className="flex flex-col gap-10">
      <Section title="Budget" description={outdated ? "Your brief or direction changed after this list was built — ask the designer to refresh it." : undefined}>
        <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-raised p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p>
              <span className="font-heading text-2xl font-semibold tabular-nums">{money(list.total)}</span>
              <span className="text-text-muted">{list.budget ? ` of ${money(list.budget)}` : " total"}</span>
            </p>
            {remaining === null ? (
              <Pill>No budget limit</Pill>
            ) : (
              <Pill tone={remaining >= 0 ? "success" : "danger"}>{remaining >= 0 ? `${money(remaining)} left` : `${money(-remaining)} over`}</Pill>
            )}
          </div>
          {list.budget !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={list.budget} aria-valuenow={list.total} aria-label="Budget used">
              <div className="h-full origin-left rounded-full bg-brand transition-transform duration-[400ms] ease-out" style={{ transform: `scaleX(${pct / 100})` }} />
            </div>
          )}
          <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {list.breakdown.map((b) => (
              <li key={b.category} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-text-muted">{CATEGORY_LABELS[b.category] ?? b.category}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                  <span className="block h-full origin-left rounded-full bg-brand/70" style={{ transform: `scaleX(${b.amount / list.total})` }} />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums">{money(b.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
        {list.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-warning/50 bg-warning-bg p-4 text-sm">
            {list.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`${list.lines.length} items`} description="Real IKEA US listings. Prices before tax; check stock before ordering.">
        <ul className="grid gap-3 md:grid-cols-2">
          {list.lines.map((l) => (
            <li key={l.productId} className="flex gap-4 rounded-md border border-border bg-surface-raised p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote retailer image */}
              <img src={l.product.image} alt="" className="size-24 shrink-0 rounded-sm bg-surface object-contain" loading="lazy" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.product.name}</p>
                    <p className="truncate text-sm text-text-muted">
                      {l.product.type}
                      {l.product.size ? ` · ${l.product.size}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-right tabular-nums">
                    {money(l.lineTotal)}
                    {l.qty > 1 && <span className="block text-xs text-text-muted">{l.qty} × {money(l.product.price)}</span>}
                  </p>
                </div>
                <p className="line-clamp-2 text-sm">{l.placement}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <Pill tone={l.impact === "high" ? "brand" : "neutral"}>{l.impact} impact</Pill>
                  {l.product.fit && <Pill>fit {l.product.fit.score}/10</Pill>}
                  <a
                    href={l.product.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn("ml-auto inline-flex items-center gap-1 rounded-sm text-sm text-brand-text underline-offset-4 hover:underline")}
                  >
                    View <ExternalLink className="size-3.5" aria-hidden />
                    <span className="sr-only">{l.product.name} at IKEA (opens in new tab)</span>
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
