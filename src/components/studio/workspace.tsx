"use client";

import { Check, CircleDashed, ImagePlus, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, fileUrl } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { roomLabel } from "@/lib/domain/rooms";
import { BriefForm } from "./brief-form";
import { Empty, Pill, Section } from "./common";
import type { StudioActions } from "./studio";

export function Workspace(props: StudioActions) {
  const { project } = props;
  const roomPhotos = project.photos.filter((p) => p.kind === "room");

  return (
    <div className="flex flex-col gap-10">
      <Photos {...props} />
      {roomPhotos.length > 0 && <BriefForm {...props} />}
      {project.room ? <RoomProfileCard {...props} /> : roomPhotos.length > 0 && project.brief && !project.running && (
        <Empty icon={CircleDashed} title="Room not analyzed yet" body="Start designing and Roomwise will study your photos first." />
      )}
      <Progress {...props} />
    </div>
  );
}

function Photos({ project, setProject }: StudioActions) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const photos = project.photos.filter((p) => p.kind === "room");

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((f) => /image|heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return toast.error("Those don't look like photos.");
    setUploading(true);
    try {
      setProject(await api.uploadPhotos(project.id, list));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(photoId: string) {
    try {
      setProject(await api.deletePhoto(project.id, photoId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove photo");
    }
  }

  const picker = (
    <input ref={input} type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={(e) => e.target.files && upload(e.target.files)} aria-label="Choose room photos" />
  );

  if (photos.length === 0) {
    return (
      <Section title="Start with your space" description="1–5 photos from the doorway and corners. Messy is fine — natural light helps.">
        {picker}
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => (e.preventDefault(), setDragging(false), upload(e.dataTransfer.files))}
          disabled={uploading}
          className={cn(
            "flex aspect-[16/7] w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-interactive bg-surface-raised text-center transition-colors duration-150 hover:border-brand hover:bg-brand-subtle",
            dragging && "border-brand bg-brand-subtle",
          )}
        >
          {uploading ? <Loader2 className="size-7 animate-spin text-brand-text" aria-hidden /> : <ImagePlus className="size-7 text-brand-text" aria-hidden />}
          <span className="text-lg font-medium">{uploading ? "Uploading…" : "Drop room photos here"}</span>
          <span className="text-sm text-text-muted">or click to choose · JPEG, PNG, HEIC</span>
        </button>
      </Section>
    );
  }

  return (
    <Section
      title="Your room"
      description={`${photos.length} of 5 photos`}
      action={
        photos.length < 5 && (
          <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
            Add photos
          </Button>
        )
      }
    >
      {picker}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {photos.map((ph) => (
          <li key={ph.id} className="group relative overflow-hidden rounded-md border border-border bg-surface-sunken">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, owner-gated file route */}
            <img src={fileUrl(ph.path)} alt="Room photo" className="aspect-[3/4] w-full object-cover" />
            {!project.renders.some((r) => r.photoId === ph.id) && (
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute top-2 right-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove(ph.id)}
                aria-label="Remove photo"
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RoomProfileCard({ project, setProject, send }: StudioActions) {
  const room = project.room!;
  const [busy, setBusy] = useState(false);
  const open = room.questions.filter((q) => !q.answer);

  async function confirm() {
    setBusy(true);
    try {
      setProject(await api.patchProject(project.id, { room: { confirmed: true } }));
      toast.success("Room details confirmed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const dims = room.dimensions.widthFt && room.dimensions.lengthFt ? `${room.dimensions.widthFt} × ${room.dimensions.lengthFt} ft${room.dimensions.source === "estimated" ? " (estimated)" : ""}` : "Not measured";

  return (
    <Section
      title="What Roomwise sees"
      action={
        room.confirmed ? (
          <Pill tone="success">
            <Check className="size-3" aria-hidden /> Confirmed
          </Pill>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => send("Please re-check the room analysis against my photos.")} disabled={project.running}>
              <RefreshCw aria-hidden /> Re-check
            </Button>
            <Button size="sm" onClick={confirm} disabled={busy || project.running}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Looks right
            </Button>
          </div>
        )
      }
    >
      <p className="text-sm text-text-muted">{room.summary}</p>
      <dl className="grid gap-px overflow-hidden rounded-md border border-border bg-border text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Looks like", `${roomLabel(room.roomType)}${room.functions.length ? ` · ${room.functions.join(", ")}` : ""}`],
          ...(room.bedSize !== "unknown" ? [["Bed", room.bedSize[0].toUpperCase() + room.bedSize.slice(1)]] : []),
          ["Size", dims],
          ["Light", `${room.lighting.colorTemp[0].toUpperCase()}${room.lighting.colorTemp.slice(1)} · ${room.lighting.natural}`],
          ["Confidence", `${Math.round(room.confidence * 100)}%`],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 bg-surface-raised p-3">
            <dt className="text-xs font-medium text-text-muted">{k}</dt>
            <dd className="line-clamp-2">{v}</dd>
          </div>
        ))}
      </dl>

      {open.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning-bg p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-warning-text">
            <TriangleAlert className="size-4" aria-hidden /> Roomwise isn&apos;t sure about {open.length === 1 ? "one thing" : `${open.length} things`}
          </p>
          <ul className="flex flex-col gap-1 text-text">
            {open.map((q) => (
              <li key={q.id}>{q.question}</li>
            ))}
          </ul>
          <p className="text-text-muted">Answer in the designer chat.</p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-sans text-sm font-medium">Furniture</h3>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface-raised text-sm">
            {room.furniture.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  {f.name} <span className="text-text-muted">· {f.color}</span>
                </span>
                {f.keep === true ? <Pill tone="brand">Keeping</Pill> : f.keep === false ? <Pill>Replaceable</Pill> : null}
              </li>
            ))}
            {room.personalItems.map((item) => (
              <li key={item} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{item}</span>
                <Pill tone="brand">Personal · stays</Pill>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-sans text-sm font-medium">Biggest opportunities</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {room.opportunities.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ol>
          {room.constraints.length > 0 && (
            <>
              <h3 className="pt-2 font-sans text-sm font-medium">Constraints</h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-muted">
                {room.constraints.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

function Progress({ project, goTo }: StudioActions) {
  const stale = new Set(project.stale);
  const tabFor: Record<string, Parameters<StudioActions["goTo"]>[0]> = {
    "Design direction chosen": "studio",
    "Inspiration render": "studio",
    "Design passed review": "studio",
    "Shoppable render": "studio",
    "Shopping list": "shopping",
    "Within budget": "shopping",
    "Implementation checklist": "plan",
  };
  return (
    <Section title="Makeover progress" description={stale.size ? `Out of date after your changes: ${[...stale].join(", ")} — ask the designer to update.` : undefined}>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {project.goal.checks.map((c) => {
          const target = tabFor[c.name];
          const body = (
            <>
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", c.ok ? "bg-success-bg text-success-text" : c.optional ? "bg-brand-subtle text-brand-text" : "bg-surface-sunken text-text-subtle")}>
                {c.ok ? <Check className="size-3" aria-hidden /> : <CircleDashed className="size-3" aria-hidden />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {c.name}
                  {c.optional && <span className="font-normal text-text-muted"> · bonus</span>}
                </span>
                <span className="truncate text-text-muted">{c.detail}</span>
              </span>
            </>
          );
          return (
            <li key={c.name}>
              {target ? (
                <button type="button" onClick={() => goTo(target)} className="flex w-full items-start gap-2.5 rounded-md border border-border bg-surface-raised p-3 text-left text-sm transition-colors duration-150 hover:bg-surface-hover">
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface-raised p-3 text-sm">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
