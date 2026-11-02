"use client";

import { ArrowUp, Check, ChevronRight, CircleAlert, Loader2, RotateCw, Square, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { RunEvent } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { TOOL_LABELS } from "./common";
import type { StudioActions } from "./studio";

type Step = { key: number; tool: string; summary: string; ok: boolean | null; ms: number | null; notes: { type: string; text: string }[] };

function stepsByRun(events: RunEvent[]) {
  const runs = new Map<string, Step[]>();
  for (const e of events) {
    const steps = runs.get(e.runId) ?? [];
    runs.set(e.runId, steps);
    if (e.type === "tool_call" && e.tool) steps.push({ key: e.seq, tool: e.tool, summary: "", ok: null, ms: null, notes: [] });
    const open = [...steps].reverse().find((s) => s.tool === e.tool && s.ok === null);
    if (e.type === "tool_result" && e.tool) {
      if (open) Object.assign(open, { ok: e.ok, summary: e.summary, ms: e.durationMs });
      else steps.push({ key: e.seq, tool: e.tool, summary: e.summary, ok: e.ok, ms: e.durationMs, notes: [] });
    }
    if ((e.type === "retry" || e.type === "validator") && open) open.notes.push({ type: e.type, text: e.summary });
    if (e.type === "error") steps.push({ key: e.seq, tool: "error", summary: e.summary, ok: false, ms: null, notes: [] });
  }
  return runs;
}

const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const } };

export function DesignerPanel({ project, setProject, send, refresh, events }: StudioActions & { events: RunEvent[] }) {
  const [text, setText] = useState("");
  const [savingMode, setSavingMode] = useState(false);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const runs = useMemo(() => stepsByRun(events), [events]);
  const activeRun = project.running ? project.runs.at(-1) : undefined;
  const liveSteps = activeRun ? (runs.get(activeRun.id) ?? []) : [];
  const current = liveSteps.findLast((s) => s.ok === null);
  const pending = project.pending;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [project.messages.length, liveSteps.length, pending?.id]);

  async function submit(value = text) {
    const v = value.trim();
    if (!v) return;
    setSending(true);
    try {
      const ok = pending ? await answer(v) : await send(v);
      if (ok) setText("");
    } finally {
      setSending(false);
    }
  }

  async function answer(v: string, approve?: boolean) {
    try {
      await api.answer(project.id, pending!.id, v, approve);
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send your answer");
      return false;
    }
  }

  async function toggleAutopilot() {
    const next = !project.autopilot;
    setSavingMode(true);
    try {
      setProject(await api.patchProject(project.id, { autopilot: next }));
      // A question is waiting: let the designer pick it up and decide for itself.
      if (next && pending && !project.running) await answer("Autopilot is on — decide for me and keep going.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change mode");
    } finally {
      setSavingMode(false);
    }
  }

  const lastRunByMessage = new Map(project.messages.filter((m) => m.role === "assistant" && m.runId).map((m) => [m.runId!, m.id]));

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border py-3 pr-12 pl-4 xl:pr-4">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand text-primary-foreground">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">AI Designer</p>
          <p className="truncate text-xs text-text-muted" aria-live="polite">
            {project.running ? (current ? `${TOOL_LABELS[current.tool] ?? current.tool}…` : "Thinking…") : pending ? "Waiting for your answer" : "Ready for instructions"}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={project.autopilot}
          aria-label="Autopilot"
          title={project.autopilot ? "Autopilot: the designer decides and lists its assumptions" : "Interactive: the designer asks before decisions that change the design"}
          onClick={toggleAutopilot}
          disabled={savingMode}
          className="group flex shrink-0 items-center gap-2 rounded-full py-1 pr-1 pl-2.5 text-xs font-medium text-text-muted transition-colors duration-150 hover:text-text"
        >
          Autopilot
          <span className={cn("relative h-5 w-9 rounded-full transition-colors duration-150", project.autopilot ? "bg-brand" : "bg-border-interactive")}>
            <span
              className={cn(
                "absolute top-0.5 left-0.5 size-4 rounded-full bg-surface-raised shadow-sm transition-transform duration-[250ms] ease-[var(--ease-spring)]",
                project.autopilot && "translate-x-4",
              )}
            />
          </span>
        </button>
        {project.running && (
          <Button variant="outline" size="sm" onClick={() => api.stop(project.id).then(refresh)}>
            <Square className="size-3 fill-current" aria-hidden /> Stop
          </Button>
        )}
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {project.messages.length === 0 && !project.running && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-strong p-4 text-sm">
            <p className="font-medium">Your designer is ready</p>
            <p className="text-text-muted">Add photos and a brief in the Workspace, or just tell me what you want here — “cozy, beige, lots of blankets, $500”.</p>
          </div>
        )}

        {project.messages.map((m) => {
          const steps = m.role === "assistant" && m.runId && lastRunByMessage.get(m.runId) === m.id ? (runs.get(m.runId) ?? []) : [];
          return (
            <motion.div key={m.id} {...fade} className={cn("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}>
              {steps.length > 0 && <StepsDisclosure steps={steps} />}
              <div className={cn("max-w-[92%] rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap", m.role === "user" ? "rounded-br-sm bg-brand text-primary-foreground" : "rounded-bl-sm border border-border bg-surface-raised")}>
                {m.role === "user" ? m.text.replace(/\n\n\(answering: "[\s\S]*"\)$/, "") : m.text}
              </div>
            </motion.div>
          );
        })}

        <AnimatePresence>
          {project.running && (
            <motion.div {...fade} exit={{ opacity: 0 }} className="flex flex-col gap-1 rounded-md border border-border bg-surface-raised p-3" aria-label="Designer activity">
              <ul className="flex flex-col gap-1.5">
                {liveSteps.slice(-8).map((s) => (
                  <StepRow key={s.key} step={s} />
                ))}
                {liveSteps.length === 0 && (
                  <li className="flex items-center gap-2 text-sm text-text-muted">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading your project…
                  </li>
                )}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {pending && !project.running && (
          <motion.div {...fade} className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning-bg p-3">
            <p className="text-xs font-medium text-warning-text">{pending.kind === "approval" ? "Needs your OK" : pending.kind === "choice" ? "Your call" : "Quick question"}</p>
            {pending.options.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {pending.options.map((o, i) => (
                  <Button
                    key={o}
                    variant={pending.kind === "approval" && i === 0 ? "default" : "outline"}
                    size="sm"
                    className="h-auto justify-start py-1.5 text-left whitespace-normal"
                    disabled={sending}
                    onClick={async () => {
                      setSending(true);
                      await answer(o, pending.kind === "approval" ? i === 0 : undefined);
                      setSending(false);
                    }}
                  >
                    {o}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-xs text-text-muted">…or type your own answer below.</p>
          </motion.div>
        )}

        {!project.running && project.runs.at(-1)?.status === "failed" && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger-bg p-3 text-sm text-danger-text">
            <span className="flex items-center gap-2">
              <CircleAlert className="size-4 shrink-0" aria-hidden /> The last request didn&apos;t finish.
            </span>
            <Button size="sm" variant="outline" onClick={() => submit("Please continue where you left off.")}>
              <RotateCw aria-hidden /> Continue
            </Button>
          </div>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-border-interactive bg-surface p-1.5 focus-within:ring-3 focus-within:ring-ring/50">
          <label htmlFor="designer-input" className="sr-only">
            Message the designer
          </label>
          <textarea
            id="designer-input"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={project.running ? "Designer is working…" : pending ? "Type your answer" : project.autopilot ? "Autopilot is on — tell me what you want and I'll take it from there" : "Ask for a change, e.g. “swap the rug for wool”"}
            disabled={project.running || sending}
            className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-text-muted"
          />
          <Button type="submit" size="icon-sm" disabled={project.running || sending || !text.trim()} aria-label="Send">
            {sending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function StepsDisclosure({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const failed = steps.filter((s) => s.ok === false).length;
  return (
    <div className="w-full">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1 rounded-sm text-xs text-text-muted transition-colors duration-150 hover:text-text">
        <ChevronRight className={cn("size-3 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        {steps.length} steps{failed ? ` · ${failed} recovered` : ""}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="mt-2 flex flex-col gap-1.5 border-l border-border pl-3">
            {steps.map((s) => (
              <StepRow key={s.key} step={s} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="flex flex-col gap-0.5 text-sm">
      <span className="flex items-center gap-2">
        {step.ok === null ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-text" aria-label="In progress" />
        ) : step.ok ? (
          <Check className="size-3.5 shrink-0 text-success-text" aria-label="Done" />
        ) : (
          <CircleAlert className="size-3.5 shrink-0 text-warning-text" aria-label="Failed" />
        )}
        <span className="min-w-0 flex-1 truncate">{TOOL_LABELS[step.tool] ?? (step.tool === "error" ? "Problem" : step.tool)}</span>
        {step.ms !== null && step.ms > 900 && <span className="shrink-0 text-xs text-text-muted tabular-nums">{(step.ms / 1000).toFixed(0)}s</span>}
      </span>
      {(step.summary || step.notes.length > 0) && (
        <span className="pl-5.5 text-xs text-text-muted">
          {step.notes.map((n) => (
            <span key={n.text} className="block">
              {n.type === "retry" ? "↻ " : "✓ "}
              {n.text}
            </span>
          ))}
          {step.summary && <span className="line-clamp-2 block">{step.summary}</span>}
        </span>
      )}
    </li>
  );
}
