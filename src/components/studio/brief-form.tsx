"use client";

import { Loader2, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, money } from "@/lib/client/api";
import { FUNCTIONS, roomLabel, type RoomType } from "@/lib/domain/rooms";
import type { Brief } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { Pill, Section } from "./common";
import type { StudioActions } from "./studio";

const SPACES: { value: RoomType | null; label: string }[] = [
  { value: null, label: "Let Roomwise work it out" },
  { value: "bedroom", label: "Bedroom" },
  { value: "living_room", label: "Living room" },
  { value: "dining", label: "Dining area" },
  { value: "living_dining", label: "Living + dining" },
  { value: "bathroom", label: "Bathroom" },
];
const INTENSITIES = [
  { value: "refresh", label: "Refresh", body: "Keep the furniture. New bedding, light, rug, art." },
  { value: "restyle", label: "Restyle", body: "Same layout, but furniture can be swapped." },
  { value: "redesign", label: "Redesign", body: "Everything can go except walls, window, doors and floor." },
] as const;
const STYLES = ["Cozy", "Warm minimal", "Japandi", "Scandinavian", "Boho", "Modern", "Coastal", "Cottage"];
const MUST_HAVES = ["Blankets", "Rug", "Lamp", "Cushions", "Curtains", "Plants", "Storage", "Wall art", "Sofa", "Dining table", "Towels"];
const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function BriefForm({ project, setProject, send }: StudioActions) {
  const brief = project.brief;
  const [editing, setEditing] = useState(!brief);
  const [saving, setSaving] = useState(false);
  const [style, setStyle] = useState<string[]>(brief?.style ?? []);
  const [description, setDescription] = useState(brief?.description ?? "");
  const [colors, setColors] = useState((brief?.colors ?? []).join(", "));
  const [budget, setBudget] = useState(brief?.budget ? String(brief.budget) : "");
  const [noLimit, setNoLimit] = useState(brief ? brief.budget === null : false);
  const [intensity, setIntensity] = useState<Brief["intensity"]>(brief?.intensity ?? "redesign");
  const [roomType, setRoomType] = useState<RoomType | null>(brief ? brief.roomType : null);
  const [functions, setFunctions] = useState<string[]>(brief?.functions ?? []);
  const [rental, setRental] = useState(brief?.rental ?? true);
  const [keep, setKeep] = useState((brief?.keep ?? []).join(", "));
  const [mustHave, setMustHave] = useState<string[]>(brief?.mustHave ?? []);
  const [avoid, setAvoid] = useState((brief?.avoid ?? []).join(", "));
  const [touched, setTouched] = useState(false);

  const budgetNum = Number(budget);
  const budgetError = noLimit ? null : !budget ? "Add a budget, or choose no limit." : !(budgetNum >= 50) ? "Budget needs to be at least $50." : null;
  const descError = !description.trim() && style.length === 0 ? "Pick a style or describe the feeling you want." : null;

  async function save() {
    setTouched(true);
    if (budgetError || descError) return;
    const next: Brief = { style, description: description.trim(), colors: splitList(colors), budget: noLimit ? null : budgetNum, roomType, functions, intensity, rental, keep: splitList(keep), mustHave, avoid: splitList(avoid) };
    setSaving(true);
    try {
      const isNew = !brief;
      setProject(await api.patchProject(project.id, { brief: next }));
      setEditing(false);
      if (isNew) await send(`I've added my photos and brief. Please design my ${roomType ? roomLabel(roomType).toLowerCase() : "space"} makeover.`);
      else if (project.directions.length) toast("Brief updated", { description: "Ask the designer to update the plan for your changes." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the brief");
    } finally {
      setSaving(false);
    }
  }

  if (!editing && brief) {
    return (
      <Section
        title="Your brief"
        action={
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={project.running}>
            <Pencil aria-hidden /> Edit
          </Button>
        }
      >
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-4 text-sm">
          {brief.description && <p className="text-base">“{brief.description}”</p>}
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="brand">{brief.roomType ? roomLabel(brief.roomType) : project.autopilot ? "Space type: Roomwise decides" : "Space type: Roomwise will ask"}</Pill>
            <Pill tone="brand">{INTENSITIES.find((i) => i.value === brief.intensity)?.label}</Pill>
            {brief.functions.map((f) => (
              <Pill key={f}>{f}</Pill>
            ))}
            <Pill>{brief.budget === null ? "No budget limit" : `${money(brief.budget)} budget`}</Pill>
            {brief.rental && <Pill>Rental-safe</Pill>}
            {brief.style.map((s) => (
              <Pill key={s}>{s}</Pill>
            ))}
            {brief.colors.map((c) => (
              <Pill key={c}>{c}</Pill>
            ))}
          </div>
          {(brief.mustHave.length > 0 || brief.keep.length > 0 || brief.avoid.length > 0) && (
            <dl className="grid gap-2 text-text-muted sm:grid-cols-3">
              {brief.mustHave.length > 0 && <Row k="Must have" v={brief.mustHave.join(", ")} />}
              {brief.keep.length > 0 && <Row k="Keeping" v={brief.keep.join(", ")} />}
              {brief.avoid.length > 0 && <Row k="Avoid" v={brief.avoid.join(", ")} />}
            </dl>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section title={brief ? "Edit your brief" : "Tell Roomwise what you want"} description="Roomwise treats budget, rental, keep and avoid as hard rules.">
      <form
        className="flex flex-col gap-5 rounded-md border border-border bg-surface-raised p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium">What&apos;s this space?</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {SPACES.map((sp) => (
              <button
                key={sp.label}
                type="button"
                role="radio"
                aria-checked={roomType === sp.value}
                onClick={() => setRoomType(sp.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors duration-150",
                  roomType === sp.value ? "border-brand bg-brand text-primary-foreground hover:bg-brand-hover" : "border-border-interactive bg-surface hover:bg-surface-hover",
                )}
              >
                {sp.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium">
            What should it do? <span className="font-normal text-text-muted">· optional</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {FUNCTIONS.map((f) => (
              <Chip key={f} on={functions.includes(f)} onClick={() => setFunctions((v) => (v.includes(f) ? v.filter((x) => x !== f) : [...v, f]))}>
                {f}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium">How big a change?</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
            {INTENSITIES.map((i) => (
              <button
                key={i.value}
                type="button"
                role="radio"
                aria-checked={intensity === i.value}
                onClick={() => setIntensity(i.value)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md border p-3 text-left transition-colors duration-150",
                  intensity === i.value ? "border-brand bg-brand-subtle" : "border-border-interactive bg-surface hover:bg-surface-hover",
                )}
              >
                <span className="text-sm font-medium">{i.label}</span>
                <span className="text-xs text-text-muted">{i.body}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium">Style</legend>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <Chip key={s} on={style.includes(s)} onClick={() => setStyle((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))}>
                {s}
              </Chip>
            ))}
          </div>
        </fieldset>

        <Field label="How should it feel?" htmlFor="desc" error={touched ? descError : null}>
          <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. cozy, beige or lighter colours, lots of blankets" rows={2} aria-invalid={touched && !!descError} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Budget (USD)" htmlFor="budget" error={touched ? budgetError : null}>
            <Input
              id="budget"
              inputMode="numeric"
              value={noLimit ? "" : budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={noLimit ? "No limit" : "500"}
              disabled={noLimit}
              aria-invalid={touched && !!budgetError}
            />
            <label className="flex items-center gap-2 pt-1 text-sm">
              <Checkbox checked={noLimit} onCheckedChange={(v) => setNoLimit(v === true)} />
              No budget limit — design for the best result
            </label>
          </Field>
          <Field label="Colours you like" htmlFor="colors" hint="Comma-separated">
            <Input id="colors" value={colors} onChange={(e) => setColors(e.target.value)} placeholder="beige, cream, warm white" />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium">Must have</legend>
          <div className="flex flex-wrap gap-2">
            {MUST_HAVES.map((s) => (
              <Chip key={s} on={mustHave.includes(s)} onClick={() => setMustHave((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))}>
                {s}
              </Chip>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Keeping" htmlFor="keep" hint="Furniture that stays, comma-separated">
            <Input id="keep" value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="e.g. sofa, mirror" />
          </Field>
          <Field label="Avoid" htmlFor="avoid" hint="Colours, materials or patterns">
            <Input id="avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="grey, animal prints" />
          </Field>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={rental} onCheckedChange={(v) => setRental(v === true)} className="mt-0.5" />
          <span>
            <span className="font-medium">I&apos;m renting</span>
            <span className="block text-text-muted">No paint, no drilling, nothing permanent.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size={brief ? "default" : "lg"} disabled={saving || project.running}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : brief ? null : <Sparkles aria-hidden />}
            {brief ? "Save brief" : "Start designing"}
          </Button>
          {brief && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs font-medium">{k}</dt>
      <dd className="text-text">{v}</dd>
    </div>
  );
}

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-danger-text">{error}</p> : hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors duration-150 active:scale-[0.98]",
        on ? "border-brand bg-brand text-primary-foreground hover:bg-brand-hover" : "border-border-interactive bg-surface hover:bg-surface-hover",
      )}
    >
      {children}
    </button>
  );
}
