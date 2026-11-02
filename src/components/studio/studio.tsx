"use client";

import { ArrowLeft, ClipboardList, Images, LayoutGrid, MessageCircle, ShoppingBag, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError, type ProjectView } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { ErrorBox, Pill } from "./common";
import { DesignStudio } from "./design-studio";
import { DesignerPanel } from "./designer-panel";
import { Plan } from "./plan";
import { Shopping } from "./shopping";
import { Workspace } from "./workspace";

export type StudioActions = {
  project: ProjectView;
  setProject: (p: ProjectView) => void;
  /** Send an instruction to the designer; returns false if it couldn't start. */
  send: (text: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  goTo: (tab: Tab) => void;
};

type Tab = "workspace" | "studio" | "shopping" | "plan";

export function Studio({ id }: { id: string }) {
  const { project, setProject, error, events, refresh } = useProject(id);
  const [tab, setTab] = useState<Tab>("workspace");
  const [panelOpen, setPanelOpen] = useState(false);
  const [autoTabbed, setAutoTabbed] = useState(false);

  // Land returning users where their work is.
  useEffect(() => {
    if (!project || autoTabbed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time initial tab choice
    setAutoTabbed(true);
    if (project.renders.length) setTab("studio");
  }, [project, autoTabbed]);

  const send = useCallback(
    async (text: string) => {
      try {
        await api.send(id, text);
        await refresh();
        return true;
      } catch (e) {
        toast.error(e instanceof ApiError && e.status === 409 ? "The designer is still working — wait for it to finish or stop it." : e instanceof Error ? e.message : "Couldn't reach the designer");
        return false;
      }
    },
    [id, refresh],
  );

  if (error && !project) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <ErrorBox message={error === "Not found" ? "This project doesn't exist or isn't yours." : error} onRetry={refresh} />
        <Link href="/" className="mt-4 inline-block text-sm text-brand-text underline-offset-4 hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }
  if (!project) return <StudioSkeleton />;

  const actions: StudioActions = { project, setProject, send, refresh, goTo: setTab };
  const status = project.running
    ? { tone: "brand" as const, label: "Designer is working" }
    : project.pending
      ? { tone: "warning" as const, label: "Waiting for you" }
      : project.goal.met
        ? { tone: "success" as const, label: "Plan complete" }
        : { tone: "neutral" as const, label: `${project.goal.checks.filter((c) => c.ok && !c.optional).length}/${project.goal.checks.filter((c) => !c.optional).length} steps done` };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        <Link href="/" aria-label="All projects" className="rounded-sm p-1 text-text-muted transition-colors duration-150 hover:text-text">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <span className="font-heading text-lg font-semibold max-sm:hidden">Roomwise</span>
        <span className="text-text-subtle max-sm:hidden" aria-hidden>
          /
        </span>
        <h1 className="min-w-0 truncate font-sans text-sm font-medium">{project.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="max-sm:hidden">
            <Pill tone={status.tone}>{status.label}</Pill>
          </span>
          <Button variant="outline" size="sm" className="xl:hidden" onClick={() => setPanelOpen(true)} aria-label="Open designer chat">
            <MessageCircle aria-hidden />
            Designer
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mx-auto max-w-5xl gap-6 px-4 py-6 sm:px-6">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="workspace">
                <LayoutGrid aria-hidden /> <span className="max-sm:sr-only">Workspace</span>
              </TabsTrigger>
              <TabsTrigger value="studio">
                <Images aria-hidden /> <span className="max-sm:sr-only">Design Studio</span>
              </TabsTrigger>
              <TabsTrigger value="shopping">
                <ShoppingBag aria-hidden /> <span className="max-sm:sr-only">Shopping List</span>
              </TabsTrigger>
              <TabsTrigger value="plan">
                <ClipboardList aria-hidden /> <span className="max-sm:sr-only">Plan</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="workspace">
              <Workspace {...actions} />
            </TabsContent>
            <TabsContent value="studio">
              <DesignStudio {...actions} />
            </TabsContent>
            <TabsContent value="shopping">
              <Shopping {...actions} />
            </TabsContent>
            <TabsContent value="plan">
              <Plan {...actions} />
            </TabsContent>
          </Tabs>
        </main>

        <aside className="hidden w-96 shrink-0 border-l border-border bg-surface-sunken xl:flex" aria-label="AI Designer">
          <DesignerPanel {...actions} events={events} />
        </aside>
      </div>

      <AnimatePresence>
        {panelOpen && (
          <motion.div className="fixed inset-0 z-40 flex justify-end xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <button className="absolute inset-0 bg-scrim" aria-label="Close designer chat" onClick={() => setPanelOpen(false)} />
            <motion.div
              role="dialog"
              aria-label="AI Designer"
              className="relative flex h-full w-full max-w-md flex-col bg-surface-sunken shadow-lg"
              initial={{ x: 32 }}
              animate={{ x: 0 }}
              exit={{ x: 32 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onKeyDown={(e) => e.key === "Escape" && setPanelOpen(false)}
            >
              <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3 z-10" onClick={() => setPanelOpen(false)} aria-label="Close" autoFocus>
                <X aria-hidden />
              </Button>
              <DesignerPanel {...actions} events={events} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function StudioSkeleton() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true" aria-label="Loading project">
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
          <Skeleton className="h-9 w-96 max-w-full" />
          <Skeleton className="aspect-[16/7] w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </div>
        <div className="hidden w-96 border-l border-border xl:block" />
      </div>
    </div>
  );
}
