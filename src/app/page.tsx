"use client";

import { ArrowRight, BedDouble, Camera, Loader2, ShoppingBag, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, fileUrl, money, type ProjectSummary } from "@/lib/client/api";

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setError(null);
    api.listProjects().then(setProjects, (e) => setError(e.message));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(load, []);

  async function create() {
    setCreating(true);
    try {
      const { id } = await api.createProject("My room");
      router.push(`/projects/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create a project");
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex h-16 items-center justify-between">
        <span className="font-heading text-xl font-semibold tracking-tight">Roomwise</span>
        <span className="text-sm text-text-muted">Room makeovers</span>
      </header>

      <section className="grid gap-10 py-12 md:grid-cols-[1.2fr_1fr] md:items-end md:py-20">
        <div className="flex flex-col gap-5">
          <h1 className="text-2xl leading-tight md:text-3xl">Your room, redesigned with things you can actually buy.</h1>
          <p className="text-lg text-text-muted">
            Bedroom, living room, dining area or bathroom: upload a few photos and tell Roomwise the feeling you want. It studies the room, plans the design, finds real
            products, shows you the result in your own room, and hands you a checklist.
          </p>
          <div>
            <Button size="lg" onClick={create} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
              Start a project
            </Button>
          </div>
        </div>
        <ol className="grid gap-3 text-sm">
          {[
            { icon: Camera, title: "Photos in", body: "Roomwise works out what the space is, what it should do, and what has to stay." },
            { icon: BedDouble, title: "A plan for your space", body: "Concepts and renders of your real room, staged from empty." },
            { icon: ShoppingBag, title: "A list you can order", body: "Real IKEA US products, checked against your budget." },
          ].map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-md border border-border bg-surface-raised p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand-text">
                <s.icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="font-medium">
                  {i + 1}. {s.title}
                </p>
                <p className="text-text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4 pb-16" aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="text-xl">
          Your projects
        </h2>
        {error ? (
          <div className="flex items-center justify-between rounded-md border border-danger/40 bg-danger-bg p-4 text-sm text-danger-text">
            <span>Couldn&apos;t load your projects: {error}</span>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        ) : projects === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="overflow-hidden rounded-md border border-border">
                <Skeleton className="aspect-[4/3] rounded-none" />
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border-strong p-8">
            <BedDouble className="size-6 text-text-subtle" aria-hidden />
            <p className="font-medium">No projects yet</p>
            <p className="text-sm text-text-muted">Start one above — it saves as you go, so you can come back any time.</p>
          </div>
        ) : (
          <motion.ul
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            initial="hide"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.04 } } }}
          >
            {projects.map((p) => (
              <motion.li
                key={p.id}
                variants={{ hide: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } } }}
              >
                <Link
                  href={`/projects/${p.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface-raised shadow-sm transition-shadow duration-150 hover:shadow-md"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-surface-sunken">
                    {p.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element -- private, owner-gated file route
                      <img src={fileUrl(p.cover)} alt="" className="size-full object-cover transition-transform duration-[400ms] ease-out group-hover:scale-[1.02]" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-text-subtle">
                        <Camera className="size-6" aria-hidden />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{p.name}</p>
                      <ArrowRight className="size-4 shrink-0 text-text-subtle transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                    </div>
                    <p className="text-sm text-text-muted">
                      {p.phase}
                      {p.total !== null && p.budget !== null ? ` · ${money(p.total)} of ${money(p.budget)}` : ""}
                      {p.tasks.total ? ` · ${p.tasks.done}/${p.tasks.total} tasks` : ""}
                    </p>
                  </div>
                </Link>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>
    </div>
  );
}
