"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunEvent } from "@/lib/domain/schemas";
import { api, type ProjectView } from "./api";

/** Project state + live agent events. Refetches the project whenever the agent reports progress. */
export function useProject(id: string) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProject(await api.getProject(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this project");
    }
  }, [id]);

  const scheduleRefresh = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refresh, 250);
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    refresh();
  }, [refresh]);

  useEffect(() => {
    const es = new EventSource(`/api/projects/${id}/events?after=0`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as RunEvent;
      setEvents((prev) => (prev.some((x) => x.seq === e.seq) ? prev : [...prev, e].slice(-400)));
      if (e.type !== "tool_call" && e.type !== "retry") scheduleRefresh();
    };
    return () => es.close();
  }, [id, scheduleRefresh]);

  return { project, setProject, error, events, connected, refresh };
}
