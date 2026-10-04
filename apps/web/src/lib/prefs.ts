import { create } from "zustand";

export type ThemeId = "dark" | "light" | "eye";
export type LocaleId = "zh" | "en";
export type FontScale = "sm" | "md" | "lg";

export interface AppPrefs {
  locale: LocaleId;
  theme: ThemeId;
  fontScale: FontScale;
  compactNav: boolean;
  reduceMotion: boolean;
  confirmDelete: boolean;
  autoplayPreview: boolean;
  notifyOnJobDone: boolean;
  autoSubtitles: boolean;
  ttsVoice: string;
  ttsEndpointId: string;
  ttsFamily: string;
}

const KEY = "vw.prefs";

export const defaultPrefs: AppPrefs = {
  locale: "zh",
  theme: "dark",
  fontScale: "md",
  compactNav: false,
  reduceMotion: false,
  confirmDelete: true,
  autoplayPreview: false,
  notifyOnJobDone: false,
  autoSubtitles: true,
  ttsVoice: "",
  ttsEndpointId: "",
  ttsFamily: "",
};

function readPrefs(): AppPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AppPrefs>;
    return { ...defaultPrefs, ...raw };
  } catch {
    return { ...defaultPrefs };
  }
}

export function applyPrefs(prefs: AppPrefs) {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.dataset.font = prefs.fontScale;
  root.dataset.compact = prefs.compactNav ? "1" : "0";
  root.dataset.reduceMotion = prefs.reduceMotion ? "1" : "0";
  root.lang = prefs.locale === "en" ? "en" : "zh-CN";
  document.title = "GeekReel AI Studio";
}

type PrefsStore = AppPrefs & {
  patch(next: Partial<AppPrefs>): void;
  reset(): void;
};

function persist(prefs: AppPrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
  applyPrefs(prefs);
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...readPrefs(),
  patch(next) {
    const { patch: _p, reset: _r, ...cur } = get();
    const prefs = { ...cur, ...next };
    persist(prefs);
    set(prefs);
  },
  reset() {
    persist(defaultPrefs);
    set(defaultPrefs);
  },
}));

export function bootPrefs() {
  applyPrefs(readPrefs());
}

export function confirmDanger(message: string): boolean {
  if (!usePrefs.getState().confirmDelete) return true;
  return window.confirm(message);
}

const NOTIFY_JOBS = new Set([
  "gen.video",
  "gen.image",
  "gen.tts",
  "timeline.render",
  "timeline.finish",
  "pipeline.run",
  "pipeline.episode",
  "remake.run",
  "compose.keys",
  "media.transcode",
  "analyze.run",
  "style.import",
  "asset.migrate",
]);

export function notifyJobDone(job: { type: string; status: string; message?: string | null; error?: string | null }) {
  const prefs = usePrefs.getState();
  if (!prefs.notifyOnJobDone || !NOTIFY_JOBS.has(job.type)) return;
  if (job.status !== "done" && job.status !== "failed") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = prefs.locale === "en"
    ? (job.status === "done" ? "Job finished" : "Job failed")
    : (job.status === "done" ? "任务完成" : "任务失败");
  new Notification(title, { body: job.message || job.error || job.type });
}
