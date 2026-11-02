"use client";

import { AlertCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TOOL_LABELS: Record<string, string> = {
  analyze_room: "Studying your photos",
  get_preferences: "Recalling your taste",
  update_project: "Saving decisions",
  generate_design_plan: "Sketching design directions",
  select_direction: "Choosing a direction",
  search_products: "Searching IKEA US",
  compare_products: "Comparing products by eye",
  optimize_budget: "Fitting it to your budget",
  render_concept: "Rendering your new room",
  generate_room_image: "Rendering it with real products",
  critique_render: "Reviewing the render",
  create_tasks: "Writing your checklist",
  ask_user: "Asking you",
  finish: "Checking the plan is complete",
};

export function Section({ title, description, action, children, className }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg">{title}</h2>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border-strong p-6">
      <Icon className="size-5 text-text-subtle" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="text-sm text-text-muted">{body}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger-bg p-4 text-sm text-danger-text">
      <span className="flex items-center gap-2">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {message}
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "success" | "warning" | "danger"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-sunken text-text-muted border-border",
    brand: "bg-brand-subtle text-brand-text border-transparent",
    success: "bg-success-bg text-success-text border-transparent",
    warning: "bg-warning-bg text-warning-text border-transparent",
    danger: "bg-danger-bg text-danger-text border-transparent",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

export function Swatches({ colors, size = "md" }: { colors: { name: string; hex: string }[]; size?: "sm" | "md" }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Palette">
      {colors.map((c) => (
        <li key={c.hex + c.name} title={`${c.name} ${c.hex}`} className={cn("rounded-full border border-border-strong", size === "sm" ? "size-4" : "size-6")} style={{ background: c.hex }}>
          <span className="sr-only">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}
