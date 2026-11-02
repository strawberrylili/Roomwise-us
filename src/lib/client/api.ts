"use client";

import type { ProjectView } from "@/lib/server/view";

export type { ProjectView };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
  cover: string | null;
  budget: number | null;
  total: number | null;
  tasks: { done: number; total: number };
  phase: string;
};

export const api = {
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  createProject: (name: string) => request<{ id: string }>("/api/projects", json("POST", { name })),
  getProject: (id: string) => request<ProjectView>(`/api/projects/${id}`),
  patchProject: (id: string, body: object) => request<ProjectView>(`/api/projects/${id}`, json("PATCH", body)),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  uploadPhotos: (id: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("photos", f);
    return request<ProjectView>(`/api/projects/${id}/photos`, { method: "POST", body: form });
  },
  deletePhoto: (id: string, photoId: string) => request<ProjectView>(`/api/projects/${id}/photos/${photoId}`, { method: "DELETE" }),
  send: (id: string, text: string) => request<{ runId: string }>(`/api/projects/${id}/messages`, json("POST", { text })),
  answer: (id: string, questionId: string, answer: string, approve?: boolean) =>
    request<{ runId: string }>(`/api/projects/${id}/answer`, json("POST", { questionId, answer, approve })),
  stop: (id: string) => request<void>(`/api/projects/${id}/stop`, { method: "POST" }),
  setTask: (id: string, taskId: string, done: boolean) => request<ProjectView>(`/api/projects/${id}/tasks/${taskId}`, json("PATCH", { done })),
};

export const fileUrl = (path: string) => `/api/files/${path}`;

export const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
