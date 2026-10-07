import { emptyTimelineDoc, extractDialogue, spokenLine, type ScriptScene, type TimelineDoc } from "@vw/core";

export { extractDialogue, spokenLine };

export interface SubCue {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface FinishClip {
  videoAssetId: string;
  durationMs: number;
  line: string;
  /** 这一镜自己的出片说明，配音以它和成片画面为准 */
  visual?: string;
  /** 画面上有人开口，要对嘴，不能只盖 TTS */
  talking?: boolean;
  cues?: SubCue[];
}

export interface DubbedClip {
  assetId: string;
  durationMs: number;
}

const MAX_LINE = 12;
/** 中文配音大约每秒五个字；多了 TTS 会把 5 秒片子念成半分钟。 */
const SPEAK_CHARS_PER_SEC = 5;
const ONE_TAKE_COVER = 0.7;

type SceneCue = Pick<ScriptScene, "lines" | "heading" | "action" | "startSec" | "endSec">;

function charCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

function scriptSpanMs(scenes: SceneCue[]): number {
  if (!scenes.length) return 0;
  const start = Math.min(...scenes.map((s) => s.startSec ?? 0));
  const end = Math.max(...scenes.map((s) => s.endSec ?? s.startSec ?? 0));
  return Math.max(0, (end - start) * 1000);
}

export function speakCharBudget(durationMs: number): number {
  return Math.max(6, Math.round((Math.max(400, durationMs) / 1000) * SPEAK_CHARS_PER_SEC));
}

/** 按画面时长裁台词，避免 5 秒视频配出 30 秒旁白。 */
export function clipSpokenText(text: string, durationMs: number): string {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const budget = speakCharBudget(durationMs);
  if (charCount(raw) <= budget) return raw;
  const parts = raw
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let n = 0;
  for (const part of parts) {
    const len = charCount(part);
    if (out.length && n + len > budget) break;
    if (!out.length && len > budget) break;
    out.push(part);
    n += len;
    if (n >= budget) break;
  }
  if (out.length) return out.join("");
  let acc = "";
  for (const ch of raw) {
    if (/\s/.test(ch)) {
      if (acc) acc += ch;
      continue;
    }
    if (charCount(acc) >= budget) break;
    acc += ch;
  }
  return acc.trim();
}

function scenesInWindow(scenes: SceneCue[], startSec: number, endSec: number): SceneCue[] {
  return scenes.filter((s) => {
    const a = s.startSec ?? 0;
    const b = Math.max(a, s.endSec ?? a);
    return a < endSec && b > startSec;
  });
}

function fitLineToClip(clip: FinishClip): FinishClip {
  const line = clipSpokenText(clip.line, clip.durationMs);
  if (line === clip.line.trim() && clip.cues?.length) {
    const cap = Math.max(400, clip.durationMs);
    return {
      ...clip,
      line,
      cues: clip.cues
        .filter((c) => c.startMs < cap)
        .map((c) => ({
          ...c,
          durationMs: Math.min(c.durationMs, Math.max(400, cap - c.startMs)),
        })),
    };
  }
  return { ...clip, line, cues: splitSpokenCues(line, clip.durationMs) };
}

/** 竖屏一行大约十四字，最多两行。 */
export function wrapSubtitle(text: string, maxChars = MAX_LINE): string {
  const clean = text.replace(/\s+/g, "").trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  const lines: string[] = [];
  let rest = clean;
  while (rest && lines.length < 2) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    let cut = maxChars;
    const window = rest.slice(0, maxChars + 1);
    const punct = Math.max(window.lastIndexOf("，"), window.lastIndexOf("、"), window.lastIndexOf(","), window.lastIndexOf(" "));
    if (punct >= Math.floor(maxChars * 0.45)) cut = punct + (window[punct] === " " ? 0 : 1);
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return lines.filter(Boolean).join("\n");
}

function chopLong(text: string, max = 22): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = MAX_LINE;
    const window = rest.slice(0, max);
    const punct = Math.max(window.lastIndexOf("，"), window.lastIndexOf("、"), window.lastIndexOf(","));
    if (punct >= 8) cut = punct + 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** 整段旁白拆成一条条能看的字幕，按时长摊开。 */
export function splitSpokenCues(text: string, durationMs: number): SubCue[] {
  const raw = text.replace(/\r/g, "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[\n]+|(?<=[。！？…!?])/)
    .map((s) => s.replace(/^[。．.]+|[。．.]+$/g, "").trim())
    .filter(Boolean)
    .flatMap((s) => chopLong(s));
  if (parts.length === 0) return [];
  const window = Math.max(800, durationMs);
  const weights = parts.map((p) => Math.max(4, p.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return parts.map((part, i) => {
    const dur = i === parts.length - 1 ? Math.max(600, window - t) : Math.max(600, Math.round((weights[i]! / total) * window));
    const startMs = t;
    t += dur;
    return { text: wrapSubtitle(part), startMs, durationMs: dur };
  });
}

export function cuesFromScenes(scenes: SceneCue[], durationMs: number): SubCue[] {
  const items = scenes
    .map((s) => {
      const text = spokenLine(s).trim();
      const timed = Math.max(0, (s.endSec ?? 0) - (s.startSec ?? 0));
      return { text, weight: timed > 0 ? timed : Math.max(4, text.length) };
    })
    .filter((x) => x.text);
  if (!items.length) return [];
  const window = Math.max(800, durationMs);
  const total = items.reduce((a, b) => a + b.weight, 0);
  let t = 0;
  const out: SubCue[] = [];
  items.forEach((item, i) => {
    const slice = i === items.length - 1 ? Math.max(600, window - t) : Math.max(600, Math.round((item.weight / total) * window));
    for (const cue of splitSpokenCues(item.text, slice)) {
      out.push({ ...cue, startMs: t + cue.startMs });
    }
    t += slice;
  });
  return out;
}

/** 片子比场次少：只配画面时间窗口里的词。成片几乎覆盖整份剧本时才把词铺满。 */
export function fitCuesToClips(clips: FinishClip[], scenes: SceneCue[]): FinishClip[] {
  if (!clips.length) return clips;
  if (scenes.length <= clips.length) return clips.map(fitLineToClip);
  const totalVideo = clips.reduce((a, c) => a + Math.max(400, c.durationMs), 0);
  const span = scriptSpanMs(scenes);
  if (span > 0 && totalVideo >= span * ONE_TAKE_COVER) {
    const all = cuesFromScenes(scenes, totalVideo);
    let offset = 0;
    return clips.map((clip) => {
      const start = offset;
      const end = offset + Math.max(400, clip.durationMs);
      offset = end;
      const cues = all
        .filter((c) => c.startMs >= start && c.startMs < end)
        .map((c) => ({
          text: c.text,
          startMs: c.startMs - start,
          durationMs: Math.min(c.durationMs, Math.max(400, end - c.startMs)),
        }));
      return fitLineToClip({
        ...clip,
        line: cues.map((c) => c.text.replace(/\n/g, "")).join("\n") || clip.line,
        cues,
      });
    });
  }
  let offsetSec = 0;
  return clips.map((clip) => {
    const durSec = Math.max(0.4, clip.durationMs / 1000);
    const used = scenesInWindow(scenes, offsetSec, offsetSec + durSec);
    offsetSec += durSec;
    const line = clipSpokenText(used.map((s) => spokenLine(s)).filter(Boolean).join("\n") || clip.line, clip.durationMs);
    return { ...clip, line, cues: splitSpokenCues(line, clip.durationMs) };
  });
}

/** 视频 + 可选字幕 + 可选配音，排成一条时间线 */
export function buildFinishTimeline(
  clips: FinishClip[],
  opts?: {
    portrait?: boolean;
    withSubtitles?: boolean;
    dubbed?: DubbedClip[];
  },
): TimelineDoc {
  const doc = emptyTimelineDoc({ portrait: opts?.portrait });
  const vTrack = doc.tracks.find((t) => t.type === "video")!;
  const aTrack = doc.tracks.find((t) => t.type === "audio")!;
  const sTrack = doc.tracks.find((t) => t.type === "subtitle")!;
  const withSubs = opts?.withSubtitles !== false;
  const dubbed = opts?.dubbed ?? [];

  let cursor = 0;
  clips.forEach((clip, i) => {
    const dur = Math.max(400, Math.round(clip.durationMs) || 5000);
    const voice = dubbed[i]?.assetId ? dubbed[i] : undefined;
    vTrack.clips.push({
      id: `c_v_${i}`,
      assetId: clip.videoAssetId,
      startMs: cursor,
      inMs: 0,
      outMs: dur,
      volume: voice ? 0 : 1,
    });
    if (voice) {
      aTrack.clips.push({
        id: `c_a_${i}`,
        assetId: voice.assetId,
        startMs: cursor,
        inMs: 0,
        outMs: Math.min(dur, Math.max(400, voice.durationMs || dur)),
        volume: 1,
      });
    }
    if (withSubs) {
      const cues = (clip.cues?.length ? clip.cues : splitSpokenCues(clip.line, dur)).filter((c) => c.text.trim());
      cues.forEach((cue, j) => {
        const start = Math.max(0, cue.startMs);
        if (start >= dur) return;
        sTrack.clips.push({
          id: `c_s_${i}_${j}`,
          text: cue.text.trim(),
          startMs: cursor + start,
          inMs: 0,
          outMs: Math.min(Math.max(400, cue.durationMs), dur - start),
          volume: 1,
        });
      });
    }
    cursor += dur;
  });
  return doc;
}
