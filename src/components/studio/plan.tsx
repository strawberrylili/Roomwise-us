"use client";

import { ClipboardList, Clock, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/client/api";
import type { Task } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { Empty, Section } from "./common";
import type { StudioActions } from "./studio";

const PHASES: { key: Task["phase"]; title: string }[] = [
  { key: "prep", title: "Prepare" },
  { key: "purchase", title: "Buy" },
  { key: "setup", title: "Set up" },
  { key: "style", title: "Style" },
];

export function Plan({ project, setProject }: StudioActions) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const tasks = project.tasks;
  // Don't let a tick get lost by closing the tab mid-save.
  useEffect(() => {
    if (!pending.size) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.size]);
  if (!tasks.length) {
    return (
      <Section title="Makeover plan">
        <Empty icon={ClipboardList} title="No checklist yet" body="Once the shopping list is final, Roomwise writes an ordered checklist: what to clear first, what to buy, and how to put it together." />
      </Section>
    );
  }

  const done = tasks.filter((t) => t.done).length;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const lines = new Map(project.shoppingList?.lines.map((l) => [l.productId, l]) ?? []);

  async function toggle(t: Task, value: boolean) {
    setPending((s) => new Set(s).add(t.id));
    // Optimistic: the checkbox flips immediately, reverts on failure.
    setProject({ ...project, tasks: project.tasks.map((x) => (x.id === t.id ? { ...x, done: value } : x)) });
    try {
      setProject(await api.setTask(project.id, t.id, value));
    } catch (e) {
      setProject({ ...project });
      toast.error(e instanceof Error ? e.message : "Couldn't update task");
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Makeover plan" description={project.stale.includes("tasks") ? "Your shopping list changed — ask the designer to refresh the checklist." : `${done} of ${tasks.length} done`}>
        <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={done} aria-label="Tasks completed">
          <div className="h-full origin-left rounded-full bg-success transition-transform duration-[400ms] ease-out" style={{ transform: `scaleX(${done / tasks.length})` }} />
        </div>
      </Section>
      {PHASES.map(({ key, title }) => {
        const list = tasks.filter((t) => t.phase === key);
        if (!list.length) return null;
        return (
          <section key={key} className="flex flex-col gap-2" aria-labelledby={`phase-${key}`}>
            <h3 id={`phase-${key}`} className="font-sans text-sm font-medium text-text-muted">
              {title} · {list.filter((t) => t.done).length}/{list.length}
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface-raised">
              {list.map((t) => {
                const blockers = t.dependsOn.map((d) => byId.get(d)).filter((d): d is Task => !!d && !d.done);
                const line = t.productId ? lines.get(t.productId) : undefined;
                return (
                  <li key={t.id} className="flex items-start gap-3 p-3">
                    <Checkbox id={t.id} checked={t.done} disabled={pending.has(t.id)} onCheckedChange={(v) => toggle(t, v === true)} className="mt-0.5" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <label htmlFor={t.id} className={cn("cursor-pointer text-sm font-medium", t.done && "text-text-muted line-through")}>
                        {t.title}
                      </label>
                      <p className="text-sm text-text-muted">{line ? `${line.product.type} — ${line.placement}` : t.detail}</p>
                      <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs text-text-muted">
                        {t.minutes && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" aria-hidden /> {t.minutes} min
                          </span>
                        )}
                        {blockers.length > 0 && !t.done && <span>After: {blockers.map((b) => b.title).join(", ")}</span>}
                        {line && (
                          <a href={line.product.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-text underline-offset-4 hover:underline">
                            Open product <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
