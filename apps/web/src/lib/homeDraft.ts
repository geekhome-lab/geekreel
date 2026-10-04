import type { Job, KeyAssetNeed, ScriptDoc, ScriptNote } from "@vw/core";

export type HomeStep = "write" | "script" | "style" | "keys" | "shot";

export interface HomeDraft {
  idea: string;
  script: ScriptDoc | null;
  notes: ScriptNote[];
  packId: string | null;
  packLabel: string;
  keys: KeyAssetNeed[];
  projectId: string | null;
  step: HomeStep;
  asSeries: boolean;
  durationSec: number;
  updatedAt: number;
  source?: "radar" | "home";
  radarItemId?: string | null;
  radarPlatform?: string;
}

const CURRENT = "vw.homeDraft";
const SHELF = "vw.homeWorks";

export const workStatusLabels: Record<HomeStep, string> = {
  write: "写想法",
  script: "待确认剧本",
  style: "待选风格",
  keys: "待出片",
  shot: "已出片",
};

export function emptyHomeDraft(): HomeDraft {
  return {
    idea: "",
    script: null,
    notes: [],
    packId: null,
    packLabel: "",
    keys: [],
    projectId: null,
    step: "write",
    asSeries: false,
    durationSec: 10,
    updatedAt: Date.now(),
    source: "home",
    radarItemId: null,
    radarPlatform: "",
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalize(raw: Partial<HomeDraft> | null): HomeDraft | null {
  if (!raw) return null;
  return {
    ...emptyHomeDraft(),
    ...raw,
    asSeries: Boolean(raw.asSeries),
    durationSec: Number(raw.durationSec) > 0 ? Number(raw.durationSec) : 10,
    updatedAt: raw.updatedAt ?? Date.now(),
    source: raw.source === "radar" ? "radar" : "home",
    radarItemId: raw.radarItemId ?? null,
    radarPlatform: raw.radarPlatform ?? "",
  };
}

export function loadHomeDraft(): HomeDraft | null {
  return normalize(readJson<HomeDraft | null>(CURRENT, null));
}

export function loadShelf(): HomeDraft[] {
  const raw = readJson<HomeDraft[]>(SHELF, []);
  return raw.map((d) => normalize(d)).filter((d): d is HomeDraft => Boolean(d && isParkable(d)));
}

export function isParkable(draft: HomeDraft): boolean {
  return Boolean(draft.projectId || draft.script || draft.keys.length);
}

const STEP_RANK: Record<HomeStep, number> = {
  write: 0,
  script: 1,
  style: 2,
  keys: 3,
  shot: 4,
};

/** 建项目后主键从标题变成 id，旧条目还停在「待确认剧本」。按同一部片子往前推。 */
export function workAliases(draft: Pick<HomeDraft, "projectId" | "script" | "idea">): string[] {
  return [...new Set([draft.projectId, draft.script?.title?.trim(), draft.idea.trim()].filter((s): s is string => Boolean(s)))];
}

export function sameWork(a: Pick<HomeDraft, "projectId" | "script" | "idea">, b: Pick<HomeDraft, "projectId" | "script" | "idea">): boolean {
  const left = new Set(workAliases(a));
  return workAliases(b).some((k) => left.has(k));
}

export function hasStyle(draft: Pick<HomeDraft, "packId" | "packLabel">): boolean {
  return Boolean(draft.packId || draft.packLabel);
}

/** 已经走到哪一步。选过风格不会再退回「待选风格」。 */
export function actualStep(draft: HomeDraft): HomeStep {
  if (draft.step === "shot") return "shot";
  if (draft.keys.length > 0 || draft.projectId) return "keys";
  if (draft.script) {
    if (hasStyle(draft)) return "script";
    return draft.step === "style" ? "style" : "script";
  }
  return "write";
}

export function resumeStep(draft: HomeDraft): HomeStep {
  const step = actualStep(draft);
  return step === "shot" ? "keys" : step;
}

export function withActualStep(draft: HomeDraft): HomeDraft {
  return { ...draft, step: actualStep(draft) };
}

export function isUnfinished(draft: HomeDraft): boolean {
  return isParkable(draft) && actualStep(draft) !== "shot";
}

const DONE = "vw.homeDone";

function readDone(): string[] {
  return readJson<string[]>(DONE, []);
}

export function markHomeDone(draft: HomeDraft) {
  const aliases = workAliases(draft);
  const next = [...aliases, ...readDone().filter((k) => !aliases.includes(k))].slice(0, 80);
  localStorage.setItem(DONE, JSON.stringify(next));
  removeHomeWork(draft);
}

export function isHomeDone(draft: HomeDraft): boolean {
  const done = new Set(readDone());
  return workAliases(draft).some((k) => done.has(k));
}

export function workKey(draft: HomeDraft): string {
  return draft.projectId || draft.script?.title || draft.idea.trim() || String(draft.updatedAt);
}

function dropMatching(list: HomeDraft[], draft: HomeDraft): HomeDraft[] {
  return list.filter((d) => !sameWork(d, draft));
}

function mergeWorks(prev: HomeDraft, next: HomeDraft): HomeDraft {
  const step = STEP_RANK[actualStep(next)] >= STEP_RANK[actualStep(prev)] ? actualStep(next) : actualStep(prev);
  return {
    ...prev,
    ...next,
    step,
    keys: next.keys.length ? next.keys : prev.keys,
    script: next.script ?? prev.script,
    projectId: next.projectId ?? prev.projectId,
    packId: next.packId ?? prev.packId,
    packLabel: next.packLabel || prev.packLabel,
    idea: next.idea || prev.idea,
    notes: next.notes.length ? next.notes : prev.notes,
    updatedAt: Math.max(prev.updatedAt, next.updatedAt),
  };
}

export function upsertShelf(draft: HomeDraft) {
  const incoming = withActualStep(draft);
  const shelf = loadShelf();
  const prev = shelf.find((d) => sameWork(d, incoming));
  const merged = prev ? mergeWorks(prev, incoming) : incoming;
  if (merged.step === "shot" || isHomeDone(merged)) {
    localStorage.setItem(SHELF, JSON.stringify(dropMatching(shelf, merged)));
    return;
  }
  if (!isParkable(merged)) return;
  const next = [merged, ...dropMatching(shelf, merged)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 40);
  localStorage.setItem(SHELF, JSON.stringify(next));
}

export function saveHomeDraft(draft: HomeDraft) {
  const next = withActualStep({ ...draft, updatedAt: Date.now() });
  localStorage.setItem(CURRENT, JSON.stringify(next));
  sessionStorage.removeItem(CURRENT);
  upsertShelf(next);
}

export function parkCurrent() {
  const cur = loadHomeDraft();
  if (cur) upsertShelf({ ...cur, updatedAt: Date.now() });
  localStorage.removeItem(CURRENT);
  sessionStorage.removeItem(CURRENT);
}

export function clearHomeDraft() {
  parkCurrent();
}

export function removeHomeWork(draft: HomeDraft) {
  localStorage.setItem(SHELF, JSON.stringify(dropMatching(loadShelf(), draft)));
  const cur = loadHomeDraft();
  if (cur && sameWork(cur, draft)) {
    localStorage.removeItem(CURRENT);
    sessionStorage.removeItem(CURRENT);
  }
}

export function listHomeWorks(): HomeDraft[] {
  const cur = loadHomeDraft();
  const shelf = loadShelf()
    .map(withActualStep)
    .filter((d) => isUnfinished(d) && !isHomeDone(d));
  if (!cur || !isUnfinished(cur) || isHomeDone(cur)) return shelf;
  const live = withActualStep(cur);
  const prev = shelf.find((d) => sameWork(d, live));
  const merged = withActualStep(prev ? mergeWorks(prev, live) : live);
  if (merged.step === "shot" || isHomeDone(merged)) return shelf.filter((d) => !sameWork(d, merged));
  return [merged, ...shelf.filter((d) => !sameWork(d, merged))];
}

export function syncHomeWorks(jobs: Job[]) {
  seedWorksFromKeysJobs(jobs);
  retireFinishedWorks(jobs);
}

export function patchHomeDraft(patch: Partial<HomeDraft>): HomeDraft {
  const next = { ...(loadHomeDraft() ?? emptyHomeDraft()), ...patch, updatedAt: Date.now() };
  saveHomeDraft(next);
  return next;
}

export function retireFinishedWorks(jobs: Job[]) {
  const done = new Set(
    jobs.filter((j) => j.type === "gen.video" && j.status === "done" && j.projectId).map((j) => j.projectId as string),
  );
  if (done.size === 0) return;
  for (const w of [...listHomeWorks(), ...loadShelf()]) {
    if (w.projectId && done.has(w.projectId)) markHomeDone(w);
    else if (workAliases(w).some((k) => done.has(k))) markHomeDone(w);
  }
}

export function seedWorksFromKeysJobs(jobs: Job[]) {
  for (const job of jobs) {
    if (job.type !== "compose.keys" || (job.status !== "done" && job.status !== "running") || !job.projectId) continue;
    if (readDone().includes(job.projectId)) continue;
    try {
      const payload = JSON.parse(job.payloadJson) as { script?: ScriptDoc; packId?: string | null };
      const result = JSON.parse(job.resultJson ?? "{}") as { keys?: KeyAssetNeed[] };
      if (!payload.script?.scenes?.length) continue;
      upsertShelf({
        idea: payload.script.title || "",
        script: payload.script,
        notes: [],
        packId: payload.packId ?? null,
        packLabel: "",
        keys: result.keys ?? [],
        projectId: job.projectId,
        step: "keys",
        asSeries: false,
        durationSec: payload.script.durationSec || 10,
        updatedAt: job.finishedAt ?? job.createdAt,
      });
    } catch {
      /* 这条任务结果坏了就跳过 */
    }
  }
}
