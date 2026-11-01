"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useHydrated } from "@/lib/api";
import type {
  AssistAvailability,
  AssistMemory,
  AssistModeChoice,
  AssistProject,
  AssistThread,
  AssistThreadSummary,
  AssistThreadView,
  MemoryCategory,
  MemoryScope,
  ProjectColor,
  ProjectSource,
  Skill,
  SkillSummary,
} from "@/lib/assist";
import type { ConnectorView } from "@/lib/assist-connectors";
import type { ScheduleRule, ScheduleView } from "@/lib/assist-schedule";
import type { Engine, Generation } from "@/lib/catalog/types";
import type { RecipeEstimate, RecipeRun, RecipeView, VerifyResult } from "@/lib/recipe";
import type { DraftRefusal, Naming, SkillDraft } from "@/lib/recipe-builder";
import { responseError } from "@/lib/refusals";

/** A rule as the dialog sends it: the server sets when "every N hours" starts counting. */
export type ScheduleRuleInput = ScheduleRule extends infer R ? (R extends { kind: "hours" } ? Omit<R, "from"> : R) : never;

/**
 * React Query hooks for Assist's skills, memory, projects and chat lists (/api/assist/**).
 * Thread transcripts stay under ["assist", id] (patched by the live generation stream in
 * lib/api.ts); the lists here use their own keys so that reducer never mistakes them for a thread.
 */

async function json<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(responseError(res, body.error ?? `Request failed (${res.status})`), { status: res.status });
  return body;
}

/**
 * Until the page has hydrated, a query reads as loading: the first client render then matches the
 * server's HTML even when another Suspense boundary already filled the cache with the same key.
 */
function useHydrationSafe<T extends UseQueryResult<unknown, Error>>(q: T): T {
  const hydrated = useHydrated();
  if (hydrated) return q;
  return { ...q, data: undefined, error: null, status: "pending", isPending: true, isLoading: true, isFetching: true, isSuccess: false, isError: false, fetchStatus: "fetching" } as T;
}

const send = async <T,>(url: string, method: string, body?: unknown) =>
  json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

// ---------------------------------------------------------------------------
// Chats

export interface ChatList {
  threads: AssistThreadSummary[];
  agent: AssistThread["agent"];
  availability: AssistAvailability;
}

/** Chats, optionally one project's (or "none": chats outside projects), with a search. */
export function useChats(f: { project?: string | "none"; q?: string } = {}) {
  const sp = new URLSearchParams();
  if (f.project) sp.set("project", f.project);
  if (f.q?.trim()) sp.set("q", f.q.trim());
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-chats", f.project ?? "all", f.q?.trim() ?? ""],
      queryFn: async () => json<ChatList>(await fetch(`/api/assist${sp.size ? `?${sp}` : ""}`)),
      staleTime: 5_000,
    }),
  );
}

export function useChatActions() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["assist-chats"] });
    void qc.invalidateQueries({ queryKey: ["assist"], exact: true });
    void qc.invalidateQueries({ queryKey: ["assist-projects"] });
    if (id) void qc.invalidateQueries({ queryKey: ["assist", id] });
  };
  return {
    start: async (body: { text: string; attachments?: string[]; engine: Engine; autoApprove: boolean; projectId?: string | null; mode?: AssistModeChoice }) => {
      const t = await send<AssistThread & { note?: string }>("/api/assist", "POST", body);
      qc.setQueryData<AssistThreadView>(["assist", t.id], { thread: t, generations: [] });
      refresh(t.id);
      return t;
    },
    patch: async (id: string, body: { autoApprove?: boolean; title?: string; projectId?: string | null; mode?: AssistModeChoice }) => {
      const t = await send<AssistThread>(`/api/assist/${id}`, "PATCH", body);
      qc.setQueryData<AssistThreadView>(["assist", id], (old) => (old ? { ...old, thread: t } : old));
      refresh(id);
      return t;
    },
    remove: async (id: string) => {
      await send(`/api/assist/${id}`, "DELETE");
      qc.removeQueries({ queryKey: ["assist", id] });
      refresh();
    },
  };
}

// ---------------------------------------------------------------------------
// Skills

export function useSkills() {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-skills"],
      queryFn: async () => (await json<{ items: SkillSummary[] }>(await fetch("/api/assist/skills"))).items,
      staleTime: 30_000,
    }),
  );
}

export function useSkill(name: string | null) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-skills", name],
      enabled: !!name,
      queryFn: async () => json<Skill>(await fetch(`/api/assist/skills/${name}`)),
    }),
  );
}

export interface SkillForm {
  name: string;
  title: string;
  description: string;
  whenToUse?: string;
  body: string;
  icon?: string;
}

export function useSkillActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["assist-skills"] });
  return {
    create: async (f: SkillForm) => {
      const s = await send<Skill>("/api/assist/skills", "POST", f);
      refresh();
      return s;
    },
    update: async (name: string, f: Partial<SkillForm>) => {
      const s = await send<Skill>(`/api/assist/skills/${name}`, "PATCH", f);
      refresh();
      return s;
    },
    toggle: async (name: string, enabled: boolean) => {
      // Optimistic: the switch moves at once.
      qc.setQueryData<SkillSummary[]>(["assist-skills"], (old) => old?.map((s) => (s.name === name ? { ...s, enabled } : s)));
      try {
        await send<Skill>(`/api/assist/skills/${name}`, "PATCH", { enabled });
      } finally {
        refresh();
      }
    },
    duplicate: async (name: string) => {
      const s = await send<Skill>(`/api/assist/skills/${name}/duplicate`, "POST");
      refresh();
      return s;
    },
    remove: async (name: string) => {
      await send(`/api/assist/skills/${name}`, "DELETE");
      refresh();
    },
    upload: async (file: File, replace = false) => {
      const form = new FormData();
      form.set("file", file);
      const r = await json<{ skill: Skill; skipped: string[]; replaced: boolean }>(await fetch(`/api/assist/skills/upload${replace ? "?replace=1" : ""}`, { method: "POST", body: form }));
      refresh();
      return r;
    },
  };
}

// ---------------------------------------------------------------------------
// Skills that run by themselves (recipe.json, src/lib/recipe.ts)

/** A refusal from the recipe routes: the reason, and every problem of a recipe that can't run as it is. */
export type RecipeFailure = Error & { status?: number; problems?: string[] };

async function recipeCall<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string; problems?: string[] };
  if (!res.ok) throw Object.assign(responseError(res, out.error ?? `Request failed (${res.status})`), { status: res.status, problems: out.problems }) as RecipeFailure;
  return out;
}

/** A skill's recipe with where it runs and what was checked; null when the skill has none. */
export function useRecipe(name: string | null, enabled = true) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-recipe", name],
      enabled: !!name && enabled,
      retry: false,
      queryFn: async () => json<RecipeView>(await fetch(`/api/assist/skills/${name}/recipe`)),
    }),
  );
}

export interface RecipeBody {
  values?: Record<string, unknown>;
  csv?: string;
  engine?: Engine;
}

export function useRecipeActions() {
  const qc = useQueryClient();
  return {
    estimate: (name: string, body: RecipeBody) => recipeCall<RecipeEstimate>(`/api/assist/skills/${name}/estimate`, body),
    run: (name: string, body: RecipeBody) => recipeCall<{ engine: Engine; runs: RecipeRun[]; demo: boolean }>(`/api/assist/skills/${name}/run`, body),
    /** Check it (plan + the free dry run by default); the skill's status is refreshed with the result. */
    verify: async (name: string, body: { level?: "plan" | "demo" | "real"; engine?: Engine; confirm?: boolean } = {}) => {
      try {
        const r = await recipeCall<VerifyResult>(`/api/assist/skills/${name}/verify`, { level: "demo", ...body });
        qc.setQueryData(["assist-recipe", name], r.view);
        return r;
      } catch (e) {
        // Refused (the recipe changed while it was checked, say): show the recipe as it is now.
        void qc.invalidateQueries({ queryKey: ["assist-recipe", name] });
        throw e;
      } finally {
        void qc.invalidateQueries({ queryKey: ["assist-skills"] });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Making a skill from results (W2: src/server/recipe-builder.ts)

/** A draft check's answer (src/server/recipes.ts checkDraft). */
export interface DraftCheckResult {
  ok: boolean;
  engines: VerifyResult["engines"];
  ready: Engine[];
  why?: string;
}

/** The draft of a skill from picked results: its steps rebuilt, every input Fixed, and the picks it couldn't use. */
export function useSkillDraft(ids: string[]) {
  return useQuery({
    queryKey: ["skill-draft", ids.join(",")],
    enabled: ids.length > 0,
    retry: false,
    // Read once while the review is open, and dropped when it closes: opened again, it is drafted again (a name saved
    // since is taken, a result trashed since is gone).
    staleTime: Infinity,
    gcTime: 0,
    queryFn: () => recipeCall<{ draft: SkillDraft | null; refusals: DraftRefusal[] }>("/api/assist/skills/draft", { generations: ids }),
  });
}

export function useDraftActions() {
  const qc = useQueryClient();
  return {
    /** Price it on each engine (`plan`), or add the free dry run (`demo`). */
    check: (recipe: unknown, level: "plan" | "demo", title?: string) => recipeCall<DraftCheckResult>("/api/assist/skills/draft/check", { recipe, level, title }),
    /** The optional naming pass (null: no LLM, or its answer didn't fit). */
    name: async (ids: string[]) => (await recipeCall<{ naming: Naming | null }>("/api/assist/skills/draft/name", { generations: ids })).naming,
    save: async (body: { name: string; title: string; description: string; whenToUse?: string; body: string; recipe: unknown }) => {
      const view = await recipeCall<RecipeView>("/api/assist/skills/draft/save", body);
      qc.setQueryData(["assist-recipe", view.name], view);
      qc.removeQueries({ queryKey: ["skill-draft"] });
      void qc.invalidateQueries({ queryKey: ["assist-skills"] });
      return view;
    },
  };
}

// ---------------------------------------------------------------------------
// Memory

export function useMemories(f: { scope: MemoryScope | "all"; projectId?: string | null }) {
  const sp = new URLSearchParams({ scope: f.scope });
  if (f.projectId) sp.set("project", f.projectId);
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-memory", f.scope, f.projectId ?? null],
      queryFn: async () => (await json<{ items: AssistMemory[] }>(await fetch(`/api/assist/memory?${sp}`))).items,
    }),
  );
}

export function useMemoryActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["assist-memory"] });
  return {
    add: async (m: { text: string; category: MemoryCategory; scope: MemoryScope; projectId?: string | null }) => {
      const r = await send<AssistMemory>("/api/assist/memory", "POST", m);
      refresh();
      return r;
    },
    update: async (id: string, patch: { text?: string; category?: MemoryCategory }) => {
      const r = await send<AssistMemory>(`/api/assist/memory/${id}`, "PATCH", patch);
      refresh();
      return r;
    },
    remove: async (id: string) => {
      await send(`/api/assist/memory/${id}`, "DELETE");
      refresh();
    },
    importItems: async (body: { items: { text: string; category: MemoryCategory }[]; scope: MemoryScope; projectId?: string | null }) => {
      const r = await send<{ added: number; skipped: number }>("/api/assist/memory/import", "POST", body);
      refresh();
      return r;
    },
  };
}

// ---------------------------------------------------------------------------
// Projects

export function useProjects() {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-projects"],
      queryFn: async () => (await json<{ items: AssistProject[] }>(await fetch("/api/assist/projects"))).items,
      staleTime: 10_000,
    }),
  );
}

export function useProject(id: string | null) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-projects", id],
      enabled: !!id,
      queryFn: async () => json<AssistProject>(await fetch(`/api/assist/projects/${id}`)),
      retry: (n, e) => (e as { status?: number }).status !== 404 && n < 1,
    }),
  );
}

export interface ProjectAsset {
  generation: Generation;
  chatId: string;
  chatTitle: string;
}

/** What a project's chats made (the Assets tab), refreshed when the tab is opened again. */
export function useProjectAssets(id: string, enabled = true) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-projects", id, "assets"],
      enabled,
      queryFn: async () => (await json<{ items: ProjectAsset[] }>(await fetch(`/api/assist/projects/${id}/assets`))).items,
      staleTime: 10_000,
    }),
  );
}

export interface ProjectForm {
  name?: string;
  color?: ProjectColor;
  instructions?: string;
  skills?: string[];
  usePersonalMemory?: boolean;
}

export type SourceForm = { kind: "link"; url: string } | { kind: "element"; elementId: string } | { kind: "text"; title?: string; text: string };

export function useProjectActions() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["assist-projects"] });
    if (id) void qc.invalidateQueries({ queryKey: ["assist-projects", id] });
  };
  return {
    create: async (f: ProjectForm) => {
      const p = await send<AssistProject>("/api/assist/projects", "POST", f);
      refresh();
      return p;
    },
    update: async (id: string, f: ProjectForm) => {
      const p = await send<AssistProject>(`/api/assist/projects/${id}`, "PATCH", f);
      qc.setQueryData(["assist-projects", id], p);
      refresh(id);
      return p;
    },
    remove: async (id: string) => {
      await send(`/api/assist/projects/${id}`, "DELETE");
      qc.removeQueries({ queryKey: ["assist-projects", id] });
      refresh();
      void qc.invalidateQueries({ queryKey: ["assist-chats"] });
    },
    addSource: async (id: string, s: SourceForm) => {
      const r = await send<ProjectSource>(`/api/assist/projects/${id}/sources`, "POST", s);
      refresh(id);
      return r;
    },
    addFile: async (id: string, file: File) => {
      const form = new FormData();
      form.set("file", file);
      const r = await json<ProjectSource>(await fetch(`/api/assist/projects/${id}/sources`, { method: "POST", body: form }));
      refresh(id);
      return r;
    },
    refreshSource: async (id: string, sourceId: string) => {
      const r = await send<ProjectSource>(`/api/assist/projects/${id}/sources/${sourceId}/refresh`, "POST");
      refresh(id);
      return r;
    },
    removeSource: async (id: string, sourceId: string) => {
      await send(`/api/assist/projects/${id}/sources/${sourceId}`, "DELETE");
      refresh(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Scheduled tasks

export interface ScheduleForm {
  title: string;
  prompt: string;
  attachments?: string[];
  projectId?: string | null;
  rule: ScheduleRuleInput;
  tz: string;
  approval: "ask" | "auto";
  capUsd?: number | null;
  engine: Engine;
  mode?: AssistModeChoice | null;
  connectors?: boolean;
  paused?: boolean;
}

/** Tasks, all or one project's; refreshed every 30 s so "next run" and the last result stay current. */
export function useSchedules(projectId?: string) {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-schedules", projectId ?? "all"],
      queryFn: async () => (await json<{ items: ScheduleView[] }>(await fetch(`/api/assist/schedules${projectId ? `?project=${projectId}` : ""}`))).items,
      refetchInterval: 30_000,
    }),
  );
}

export function useScheduleActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["assist-schedules"] });
    void qc.invalidateQueries({ queryKey: ["assist-chats"] });
  };
  return {
    create: async (f: ScheduleForm) => {
      const s = await send<ScheduleView>("/api/assist/schedules", "POST", f);
      refresh();
      return s;
    },
    update: async (id: string, f: Partial<ScheduleForm>) => {
      const s = await send<ScheduleView>(`/api/assist/schedules/${id}`, "PATCH", f);
      refresh();
      return s;
    },
    remove: async (id: string) => {
      await send(`/api/assist/schedules/${id}`, "DELETE");
      refresh();
    },
    /** The new chat's id; null while the last run is still going; throws with the reason when the run couldn't start. */
    runNow: async (id: string) => {
      const r = await fetch(`/api/assist/schedules/${id}/run`, { method: "POST" });
      const body = (await r.json().catch(() => ({}))) as { threadId?: string | null; error?: string };
      refresh();
      if (r.status === 409) return null;
      if (!r.ok) throw responseError(r, body.error ?? `Request failed (${r.status})`);
      return body.threadId ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Custom MCP connectors (Settings → Assist connectors)

export function useConnectors() {
  return useHydrationSafe(
    useQuery({
      queryKey: ["assist-connectors"],
      queryFn: async () => (await json<{ items: ConnectorView[] }>(await fetch("/api/assist/connectors"))).items,
    }),
  );
}

export function useConnectorActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["assist-connectors"] });
  return {
    create: async (f: { name: string; url: string; token?: string; tools?: string | null }) => {
      const c = await send<ConnectorView>("/api/assist/connectors", "POST", f);
      refresh();
      return c;
    },
    update: async (id: string, f: { name?: string; url?: string; token?: string; tools?: string | null; enabled?: boolean }) => {
      // Optimistic for the on / off switch.
      if (f.enabled !== undefined) qc.setQueryData<ConnectorView[]>(["assist-connectors"], (old) => old?.map((c) => (c.id === id ? { ...c, enabled: f.enabled! } : c)));
      try {
        return await send<ConnectorView>(`/api/assist/connectors/${id}`, "PATCH", f);
      } finally {
        refresh();
      }
    },
    remove: async (id: string) => {
      await send(`/api/assist/connectors/${id}`, "DELETE");
      refresh();
    },
  };
}
